# Mailer by satz — Spec (Step 1: Basic)

> Current source of truth. Earlier design docs (`TECH_STACK.md`, `ROADMAP.md`,
> `DESIGN_TEMPLATES.md`, `new_different_doc.md`) are archived under `old/` for
> reference. This doc describes the **basic first version** only.

---

## 1. What it is

A **middleware** service that lets a website send its form submissions to an email
inbox — without the website owning any mail infrastructure. The destination may be
with **any provider**: Gmail, Zoho, Outlook or a custom domain.

- A user fills a form on a website (name, message, maybe a file).
- They click **Send**.
- The website's **backend** calls our REST API (`POST`) with the form data (and
  optional file) and a **secret key** — the key is a server-side credential, so the
  browser posts to the site's own endpoint and that forwards to us.
- We receive the call, verify the secret, turn the received fields into a
  readable message, and **send it as an email to the address configured for that app**.

The email is sent **from our middleware's own sending account** over SMTP — the
host, port and credentials come from env (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`…), so
the account can move provider without a code change. The address chosen during app
registration is the **destination** — where the form submissions land — and is
unrestricted. `Reply-To:` is set to the submitter's address when the submission
contains one, so replying from the destination inbox reaches them; `From:` is
always ours, since putting the submitter there is spoofing and fails DMARC.

---

## 2. End-to-end flow

```
Website form (user types name / message / file)
        │  click "Send"
        ▼
The website's own backend        ← the secret key lives here, never in the browser
        │
        ▼
POST  /v1/send          ← called server-to-server
  header: secret key
  body:   { name, message, ... }  (+ optional file)
        │
        ▼
Mailer API endpoint
  1. collect the posted data
  2. read the secret from the request
  3. verify the secret  ─────────►  invalid → 401 reject
  3b. destination confirmed?  ───►  no → 403 destination_unverified
  4. build the message text from the received fields
  5. send email via our SMTP account  ───────►  configured destination address
        │
        ▼
202 accepted  (email sent)
```

---

## 3. Step 1 scope

### 3a. User accounts (manual)
- User **registers** by typing email + password.
- Registration is not finished until the address is **verified by OTP**: we email
  an **8-character alphanumeric code**, store only its sha256 (15-minute expiry,
  **max 5 wrong attempts**), and land the user on `/verify-email`. A session is
  issued immediately, but an unverified account is redirected back to
  `/verify-email` from anywhere else — it cannot register apps.
- Entering the correct code sets `emailVerified`, clears the code, and **re-issues
  the session cookie** so the `emailVerified` claim middleware reads is current.
  The user can request a fresh code, which invalidates the previous one and resets
  the attempt count.
- Codes are drawn from a 32-symbol alphabet with `I`, `O`, `0`, `1` removed, so a
  code stays typable from a phone screen. At ~40 bits the **attempt cap**, not the
  hash, is what makes guessing infeasible.
- User **logs in** with the same email + password. An unverified account can log
  in, but goes straight to `/verify-email`.
- User can **reset a forgotten password** (see §3d).
- No Google/OAuth login in step 1 — manual typing only.

### 3d. Forgot password
- On the login page, a **"Forgot password?"** link opens a form where the user
  types their email.
- We generate a **single-use, time-limited reset token** (e.g. valid 30 min),
  store its hash against the user, and email a reset link to that address
  **using our SMTP account** — the same mailer that sends form submissions.
- The link opens a **"set new password"** page; on submit we verify the token
  (unexpired, unused, matches the stored hash), set the new `passwordHash`, and
  invalidate the token.
- Always respond with the same "if that email exists, a reset link was sent"
  message — never reveal whether an email is registered.

### 3b. Register an app
After login, the user registers an "app" by providing:

| Field | Meaning |
|---|---|
| **Website name** | Friendly label for this app (e.g. "Acme contact form"). |
| **Email to send to** | The destination inbox where submissions are delivered — any provider. A checkbox fills in the user's own account address; any other address must be **confirmed by OTP** first (§3e). |
| **Mail design** | Which of the five built-in designs renders the email. Changeable later; see [MAIL_TEMPLATES_SPEC.md](MAIL_TEMPLATES_SPEC.md). |
| **Form fields** | The field names this app's form submits, each required or optional. Pre-filled with the four defaults and editable later (§4b). |
| **Secret key** | **Generated** by us and shown once — at registration when the destination is the user's own address, otherwise only when the destination code is entered (§3e). |

Two further settings are **not** part of registration and are configured per app
afterwards, so registering one stays a short form: the **bot guard** (§4d) and the
**automatic reply** (§4e). Both are off until the owner turns them on, and both are
edited from the same app row as the fields and design.

### 3e. Destination confirmation
A valid secret key proves the app was registered — not that the destination
agreed to receive its mail. Without proof of ownership, anyone could register an
app pointing at a third party's inbox and use our shared SMTP account to bomb it
([HARDENING_ROADMAP §1.1](HARDENING_ROADMAP.md)).

- **Own address → no OTP.** If the destination equals the user's account email,
  the app is confirmed on creation and the secret key is shown immediately —
  registration (§3a) already proved that address. The server compares against the
  stored email, so the dashboard checkbox is a convenience, not the authority.
- **Any other address → OTP.** We email that address an 8-character code (same
  scheme, expiry and attempt cap as §3a) and the app is created **without issuing a
  key**: the stored `secretKeyHash` belongs to a key that is generated and
  discarded, so an unconfirmed app cannot send even if the `403` gate were bypassed.
- Entering the code on the dashboard confirms the address, clears the code, and
  **issues the secret key for the first time** (shown once).
- Until confirmed, `POST /v1/send` returns `403 destination_unverified`.
- The owner can send a fresh code from the dashboard, which invalidates the
  previous one and resets the attempt count.

### 3c. Send flow (the public API)
- The website's **server** calls `POST /v1/send` with the secret key and the form
  fields. The key is never exposed to the browser: it is a server-side credential
  ([HARDENING_ROADMAP §3](HARDENING_ROADMAP.md)), and the endpoint is server-to-server
  only — the key travels in an `Authorization` header, which a plain HTML form cannot
  set, so a browser has no way to authenticate at all.
- We verify the secret against the registered app.
- We render the email with the app's selected design and send it to that app's
  configured destination address.

---

## 4. Message building (received data → email)

Whatever fields arrive in the POST body — after the per-app field check in §4b —
are turned into a **multipart email**:
a formatted HTML part rendered with the app's **selected mail design** (one styled
row per field, plus the website name and a received-at footer) and a plain-text
alternative with `Key: value` lines, one per field. The designs are catalogued in
[MAIL_TEMPLATES_SPEC.md](MAIL_TEMPLATES_SPEC.md).

**Example** — request body:

```json
{ "name": "Jane", "message": "Hello there", "phone": "12345" }
```

**Becomes the plain-text part:**

```
Name: Jane
Message: Hello there
Phone: 12345
```

and an HTML part rendering the same fields in the app's chosen design.

Rules:

- Each top-level field becomes one row / one line `<FieldName>: <value>`.
- Field keys are titleized (`first_name` → `First name`).
- Nested objects become an indented sub-list (inner table in HTML); arrays
  become bullet lists; empty/null values render as `—`.
- Newlines inside a value are preserved (`<br />` in HTML).
- All values are HTML-escaped, so submitted markup can never inject into the
  email. The subject line is stripped of CR/LF (header-injection guard).
- If a top-level field holds a single valid address (`reply_to`/`email`/… win over
  other fields), it becomes the `Reply-To:` header so the destination inbox can
  reply to the submitter. Values with whitespace, CR/LF, commas or angle brackets
  are rejected — this one goes into a header, not the body.

### 4a. Request limits

One knob bounds the request: the **total body size, 500KB**
([`MAX_BODY_BYTES`](../src/lib/body-limit.ts)). Bytes are counted as they arrive and
the stream is cancelled the moment the cap is passed, so an oversized post is never
fully buffered; `content-length` is treated only as an early hint, since a client
can omit or falsify it. Over the cap → `413 payload_too_large`.

There is deliberately **no per-field limit**: it would bound nothing, because N
fields at the maximum simply multiply. One field may be the whole submission.

Nesting depth *is* capped separately (`400 body_too_deep`), for a different reason:
`JSON.parse` accepts input far deeper than the recursive rendering in §4 survives, so
a 10KB deeply-nested body would otherwise crash the request rather than merely be
large. Attachments remain out of scope (§8); file parts in a form post are ignored.

### 4b. Declared form fields

Every app carries a **field list** — the names its form is allowed to submit, each
marked required or optional ([`src/lib/fields.ts`](../src/lib/fields.ts)). A new app
is created with the four defaults, so registering one stays a short form:

| Field | Required |
|---|---|
| `name` | yes |
| `email` | yes |
| `phone` | no |
| `message` | yes |

The owner can edit the list from the dashboard at any time (add, remove, rename,
flip required) — up to 25 fields, each starting with a letter and containing only
letters, digits, `_` or `-`.

The check at `/v1/send` is **strict**, and that is the point: a valid key proves the
request came from the app, not that the payload is the form the owner built. Without
a contract, a leaked key mails arbitrary attacker-chosen content to the destination
inbox under our own sending domain.

- A field that isn't declared → `400 unknown_field`, no mail sent.
- A required field absent, `null`, or blank → `400 missing_field`.
- Both responses name the offending field, because `invalid_input` tells whoever
  wired the form up nothing about which input to fix.
- Names are matched **case-insensitively** (posting `Email` satisfies `email`), but
  stored and rendered under the declared spelling.
- Rows are emitted in the **declared order**, and a declared-but-omitted optional
  field still appears (as `—`), so the destination inbox sees the same layout every
  time rather than one that shifts with whatever the client sent.

### 4c. Sending limits

**Per app: 500 emails per UTC day**, from `SEND_APP_DAILY_LIMIT`
([`src/lib/send-limit.ts`](../src/lib/send-limit.ts)), counted in a `DailyUsage`
row keyed `{ appId, date }` and reset at midnight UTC. Over it → `429
daily_limit_exceeded`, with the limit named in the response. Published, not hidden:
[api-docs.ts](../src/lib/api-docs.ts) quotes the configured value, so the docs and the
check can never disagree.

A real contact form never approaches 500. The limit exists because one leaked or
looping key is otherwise unbounded volume against a **single shared mailbox**, and a
throttled mailbox takes down every app *plus* our own OTP and password-reset mail,
which share the account. It is a setting rather than a ceiling — raising it for a busy
customer is a `.env` edit and a restart.

Two implementation properties that are easy to get wrong:

- **Increment, then compare.** Check-then-increment lets two concurrent requests both
  read 499 and both pass. A refused request has therefore already spent a slot, and
  that slot is left spent — when the downside is the sending account being suspended,
  biasing toward under-sending is correct.
- **Counted after validation, not before.** A customer still wiring their form up
  would otherwise burn the day's allowance on requests that were never going to send,
  and a scripted key posts valid bodies anyway.

**Duplicate suppression (60s).** An identical submission from the same app inside 60
seconds is answered `202 { duplicate: true }` and sends no second email
([`src/lib/dedupe.ts`](../src/lib/dedupe.ts)): a double-clicked submit button, or a
retry against a slow response, is waste against a capped allowance. The claim is
atomic — an upsert that only matches an expired row, so a live claim collides on the
unique index instead of quietly passing — and it is **released when the send fails**,
because answering a legitimate retry with `202` while no mail ever went out is worse
than a duplicate. It does not consume a quota slot.

**What consumes a slot.** Anything that reaches the mail server, including a send
that fails there — the provider interaction was still spent. Anything refused before
that (a `400` from §4b, a `422` from §4d, a collapsed duplicate) does not. An
autoresponse (§4e) consumes a **second** slot of its own.

### 4d. Bot and spam guards

Three checks stand between a valid key and an email, all of them refusing with `422`
and **before** the quota is touched, so a blocked submission costs the owner nothing.

**Honeypot (per app, off by default).** The owner names a field of their own choosing
and adds it to the form as a hidden input that stays empty; anything that fills it is
automated → `422 honeypot_filled`. The name is the *owner's* rather than one
platform-wide reserved word, because a shared name is one every bot author learns
once and skips forever.

**Minimum fill time (per app, off by default).** The owner names a field carrying how
long the form was on screen and a minimum in seconds (≤ 60). Under it →
`422 too_fast`; nothing usable in the field → `422 timing_missing`. The value may be
elapsed milliseconds, an epoch stamp in seconds or milliseconds, or an ISO date
([`src/lib/bot-guard.ts`](../src/lib/bot-guard.ts)). A **negative** elapsed time — the
client's clock running ahead of ours — passes: a wrong clock is not evidence of a bot,
and rejecting on it would drop real visitors.

Neither guard field is part of the app's declared field list (§4b): both are stripped
from the submission before the contract is checked, so a honeypot never has to be
declared, never reaches the email, and never shifts the destination's layout.

**Content scoring (always on).** Every submission is scored on what it contains
([`src/lib/spam-score.ts`](../src/lib/spam-score.ts)) — link count, anchor/BBCode
markup, a value opening with a mail header such as `bcc:`, a small phrase list, and
shouting. At or above `SPAM_SCORE_THRESHOLD` (default 6) → `422 spam_rejected`, with
the score and reasons recorded in the log row (§4f) rather than returned to the
caller. Under a permanently shared sender, spam relayed *to* a customer still leaves
our IP, so the complaint is ours even when the delivery was asked for.

The weighting is deliberately **structural, not lexical**: phrase hits are capped
below the threshold and can only amplify a structural signal, never block on their
own. A missed spam is one unwanted email; a false positive is a lost enquiry nobody
ever hears about — the same asymmetry that makes dedupe fail open.

### 4e. Autoresponder

An app may send a *“we got your message”* confirmation back to the submitter
([`src/lib/auto-responder.ts`](../src/lib/auto-responder.ts)). Off by default; the
owner switches it on and may set the subject and message, and a blank one falls back
to built-in wording — storing the default text instead would freeze a copy of it in
every app document. It is rendered from the app's chosen design's **palette** (one
shared acknowledgement layout, since the body is prose rather than label/value rows).

Four properties are load-bearing, because this is the only mail we send to an address
that never confirmed it wanted any:

- **Recipient comes from the submission**, via the same `findReplyTo()` used for the
  `Reply-To:` header (§4). No address in the body means no reply is sent, and a
  submission can never name a recipient of its own.
- **Content is the owner's.** Nothing the submitter typed is echoed back, so a leaked
  key can pick the recipient but never the words.
- **Its own quota slot** (§4c), consumed before it is sent. Out of allowance means the
  confirmation is dropped and the submission still delivers — never the reverse.
- **It cannot affect the response.** It runs after the `202` is earned and its failure
  is logged, not returned; the submission was delivered either way.

A reply to the confirmation reaches the app's destination inbox, not our mailbox.

### 4f. Per-app activity for the owner

Every attempt writes a `SendLog` row — delivered, failed at SMTP, or blocked by §4d —
and the owner can read their own app's rows from the dashboard
(`GET /api/apps/[id]/logs`, scoped by `userId` in the query itself). The panel shows
counts by status, today's usage against the daily limit, and the newest rows with the
provider's own error or the guard's reason. "My form went quiet" is otherwise a
question only an admin could answer. Rows carry `kind: submission | autoresponse`, so
the second email of a pair is distinguishable rather than looking like a duplicate,
and they expire with the 90-day TTL.

---

## 5. API contract (step 1)

```http
POST /v1/send
Authorization: Bearer <secret key>
Content-Type: application/json   (or multipart/form-data when a file is attached)

{ "name": "Jane", "message": "Hello", "...": "the app's other declared fields" }
```

Responses:

| Status | Meaning |
|---|---|
| `202` | Accepted — email sent to the configured address. |
| `400` | Bad request (missing/invalid body). |
| `400` | `unknown_field` / `missing_field` — the submission broke the app's field contract (§4b). |
| `400` | `body_too_deep` — the body nests more than 5 levels (§4a). |
| `401` | Secret key missing or invalid. |
| `403` | `destination_unverified` — the destination address hasn't confirmed (§3e). |
| `413` | `payload_too_large` — the body exceeded 500KB (§4a). |
| `422` | `honeypot_filled` / `too_fast` / `timing_missing` — a bot signal fired (§4d). |
| `422` | `spam_rejected` — the content scored past the spam threshold (§4d). |
| `429` | `daily_limit_exceeded` — the app used its 500 sends for the day (§4c). |
| `502` | Mail send failed. |

`202` also covers a suppressed duplicate, which carries `duplicate: true` (§4c).

### 5a. Public documentation surface

The API docs are **public** — no session required — so that a user can hand the
URL to an AI assistant or a colleague and have it read. Three routes, all
generated from one source (`src/lib/api-docs.ts`) so they cannot drift:

| Route | Content type | Audience |
|---|---|---|
| `/docs` | HTML | Humans. The live `Try it` tester is rendered only for signed-in users. |
| `/docs.md` | `text/markdown` | AI agents and scripts — the same content as plain markdown. |
| `/llms.txt` | `text/plain` | Short index pointing at `/docs.md`, per the llms.txt convention. |

`/robots.txt` allows those three and disallows `/api/`, `/dashboard`, `/admin`,
the auth pages and `/verify-email`. Only `/dashboard` and `/admin` remain in the
middleware matcher — `/verify-email` is where unverified accounts are *sent*, so
gating it would loop.

Nothing privileged is exposed: the docs describe the same endpoint, header and
status codes any customer needs, and access is still gated by the secret key.

### 5b. Public marketing surface

`/` is a **public landing page**, not a redirect: with the dashboard behind a login
wall there was otherwise nothing for a crawler to index. A signed-in visitor is still
sent straight to `/dashboard`. Its sections, in order: hero (with the free tier and
daily cap stated outright), the sites live on it, who it's for, how it works, the
`curl` example, **a rendered sample of the email that arrives**, the feature grid, an
example dashboard row, **what the service deliberately isn't**, FAQ, CTA.

Two of those are shared rather than duplicated, on purpose:

- the sample email is `renderPreviewHtml()` from
  [`src/lib/templates.ts`](../src/lib/templates.ts) — the same function behind
  `/api/templates/[id]/preview`, injected as `srcDoc` under `sandbox=""` because that
  route needs a session and this page's job is to work before anyone has an account;
- the dashboard example is the dashboard's own `.app-item` markup with sample data,
  not a screenshot, so it restyles with the real UI instead of going stale silently.
  Its interactive controls are described in prose rather than rendered as dead buttons.

Customer logos are copied into [`public/logos/`](../public/logos/), never hotlinked —
the source path usually carries a build hash that changes on that site's next deploy.

| Route | Purpose |
|---|---|
| `/` | Landing page, plus `WebSite` / `SoftwareApplication` / `FAQPage` JSON-LD that mirrors the visible copy. |
| `/sitemap.xml` | The two indexable pages, `/` and `/docs`. Referenced from `robots.txt`. |
| `/opengraph-image` | 1200×630 link-preview card, generated with `next/og` so the tagline comes from `brand.ts`. The logo lockup PNG is read from `public/` and sits on a white plate, because its envelope fold lines are transparent and would go dark on the card's black. |
| `/icon.svg`, `/apple-icon.png` | Favicon and iOS touch icon. iOS won't take an SVG, so the touch icon is a static 180×180 PNG of the mark on a white plate. |
| `/manifest.webmanifest` | Name, colours and icon for "add to home screen". |

Titles come from one template in `src/app/layout.tsx` (`%s · Mailer by satz`), and
the brand strings live in [`src/lib/brand.ts`](../src/lib/brand.ts) so the header,
footer, mail footer, OTP emails and OG card cannot drift apart. Every page behind the
login wall additionally sets `robots: { index: false }`, so the crawl policy does not
rest on `robots.txt` alone.

Site chrome is responsive (one shared header with a mobile disclosure nav, a footer
carrying copyright and `contact@satz.co.in`) and honours
`prefers-color-scheme: dark`. The **mail designs** keep their own fixed palettes —
an email is rendered once and read in someone else's client.

---

## 6. Tech stack (unchanged, locked)

Carried over from the archived design — still the intended stack:

- **Next.js** — dashboard (register/login/register-app) + the REST API routes.
- **MongoDB** — stores users, registered apps, and secret keys.
- **Nodemailer + our own SMTP account** — actually sends the email; the host is
  parameterized (env), not pinned to one provider.

The API route that sends mail must run on the **Node.js runtime** (not Edge) so
Nodemailer can open an SMTP connection.

---

## 7. Data (step 1)

**users** — `{ email, passwordHash, emailVerified, emailOtpHash?, emailOtpExpiresAt?, emailOtpAttempts, resetTokenHash?, resetTokenExpiresAt?, createdAt }`
- `emailVerified` gates the whole authed area (§3a) and only ever goes false → true.
- `emailOtp*` hold the pending registration code and are cleared once verified.
- `resetTokenHash` / `resetTokenExpiresAt` are set when a password reset is
  requested and cleared once the password is changed or the token expires.

**apps** — `{ userId, websiteName, destinationEmail, destinationVerified, destinationOtpHash?, destinationOtpExpiresAt?, destinationOtpAttempts, templateId, fields, spamGuard, autoResponder, secretKeyHash, createdAt }`
- The secret key is **hashed** in the DB; the full key is shown once and never
  stored in plaintext. Before a destination is confirmed the stored hash belongs
  to a discarded key, so no usable key exists (§3e).
- `destinationOtp*` hold the pending destination code and are cleared on confirmation.
- `fields` is `[{ name, required }]` — the submission contract enforced by
  `/v1/send` (§4b). Defaulted to the four standard fields, so an app that never
  configures anything still has one.
- `spamGuard` is `{ honeypotField, timingField, minSubmitSeconds }` (§4d) and
  `autoResponder` is `{ enabled, subject, message }` (§4e). Both default to "off", so
  every app registered before they existed keeps behaving exactly as it did — no
  migration is needed for either.

**sendlogs** — one row per `/v1/send` attempt, with `websiteName`/`destinationEmail`
snapshotted at send time, `kind: "submission" | "autoresponse"` (§4e) and
`status: "sent" | "smtp_failed" | "blocked_bot" | "blocked_spam"` (§4d). 90-day TTL;
read by the owner (§4f) and by admins — see [ADMIN_SPEC.md](ADMIN_SPEC.md). `error`
carries the reason for any non-`sent` row: the provider's own SMTP reply, or which
guard fired and on what evidence.

**dailyusages** — `{ appId, date: "YYYY-MM-DD", count, expiresAt }`, unique on
`{ appId, date }`, TTL on `expiresAt`. The §4c send counter; O(1) forever, unlike
counting `SendLog` rows.

**senddedupes** — `{ key, expiresAt }`, unique on `key` (sha256 of `appId` + the
canonicalised submission), TTL on `expiresAt`. Holds a 60-second idempotency claim
(§4c). Uniqueness is what makes claiming atomic, so the index is not optional.

---

## 8. Deliberately out of step 1

- File attachment handling details (accepted in the flow, spec'd later).
- Secret key rotation.
- Rate limiting / quotas.
- Google/OAuth login.
- User-editable / custom HTML templates — the five built-in designs are
  selection-only (MAIL_TEMPLATES_SPEC.md).
- Multiple / per-app sender accounts — sender is always **our** single account.

---

## 8b. Deployment — Docker (production only)

The app ships as a **production-only** Docker image ([Dockerfile](Dockerfile)):

- Multi-stage build (`deps` → `builder` → `runner`) on `node:20-alpine`, runs as
  a non-root user, final stage is `NODE_ENV=production` running `node server.js`.
- Uses Next.js **standalone** output — this requires `output: 'standalone'` in
  `next.config.js` once the app is scaffolded, otherwise `server.js` won't exist.
- The mail route runs on the **Node runtime** (SMTP sockets), which a plain Node
  container satisfies — do not switch it to Edge.
- Secrets (`SMTP_USER`, `SMTP_PASS`, `AUTH_SECRET`, `MONGO_URI`) are injected at
  **runtime** via env / orchestrator secrets — never baked into the image
  (enforced by [.dockerignore](.dockerignore), which excludes `.env*`).
- No dev-mode / hot-reload container — production build only, by design.

> Not yet buildable: the repo currently holds only the spec. The Dockerfile is
> ready for the moment the Next.js project (with `package.json`) is added.

---

## 9. Note on the archived `new_different_doc.md`

That draft proposed each app sending through **its own** connected mail account
(Gmail OAuth / SMTP per app). This spec **does not** adopt that: the sender is a
single account we own, and the app's configured address is only the **destination**.
Kept in `old/` for reference.
