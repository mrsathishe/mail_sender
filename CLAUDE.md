# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Next.js 15 (App Router) middleware service: a website `POST`s its form
submissions plus a secret key to `/v1/send`, and the service emails them to the
destination inbox configured for that app. Users register apps in a dashboard;
admins manage users/apps/logs. Mail goes out through **one** SMTP account we own
(Gmail today) — the per-app address is the **destination**, never the sender.
The product is branded **Mailer by satz**; every user-visible name, tagline and
contact address comes from [src/lib/brand.ts](src/lib/brand.ts), so the header,
footer, mail footer, OTP subjects and OG card cannot drift.

`docs/` now holds only the deployment playbook — this file plus
[README.md](README.md) are the behaviour documentation, and are expected to be kept in
sync with code changes:

- [docs/VPS_PROJECT_PLAYBOOK.md](docs/VPS_PROJECT_PLAYBOOK.md) — nginx/systemd VPS pattern
- `old/` holds superseded design docs — do not treat them as current

`SPEC.md`, `ADMIN_SPEC.md`, `MAIL_TEMPLATES_SPEC.md` and `HARDENING_ROADMAP.md` were
deleted as no longer needed. Code comments still cite `SPEC §4b` /
`HARDENING_ROADMAP §1.2` as rationale markers for a decision; read those as history
rather than as live documents, and don't recreate a file to satisfy a citation.

## Commands

```bash
npm run dev            # dev server on :3000
npm run build          # production build (standalone output)
npm start              # serve the build
npx tsc --noEmit       # typecheck

npm run setup          # VPS first run: deps, build, .env, install+start systemd unit
npm run deploy         # VPS updates: npm ci, rebuild, systemctl restart mail-sender

node scripts/migrate-app-fields.mjs   # one-off data migration (idempotent)
node scripts/migrate-destination-verification.mjs   # one-off; grandfathers users, gates unproven destinations
node scripts/migrate-sendlog-indexes.mjs            # one-off; builds SendLog TTL + compound index, drops the old one
node scripts/migrate-app-field-ids.mjs              # one-off; App.fields {name,required} -> {id,name}
node scripts/reset-db.mjs --db <name> --yes          # DESTRUCTIVE; drops the 5 collections, needs both flags
node scripts/check-smtp.mjs [to@x.com]              # prove SMTP settings (connect, optionally send)
```

There is **no test suite and no lint config** — `npx next lint` prompts to set
ESLint up interactively, so don't run it. Verification is `tsc --noEmit` +
`next build` + exercising the real endpoints. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))
only runs `npm ci && npm run build`, and only on pushes to the `deploy` branch.

To check mail rendering, sign in and open `/api/templates/<id>/preview` (or the
picker on `/dashboard`) — it renders a design with fixed sample data. The
`Try it` panel on `/docs` sends a real email using an app's secret key (it is
rendered only for signed-in visitors; the rest of `/docs` is public).

Required env vars are listed in [.env.example](.env.example): `APP_URL`,
`AUTH_SECRET`, `MONGO_URI`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, plus optional
`SMTP_PORT` / `SMTP_SECURE` / `SMTP_FROM` / `SEND_APP_DAILY_LIMIT` /
`SPAM_SCORE_THRESHOLD`. `MOCK_MODE` is dev-only and belongs in `.env.development`, not
here (see the mock-database note under Architecture). Port defaults to 587 and `secure` is
inferred from it (465 → implicit TLS) unless set explicitly; `SMTP_HOST` has no
default on purpose, so a missing value fails loudly instead of relaying through
someone else's server. The sending account is a **GoDaddy Professional Email (Pro
Light) mailbox on the root domain** (`mail@satz.co.in`): submission host
`smtpout.secureserver.net` on 465 or 587 (both verified) — *not* the MX host
`smtp.secureserver.net`, which only receives, and not `mail.satz.co.in`, which
resolves to the VPS running this app. The per-mailbox send cap is **not published**,
so treat it as unknown but real (HARDENING_ROADMAP §0); the mailbox also cannot
DKIM-sign, so DMARC alignment rests on SPF alone. Verify settings with
`node scripts/check-smtp.mjs [to@example.com]` rather than by poking the send
endpoint — it needs no DB and prints the provider's own error.

## Architecture

**Auth is two-layered on purpose.** [src/middleware.ts](src/middleware.ts) does a
cheap edge check of the JWT session cookie for `/dashboard` and `/admin` only
(and uses `x-forwarded-host`/`-proto` for redirects, because behind nginx
`req.nextUrl` reports the internal `127.0.0.1:3100` bind address). Sessions live 7
days, so a token's `role` claim is never trusted for privilege: every
`/api/admin/*` route calls `requireAdmin()` in [src/lib/auth.ts](src/lib/auth.ts),
which re-reads the user from the DB. A freshly promoted admin must re-login.
`/api/v1/send` also re-checks that the app owner isn't `disabled`.

**Two different hashing strategies, deliberately.** [src/lib/secret.ts](src/lib/secret.ts)
uses sha256 for API secret keys and reset tokens (high-entropy, needs fast
deterministic lookup by hash); [src/lib/password.ts](src/lib/password.ts) uses
bcrypt for passwords. Secret keys are shown once at creation/rotation and only
their hash is stored.

**The send pipeline** ([src/lib/send-endpoint.ts](src/lib/send-endpoint.ts)):
bearer key → `hashSecret` lookup of the `App` → owner-disabled check →
destination-verified check → `readLimitedBody()` (JSON or form) → **guard-field split
+ bot signals** (`splitGuardFields()` / `checkBotSignals()`) → **field-contract
check** (`validateSubmission()` / `orderSubmission()`) → **content score**
(`checkSubmissionContent()`) → **attachment check** (`checkAttachments()`) →
**duplicate claim** → **daily-quota consume** → `buildEmailBody()`
(plain text) + `renderEmailHtml()` (HTML) + `findReplyTo()` → `sendMail()` →
`SendLog` row on both success and failure (logging is wrapped so it can never affect
the response) → **autoresponse** (§4e, after the `200` is earned). `From:` is always
our own address and the submitter goes in
`Reply-To:` — the reverse is spoofing and fails DMARC. On failure the Nodemailer
`code` / `responseCode` / `response` are captured into `SendLog.error`, because
"sendMail threw" cannot be diagnosed. The routes **must** stay
`export const runtime = "nodejs"` — Nodemailer opens an SMTP socket, which Edge
cannot do.

**The send endpoint is browser-callable, and that is the whole integration story**
([src/lib/cors.ts](src/lib/cors.ts)). The customer is often a frontend with no backend, so
its page calls `/v1/send` directly: the route answers the preflight with `corsPreflight()`
and **every** return path of the pipeline goes through `corsJson()` — including the
failures, because a response without the header is unreadable to the page, which turns
`{ error: "unknown_field", field: "emial" }` into an opaque "CORS error" exactly when the
field name is what's needed. Origins are unrestricted deliberately: CORS only ever
restrained browsers, so an allowlist would break a customer's staging domain while buying
nothing against curl. This means the secret key **is** readable in a client build, and what
bounds a scraped one is the field contract, destination verification and the daily cap — not
its secrecy. Two consequences to keep in mind: a plain `<form action>` still cannot call us
(it cannot set `Authorization`, which is why every example is a `fetch`), and an
nginx-generated error (the per-location `client_max_body_size` `413`, a `502` mid-restart)
carries no CORS headers, so a browser sees an opaque failure where a server reads the
status — the docs say so under **File attachments**.

That pipeline is a **library, not a route**, because the route is a ~10-line shell:
[/api/v1/send](src/app/api/v1/send/route.ts) calls `handleSend(req)` and owns nothing else.
There is **one** send endpoint for JSON and multipart alike, and whether file parts are
kept and whether the 5MB cap applies instead of 500KB is read from the **app's**
`attachments.enabled`, never from the URL. A second `/v1/sendWithAttachment` route existed
for exactly that split — nginx's `client_max_body_size` is per-location, so only the upload
path was raised — and was deleted because the cost landed on the customer: switching the
setting on was not enough, they also had to change the URL their form posted to, and a file
sent to the wrong one was **silently dropped**. `keepFiles` is now unconditional so that
file reaches `checkAttachments()` and is refused by name (`422 attachments_not_enabled`)
instead. The edge cap moved onto the one send location, which means all send traffic passes
a 6m gate and is then held to its real per-app cap in the app; `deploy/nginx.conf` explains
why request buffering stays on rather than streaming.

**Spam defence is two libraries with opposite failure modes** (SPEC §4d).
[bot-guard.ts](src/lib/bot-guard.ts) owns the per-app honeypot and minimum fill time:
the honeypot's *name* is the owner's choice, because one platform-wide reserved name is
one every bot author learns once; its fields are **stripped before** the field contract
runs, so a honeypot is never declared and never reaches the email; and a negative
elapsed time (client clock ahead of ours) **passes**, since a wrong clock isn't evidence
of a bot. [spam-score.ts](src/lib/spam-score.ts) scores content against
`SPAM_SCORE_THRESHOLD` (default 6) and is deliberately *structural*: link volume,
anchor/BBCode markup and mail-header probes do the blocking, while phrase hits are
capped **below** the threshold so vocabulary can only amplify — an SEO agency's own
contact form legitimately receives "we need backlinks". Both refuse with `422` **before**
the quota, so a blocked submission costs the owner nothing, and both write a
`blocked_bot` / `blocked_spam` `SendLog` row with the reason, because a form that has
gone quiet is otherwise unexplainable.

**The autoresponder is the one mail we send to an unproven address** (SPEC §4e,
[auto-responder.ts](src/lib/auto-responder.ts)). Four properties carry that: the
recipient comes only from `findReplyTo()` on the submission (a caller can never name
one), the text is the **owner's** so a leaked key picks the recipient but never the
words, it consumes its **own** quota slot and is the half dropped when the day runs out,
and it runs after the `200` so its failure can't change the caller's result. Blank
subject/message mean "use the built-in wording" rather than storing a copy of it, so
improving the wording reaches every app that never customised it. It renders through
`renderAutoReplyHtml()`, which reads each design's extracted `palette` — one shared
prose layout, not five more renderers.

**Submissions are held to a per-app contract** ([src/lib/fields.ts](src/lib/fields.ts),
SPEC §4b). Each `App` stores `fields: [{ id, name }]` — the **id** its form posts and the
**name** the email row is labelled with — defaulted to name/email/phone/message so
registering one stays a short form. Two values rather than one derived from the other,
because a label guessed from a key can only approximate it: `order-id` titleizes to
"Order id", never "Order ID", and no rule turns `company` into "Company Name". `/v1/send`
refuses an undeclared field with `400 unknown_field`, echoing the field name — a valid key
proves the request came from the app, not that the payload is the form its owner built, so
without this a leaked key mails attacker-chosen content through our own sending domain.
Ids are matched case-insensitively but stored under the declared spelling, and
`orderSubmission()` emits **every** declared field in declared order, **keyed by its
label** (an omitted one renders as `—`), so the destination inbox sees a stable layout
instead of one that shifts with each request.

There is deliberately **no required flag**, and so no `missing_field`: whether a visitor
must fill something in is the website's own check, made with its own wording next to the
input, and an empty value is delivered as empty. Rejecting fields nobody declared is this
service's business; re-litigating a form's UX is not. Renaming that persisted field needed
`scripts/migrate-app-field-ids.mjs`; `resolveFields()` also reads a legacy
`{ name, required }` row as `{ id: name, name: titleize(name) }`, so an app whose migration
hasn't run still sends correctly. The rules live only in `fields.ts` — the API routes and
the dashboard's pre-flight both call `parseFields` itself rather than a hand-written mirror
of it, since a mirror is what drifts.

**Two counters guard the shared mailbox, and both are atomic on purpose** (SPEC §4c).
[send-limit.ts](src/lib/send-limit.ts) enforces `SEND_APP_DAILY_LIMIT` (500/app/UTC
day) by `$inc`-then-compare on a `{ appId, date }` row — check-then-increment lets two
concurrent sends both read 499 and both pass — and **fails closed**, since not knowing
today's count and guessing zero is how an allowance gets blown. [dedupe.ts](src/lib/dedupe.ts)
suppresses an identical submission for 60s via an upsert that only matches an expired
row, so a live claim collides on the unique index rather than passing; it **fails open**,
because a duplicate email is waste but an unsent one is a lost enquiry. Order in the
route matters: dedupe before quota (a double-click costs nothing), quota after body
validation (a customer mid-integration shouldn't burn the day on 400s), and the dedupe
claim is **released on send failure** so a retry after a `502` still delivers while the
quota slot stays spent. The public docs read `env.appDailySendLimit`, so the documented
number cannot drift from the enforced one. An autoresponse takes a **second** slot of
its own (`consumeDailySend` again), so a submission with the reply enabled costs two.

**The request body is bounded by one number per endpoint.** [src/lib/body-limit.ts](src/lib/body-limit.ts)
caps the *total* at `MAX_BODY_BYTES` (500KB) by default and nothing else — a per-field cap was
rejected because N fields at the maximum multiply, so the total is the only real
bound (HARDENING_ROADMAP §1.3). Bytes are counted as they arrive and the stream is
cancelled on overflow; `content-length` is only an early hint, since a client can lie
about it or omit it entirely. The body is read **after** auth, so an unauthenticated
caller never makes us buffer. `MAX_DEPTH` is *not* a size limit: `JSON.parse` accepts
input far deeper than `flatten.ts`'s recursion survives, so without it a 10KB body of
5000 nested arrays returns a 500 instead of a `400`. Never swap
`readLimitedBody()` back to `req.json()`/`req.formData()` — both buffer without a
limit, which is also why the multipart branch re-wraps already-counted bytes.
The cap is an **argument** (`maxBytes`) rather than a constant so an upload-enabled app can
raise it to 5MB without a second reader; `keepFiles` likewise decides whether file parts
are returned or dropped, and the send pipeline always passes `true` so a file posted to an
app with uploads off is refused by name instead of vanishing. `deploy/nginx.conf` keeps
`client_max_body_size` just above the largest cap — 1m server-wide, 6m on `/api/v1/send`
alone; raise that pair together or neither takes
effect. `/api/contact` is deliberately **not** in that list: our own help form takes text
only, and an unauthenticated route is the last one that should be able to hand Node a
multi-megabyte body. The `proxy_set_header` lines live in the `server` block on purpose: setting *any*
of them inside a `location` replaces the whole inherited set, which would silently drop
the forwarded headers middleware depends on.

**Attachments are checked extension-first, then confirmed by the bytes**
([src/lib/attachments.ts](src/lib/attachments.ts)). The declared extension selects a rule
and the leading bytes have to satisfy it — the reverse order (sniff, then trust) cannot
tell `.docx` from `.xlsx` (identical zip magic) or judge `.txt` at all (no magic exists),
while this order still refuses a `.zip` renamed `.pdf`. The `contentType` given to
Nodemailer is the **rule's**, never the client's part header. Archives, `.svg` and legacy
`.doc`/`.xls` are refused for reasons written at the type table, not by oversight.
`safeFilename()` is not cosmetic: the name lands in a MIME header and then on the
recipient's disk, so a path or a CR/LF in it is header injection. It is **opt-in per app**
(`attachments.enabled`, default off) and the raised cap is applied only for such an app —
which is why the `App` is loaded *before* the body is read. A refused file writes a
`blocked_attachment` row and costs no quota; an accepted one still costs a single send.
The autoresponse deliberately carries none of them back. This module stays free of Node
built-ins so the dashboard's client editor can read its constants, like `bot-guard.ts`.

**Integration code is generated per app, not documented once**
([src/lib/snippets.ts](src/lib/snippets.ts), rendered by the "Get the code" button on each
dashboard row). A generic `name`/`email`/`message` example is correct only until an owner
renames a field, after which it produces `400 unknown_field` and reads like our bug — so
both the `fetch` call and the cURL sample are built from that app's real `fields`,
`spamGuard` names and `attachments` setting. There is **one** call snippet, not a server
one and a browser one: since `cors.ts` the request and the reply are identical whoever
sends it, so a second version could only drift. The whole generated `<form>` stays
**dropped** — the markup is the owner's own, and a form we invent is a page they then have
to reconcile with theirs — but the inputs our own guards require are emitted as a real
**Hidden inputs your form needs** block rather than as comments, because a comment is not
runnable code and the honeypot never got added: only the honeypot and the file input are
there, since those two must exist in the DOM to work at all. The **timing** value is set on
the `FormData` in the call itself (`body.set(timingField, Date.now() - shownAt)`), which is
what makes the snippet self-sufficient: writing it into a hidden input meant every
submission answered `422 timing_missing` (and the old `form.elements[...].value =` threw a
`TypeError`) for any owner who turned the guard on without hand-editing their markup. For
the same reason the cURL sample carries a timing value of its own. It posts
`new FormData(form)`, so `attachments` reaches only that block and
cURL's `-F` form, never the call itself. The call reads our reply as **JSON plus a status** — deliberately not a
`303` to a `/thanks` page, because this service is a REST API for servers and browsers
alike and the caller owns what a visitor then sees. Nothing under `/api` ever replies with
a redirect; the only `Response.redirect` in the app is page gating in
[proxy.ts](src/proxy.ts), which answers a browser *navigation*, not an API call.

**Two things are verified by emailed OTP, with one helper.**
[src/lib/otp.ts](src/lib/otp.ts) owns code generation and checking (8 chars from a
32-symbol alphabet minus `I O 0 1`, sha256 at rest, 15-min expiry, 5-attempt cap —
at ~40 bits the *attempt cap* is the control, which is why sha256 is still right);
[src/lib/verification-mail.ts](src/lib/verification-mail.ts) owns the two mails.
`checkOtp()` is pure and returns a reason code — the caller persists the outcome,
because only it knows which document holds the state.

1. **The account address** (SPEC §3a). Registration mails a code and issues a
   session with `emailVerified: false`; [middleware.ts](src/middleware.ts) bounces
   such a session to `/verify-email`. That claim is safe at the edge in one
   direction only — it never goes true→false, and verifying re-mints the cookie —
   but the one action that mails a caller-chosen address, `POST /api/apps`, still
   re-reads the DB through `requireVerifiedUser()` in [auth.ts](src/lib/auth.ts).
   `/verify-email` is deliberately outside the matcher (it's the redirect target),
   and self-heals a stale claim via `POST /api/auth/refresh-session`, which is how
   accounts grandfathered by the migration get past an old cookie.
2. **An app's destination** (SPEC §3e, HARDENING_ROADMAP §1.1). If the destination
   equals the owner's own verified address there is no second check — the server
   compares against the DB email, so the dashboard checkbox is convenience only.
   Otherwise a code goes to that address and the app is created **without a usable
   key**: `secretKeyHash` holds the hash of a key that was generated and thrown
   away, so `POST /api/apps/[id]/verify-destination` rotating the key is what makes
   the app work at all. `/v1/send` returns `403 destination_unverified` meanwhile.

**Mail rendering is split in two.** [src/lib/flatten.ts](src/lib/flatten.ts) owns
data→email conversion, **all** HTML escaping (`toRows()`, `htmlValue()`,
`paragraphsHtml()`) and the header-safe helpers (`sanitizeSubject()`, `findReplyTo()`);
[src/lib/templates.ts](src/lib/templates.ts) owns the 5 designs and nothing else.
When adding or editing a design: build it from the pre-escaped rows (never
re-escape or interpolate raw values), inline styles only, table-based, ≤600px, and
let nested values inherit `color`/`font` so dark palettes stay readable. Note that
a table-level `border-left` is dropped under `border-collapse:collapse` — use a
real stripe cell (see the `accent` design). Designs are **selection-only**: an app
stores a `templateId` and users pick/switch, never edit. Each design also carries a
`palette`, which its own renderer reads for the page/text colours (so the two can't
drift) and which `renderAutoReplyHtml()` uses to render the autoresponse — that mail is
prose rather than rows, so it is one layout parameterised by palette, not a sixth design.

One rule holds the two halves together: a submission's **top-level keys are already the
row labels** by the time either renderer sees it (`orderSubmission()` keys by each declared
field's label), so `buildEmailBody()` and `toRows()` print them verbatim and only *nested*
keys go through `titleize()`. That is why `/api/contact` builds its own data keyed
`Name`/`Email`/`Subject`/`Message`, and why `PREVIEW_DATA` is keyed the same way — a
renderer that titleized the top level would rewrite the owner's own wording, turning
`Order ID` into `Order id`. `findReplyTo()` is therefore called on the submission **as
posted**, not on the labelled copy: a label like "Where can we reach you?" is not a name it
can recognise, while the declared id (`email`) is exactly what it looks for.

**The public docs have one source, three renderings.** [src/lib/api-docs.ts](src/lib/api-docs.ts)
holds the API documentation as typed *blocks* (`prose` / `code` / `endpoint` /
`table`); [/docs](src/app/docs/page.tsx) renders each block with its own component
(so `CodeBlock` keeps its copy button and tables keep `.doc-table`), while
[/docs.md](src/app/docs.md/route.ts) and [/llms.txt](src/app/llms.txt/route.ts)
emit the markdown equivalents for AI agents. Add or edit docs **only** in
`api-docs.ts` — writing prose directly into the page reintroduces drift. The
content is a TS module rather than a root `.md` file because `output: "standalone"`
only copies files reachable through imports, so an fs-read markdown file would be
absent in production. All three build their absolute URLs with
[baseUrlFrom()](src/lib/base-url.ts), for the same forwarded-header reason as
middleware.

**Env access is lazy** ([src/lib/env.ts](src/lib/env.ts)): getters that throw only
when a value is read at request time, so a missing var never breaks the build.
Mongoose connections are cached on `global` ([src/lib/db.ts](src/lib/db.ts)) to
survive dev hot-reloads; every route calls `connectDB()` itself.

**Dev runs on a mock database, and the swap is a whole-model swap** (`MOCK_MODE`,
[src/mocks/](src/mocks/)). There is no MongoDB reachable from a dev machine here, so
`next dev` would otherwise not start: with the flag on, each of the five files in
`src/models/` exports the in-memory collection from
[mock-db.ts](src/mocks/mock-db.ts) instead of its Mongoose model, seeded from
[mock-data.ts](src/mocks/mock-data.ts) — the one file to edit to change what a mock run
contains. **No route, page or lib knows the setting exists**: they keep calling
`App.find(...)` and `user.save()`, which is the whole reason the swap sits at the model
boundary rather than as a branch per handler — a second code path through twelve routes is
one that drifts from the real one. `connectDB()` becomes a no-op and the mailer switches to
nodemailer's `jsonTransport` (printing the mail, which is how an OTP is "received" with no
inbox), so a local run cannot send from the production mailbox by accident.

Three things carry it. Ids in the mock data are **24-hex**, because every per-app route
guards with `isValidObjectId` and would 404 anything else. Password hashes are real bcrypt
and the pending OTP is a real `hashOtp()`, so `verifyPassword`/`checkOtp` run unmodified.
And the query engine implements exactly what the app calls, with `unsupported()` throwing
by name for anything else — a mock that silently returns the wrong rows is worse than no
mock. `save()` on a mock document is a deliberate no-op: the record *is* the stored object,
so the mutation has already landed.

The switch is a **file**, not a flag to remember: `MOCK_MODE=1` lives in
`.env.development`, which Next loads for `next dev` and never for `next build`/`next start`,
and `env.mockMode` additionally requires `NODE_ENV === "development"`. It returns `false`
rather than throwing in production precisely because `next build` does read that file while
compiling — throwing there would fail a correct build over a dev file doing its job. Not
covered, because they need real mail rather than a database: registration, email
verification, password reset, and `/v1/send` end to end.

**One shell for every page, and two public pages** (SPEC §5b).
[layout.tsx](src/app/layout.tsx) renders `SiteHeader` → `<main id="main">` →
`SiteFooter` plus a skip link, so the nav exists once instead of in each area's own
`.topbar`; pages contribute only a [PageHeader](src/components/PageHeader.tsx). The
header reads the session, which is what makes every route render dynamically — they
effectively already did behind `next start`. `/` is a public marketing page (it
redirects signed-in visitors to `/dashboard`) because with the dashboard behind a
login wall there was nothing for a crawler to index; its JSON-LD must keep mirroring
the visible copy. It is deliberately short — hero, who it's for, features, who it's not
for, live-on, CTA — because the how-it-works steps, the `curl` block, the sample email and
the example dashboard row each restated something `/docs` or the dashboard already owns.
The two "who" sections carry no eyebrow label (`Section`'s `label` is optional) since
their headings already name them, and **live-on comes last**: proof reads better after
the pitch it is proof of. Client logos go in `public/logos/` rather than hotlinked from
the client's own site, whose asset paths carry build hashes. The one claim on this page
that needs care is "Nothing delivered is stored" — true as scoped, because a `sent`
`SendLog` row holds no submission fields, while a `blocked_spam` row does keep the
matched keywords ([spam-score.ts](src/lib/spam-score.ts)) and `blocked_attachment` a
filename. Widening it to "no mail content is stored" would make it false.

[`/contact`](src/app/contact/page.tsx) is the other public page: contact details, a
help form, and the **FAQ that used to sit on `/`** — moved there with its `FAQPage`
JSON-LD, since that data has to mirror the page it is on. Its form posts to
[`/api/contact`](src/app/api/contact/route.ts), which is internal (never added to
`api-docs.ts`) and is the one unauthenticated route that mails on a stranger's request,
so it reuses the send pipeline's guards in the same order — body cap, honeypot + fill
time, strict `zod` contract, content score, then two 60s `claimSubmission()` claims
(one per client IP → `429`, one per body → `200 { duplicate: true }`). A send failure
releases **both**, so a retry is neither blocked nor swallowed. It takes **text only** —
no file input, `readLimitedBody(req)` on its default 500KB cap with file parts dropped —
because the one route a stranger can make us mail from is the wrong place to accept
uploads. It writes no `SendLog`
row: that collection is one row per *app* send and has no `appId`/`userId` to use here.

Titles come from the `%s · Mailer by satz` template; the three public pages set a
description, canonical and Open Graph block, and every authed or auth-flow page gets
`robots: { index: false, follow: false }` from `privateMetadata()` in
[seo.ts](src/lib/seo.ts) — one helper, because `robots.txt` only asks a crawler not to
fetch and cannot keep a linked-to page out of an index. The four `"use client"` auth
pages carry that metadata in a route `layout.tsx`, which is the only place a client
page can.

**Logo assets, and the one trap in them** ([public/](public/)). The logo is the
designer's raster artwork and nothing else: `logo-mark.png` (512×313) is what the
header loads, `logo-lockup.png` (1035×950, mark + wordmark) drives the landing hero
via `next/image` — so the 441KB source is served as a sized AVIF/WebP — and the OG
card. The earlier hand-drawn `logo.svg` / `logo-mark.svg` approximations were
**deleted** for not matching the real mark; don't reintroduce a redrawn stand-in. The
trap: in that artwork the envelope's fold lines are **transparent holes, not white
paint**, so anything compositing it onto a dark background paints them dark and the
envelope stops reading as an envelope. Every dark surface therefore puts it on a light
plate — the header and hero under `prefers-color-scheme: dark`, the OG card,
`icon-512.png`, `src/app/apple-icon.png`. It cannot be converted to real SVG (there is
no vector information in a raster gradient to recover); a true vector needs the
original design file.

**Site CSS is one file with role tokens** ([globals.css](src/app/globals.css)).
Components never reach for `--red` directly: `--accent` is tuned for text on the page
background and `--btn-bg`/`--btn-text` for text on a fill, which is why dark mode can
lift the brand red for links while keeping a darker fill under white text. Dark mode
covers **site chrome only** — mail designs keep fixed palettes, since an email is
rendered once and read in someone else's client. The design preview iframe is
collapsed by default and sized from each design's `previewHeight`: it is served with
`sandbox=""` and `default-src 'none'`, so nothing inside can report its own height,
and one shared height clipped the taller designs.

**Client/server split in the dashboard.** Server pages read the session and pass
data down; e.g. [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx) imports
`TEMPLATE_LIST` and passes it to the client `AppsManager`, so design markup and
render functions never reach the browser bundle. It also passes `baseUrl` from
`baseUrlFrom(await headers())`, because the generated snippets are meant to be pasted
into somebody else's project and so need an absolute URL — the same forwarded-header
reason as middleware. [CodeBlock](src/components/CodeBlock.tsx) sits in `components/`
rather than under `docs/` now that both the public docs and the dashboard render it.
Import via the `@/*` → `src/*` alias.

**Registration is its own page, and an app row is one action at a time.**
[/dashboard/register](src/app/dashboard/register/page.tsx) → `RegisterApp` replaced the card
that used to sit above the app list, because the three optional settings were only reachable
*after* creation from the row's menu, so most apps never got them; the register page offers
every one before the key exists, which is also why `POST /api/apps` now accepts `spamGuard`,
`autoResponder` and `attachments` (through the same parsers PATCH uses, so a setting saved at
registration is validated exactly like one edited later). Its sections are all on one page
rather than one-at-a-time behind a Next button: the flow is linear but not sequential, and
an owner who wants only the defaults should be able to see that the rest is optional and
scroll past it. The row itself now carries a single **Actions** `<select>` that becomes
**Cancel** while a panel is open — "only one open" is a property of the state's shape (one
`action`, one `draft`) rather than something eight buttons each had to remember. A newly
issued key renders **inside its own row** (`secretCard`), not in a card at the top above
whichever app you were not looking at.

**The activity panel is always on, and its rows live in a modal**
([ActivityPanel](src/app/dashboard/ActivityPanel.tsx) →
[ActivityModal](src/app/dashboard/ActivityModal.tsx)). "Did my form work" is the question an
owner arrives with, so the four counts are rendered unprompted at the bottom of every row
that has a key — and only those: before the destination is confirmed nothing could have been
sent. Nothing polls (a send happens whenever a visitor submits, so any interval would be a
guess); there is a refresh button instead. The table moved behind **More info** into a
dialog because filters and an export need room the row hasn't got, and it is `createPortal`ed
to `body` for two reasons: the `@media print` block that *is* the PDF export works by hiding
every other child of `body`, and a fixed backdrop nested in the row would be at the mercy of
its `overflow`. `GET /api/apps/[id]/logs` gained `from`/`to`/`status` filters and `all=1`,
capped at `EXPORT_MAX_ROWS` with a `truncated` flag the dialog surfaces — an unbounded read
of a collection that only grows is the thing being avoided, and a silently partial export is
worse than a refused one. `counts` and `today` stay whole-app figures even when the rows are
filtered, because they are the panel's headline rather than the table's summary. CSV is built
in the browser (quoted, and formula-injection prefixes escaped); PDF is the browser's own
"Save as PDF", which is why no PDF dependency was added.

**Password reset** ([forgot-password](src/app/api/auth/forgot-password/route.ts) →
[reset-password](src/app/api/auth/reset-password/route.ts)): a random token is
emailed in plaintext through the same mailer, only its sha256 hash plus a 30-minute
expiry are stored on the user, and both fields are cleared on use. Forgot-password
always returns the same response whether or not the email exists.

## Data model (5 collections, [src/models/](src/models/))

- **User** — `email`, `passwordHash`, `role: "user" | "admin"`, `disabled`,
  `emailVerified` + `emailOtp*` (registration OTP),
  `resetTokenHash`/`resetTokenExpiresAt`. Deleting a user cascades their apps and
  logs; `disabled` is the reversible alternative. The **first** admin must be
  promoted directly in the DB — after that the admin Users page can promote/demote.
- **App** — `userId`, `websiteName`, `destinationEmail` (any provider),
  `destinationVerified` + `destinationOtp*` (destination OTP), `templateId`
  (design enum, default `card`), `fields` (`[{ id, name }]` — posted key plus row label,
  default name/email/phone/message), `spamGuard` (`{ honeypotField, timingField,
  minSubmitSeconds }`, all off), `autoResponder` (`{ enabled, subject, message }`,
  off), `attachments` (`{ enabled, maxFiles }`, off), `secretKeyHash`. The last three
  default to "off", which is why they need no
  migration; they are edited per app **after** registration, so registering one stays
  a short form.
- **SendLog** — one row per `/v1/send` attempt, with `websiteName`/`destinationEmail`
  snapshotted at send time, `kind: "submission" | "autoresponse"` and
  `status: "sent" | "smtp_failed" | "blocked_bot" | "blocked_spam" | "blocked_attachment"`;
  `error` holds the
  reason for any non-`sent` row (the provider's SMTP reply, or which guard fired).
  Rows expire after
  `SEND_LOG_TTL_DAYS` (90) via a TTL index on `createdAt`, which is *ascending* so it
  also serves the admin view's `sort({ createdAt: -1 })`; per-app history uses
  `{ appId: 1, createdAt: -1 }` and is read by the owner's own Activity panel
  (`GET /api/apps/[id]/logs`) as well as by admins. Index changes need
  `scripts/migrate-sendlog-indexes.mjs` — `autoIndex` builds new indexes but never
  drops superseded ones.
- **DailyUsage** — `{ appId, date: "YYYY-MM-DD", count, expiresAt }`, unique on
  `{ appId, date }`, TTL on `expiresAt`. The per-app send counter; the unique index is
  what makes the upsert safe under concurrency, not an optimisation.
- **SendDedupe** — `{ key, expiresAt }`, unique on `key`, TTL on `expiresAt`. The 60s
  idempotency claim. Same point: uniqueness *is* the locking mechanism.

## Deployment

The live deployment is the **VPS path**: systemd runs `next start` on
`127.0.0.1:3100` as the user, from the clone in their home folder, reading secrets
from the repo's `.env` (`EnvironmentFile`); nginx reverse-proxies the domain to it.
`deploy/mail-sender.service` is reference only — `npm run setup` generates the real
unit. This is why middleware must use forwarded headers for redirects.

`Dockerfile` and `k8s/` also exist as alternative targets and both depend on
`output: "standalone"` in [next.config.ts](next.config.ts) — removing it breaks
them. Secrets are always injected at runtime, never baked in.

## Conventions worth matching

- Errors are machine-readable codes, not prose: `{ error: "invalid_key" }` with
  401/400/404/502. `/v1/send` returns `200` on success (it awaits the provider before
  answering, so the mail really has gone out by then).
- Public API responses never leak internals; user-scoped routes filter by
  `userId: session.userId` so ownership is enforced in the query itself, and guard
  ids with `isValidObjectId` before querying (a malformed id would otherwise throw
  a CastError 500).
- Comments explain *why* (proxy header quirks, hash choice, runtime pinning), not
  what. Match that density rather than adding narration.
- Renaming a persisted field requires a migration in `scripts/` plus README deploy
  steps — schema changes alone leave existing documents unreadable. Run migrations
  with the service stopped: `systemctl stop` → `npm ci` → migrate → `npm run deploy`.
