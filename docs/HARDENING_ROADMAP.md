# Mailer by satz — Hardening & Roadmap

> What this service still needs, as of 2026-07-29. Companion to
> [SPEC.md](SPEC.md), which describes what it *is* and how the shipped parts behave.
>
> **This document tracks open work only.** Completed items are listed as one-line
> entries in §7 — their behaviour is documented in SPEC.md and CLAUDE.md rather than
> here. Section numbers are stable: code comments cite them (`HARDENING_ROADMAP §1.3`),
> so shipped numbers are retired into §7 rather than reused.

---

## 0. Decisions that frame the rest

**Sending model: shared sender, permanently.** We own the transport, always: the
address a user configures is the **destination**, and mail leaves from our own
account. Every abuse report therefore lands on us; that is the price of zero-setup
onboarding, which is the actual differentiator, and it is accepted rather than
mitigated by pushing sending back onto the customer.

Two alternatives are **rejected, not deferred**:

- **Generic BYO-SMTP as an upgrade tier (§4.1).** It would have offloaded reputation
  to heavy users, but it buys that by making us a credential vault — a breach that
  today leaks bcrypt and sha256 hashes would instead leak the ability to send mail
  *as* customers, and it needs envelope encryption, key rotation and a
  "provider revoked the token at 3am" story before it can ship at all. Not worth it
  for a product whose whole pitch is that the user configures nothing.
- **Gmail/Outlook OAuth (send as the user's own mailbox).** `gmail.send` sits in
  Google's *sensitive* scope tier (consent screen, review, weeks), and Microsoft 365
  has killed basic-auth SMTP so Outlook means OAuth or nothing. Worse, neither
  actually offloads abuse: Google sees one OAuth client ID across all accounts, so
  the blast radius just moves from our IP to our OAuth app — where a suspension cuts
  off every customer at once instead of degrading gradually.

Two consequences follow, and both are load-bearing:

1. **Abuse control is entirely ours.** There is no tier a bad customer can be moved
   to, so destination verification (§1.1, shipped), the volume guard (§1.2) and the
   bot + content guards (§4.4/§4.5, shipped) are the only defences that will ever
   exist.
2. **`sendMail()` must stay the single swappable choke point** — not for a BYO tier
   now, but because the *provider* still has to move (§1.4) when volume or
   deliverability forces it.

**Keys: staying with one server-side secret key.** The public/browser-key model is
deferred, not adopted (§3).

**Limits: free to users, with one published number.** No per-plan quotas and no
pricing tiers — but a **flat 500 sends per app per UTC day**, stated in the public
docs rather than hidden, so a customer can see the ceiling instead of discovering it
(§1.2, SPEC §4c). A real contact form never approaches it, so nobody should meet a
limit through their own normal usage; it exists to contain one runaway app. It is a
setting, raised per customer on request. The **platform**-wide budget with fair-share
containment is still owed on top of it (§1.2).

**Sender: GoDaddy Professional Email (Pro Light) on the root domain.**
`mail@satz.co.in` via `smtpout.secureserver.net` (465 or 587, both verified). A
dedicated sending subdomain was considered and deliberately skipped: nothing else
currently sends from `satz.co.in`, which is what makes the shared reputation
tolerable. Revisit when it carries mail that matters — a subdomain needs only
SPF/DKIM records, no mailbox.

**The sending cap is unpublished.** The plan page states no per-mailbox limit, and
GoDaddy's help pages could not be checked from the dev environment. Treat it as
*unknown but real* — providers throttle whether or not they advertise a number, and
bulk sending is restricted by the acceptable-use terms regardless. Consequence for
§1.2: the budget is a conservative env var, and the provider's own refusal is what
calibrates it, not a figure we guessed.

---

## 1. Blockers — before any real user touches this

### 1.2 Volume guard — per-app cap shipped, platform cap still open
**Decided and built:** a **per-app limit of 500 sends per UTC day**
(`SEND_APP_DAILY_LIMIT`, atomic `$inc` on a `DailyUsage` row keyed `{ appId, date }`,
`429 daily_limit_exceeded` past it) plus 60-second duplicate suppression (§2.5). Both
are published in the public docs, which read the configured value rather than repeating
a number. That closes the single-app runaway: a looping form or a scripted key now
stops at 500 instead of running until the mailbox throttles. SPEC §4c.

**Still open, and now the actual blocker: there is no cap on the *platform*.**
500/app/day is *above* what one shared mailbox can deliver in total (§0 — the real cap
is unpublished but "a few hundred"), so two busy apps, or a handful of average ones,
can still exhaust the account between them and take down every app *plus* our own OTP
and password-reset mail, which share it. The per-app cap bounds each tenant; it does
not bound the sum. What remains:

1. **Global daily budget.** A second scope on the same collection
   (`{ date, scope: "platform" }`), same atomic `findOneAndUpdate($inc, { upsert: true })`
   — O(1), no scanning. Prefer it over `SendLog.countDocuments`, which grows more
   expensive as the log does even with the index shipped in §2.4. Past the budget,
   shed with `503 capacity_exceeded` and log loudly. This is the number that has to be
   conservative, because it is the one the provider enforces against us.
2. **Fair share on top of the flat cap.** Also cap any single app at a percentage of
   the day's *remaining* platform budget (~20%), so the first app awake can't drain the
   day before the others start. The flat 500 bounds a tenant; fair share bounds a
   tenant *relative to what's left*.
3. **Per-app burst** (~10/min) — invisible to a human filling a form, fatal to a
   loop, and it catches runaway JS in seconds rather than after 500 emails.
4. **Account-scoped limit on the mail-sending endpoints.** Three routes send an
   email on request: `POST /api/apps` (destination code),
   `POST /api/apps/[id]/resend-verification`, and
   `POST /api/auth/resend-verification-email`. All are session-authenticated, so the
   limit belongs on the **user**, and none is covered by the per-app send cap. The
   resends are the cheapest abuse — one unverified account can pump them.
5. **A circuit breaker to learn the real ceiling.** §2.2 already captures the
   provider's exact SMTP reply, so when GoDaddy refuses with a rate-limit response
   (typically `4xx`/`5xx` wording about too many messages), stop sending for the
   remainder of the day and surface it. That discovers the limit from the provider's
   own words instead of probing for it with test mail, which is the fast way to get
   flagged.

Implementation notes worth not rediscovering — the shipped per-app counter already
follows all of these: `$inc` **then** compare the returned count; check-then-increment
lets two concurrent sends both pass. A refused request has then already consumed a
slot; leave it consumed rather than decrementing, since biasing toward under-sending is
correct when the downside is account suspension. Count failures too: an `smtp_failed`
still spent a provider interaction. Counter rows carry a TTL so they self-clean. The
one place the shipped code deliberately departs from the original sketch: the quota is
consumed **after** body validation, not before, so a customer still wiring their form
up doesn't burn the day on requests that were never going to send — a scripted key
posts valid bodies anyway.

One consumer to keep in view when the platform half lands: the autoresponder (§4.2,
shipped) makes a submission cost **two** sends, not one. It already takes its own slot
and is the part that gets dropped when the day runs out, so a global budget only has to
count slots — but the arithmetic for "how many submissions does 500 buy" is no longer
one-to-one for apps that enable it.

### 1.4 Still a mailbox, not a relay *(config and DNS, not code)*
The transport is already parameterised (§7), so this is now operational work. A
mailbox — even on our own domain — gives us: an unpublished but real send cap (§0), a
shared outbound IP, **no DKIM signing**, and no bounce or complaint webhooks. No DKIM
means DMARC can only ever align via SPF, so any forwarding of a submission breaks
authentication, and we are blind to the exact signal — complaint rate — that decides
whether the sending account survives.

Outstanding actions:

- Publish **SPF** on `satz.co.in` (`v=spf1 include:secureserver.net -all`, merged
  into any existing SPF TXT — two SPF records is a hard fail).
- Publish **DMARC** at `_dmarc.satz.co.in`, `p=none` with `rua=` while SPF-only.
- Move to a **relay** (Resend first, SES if volume makes cost matter) when volume or
  deliverability justifies it. That restores DKIM and delivery events, and turns the
  budget in §1.2 from a hard wall into a cost dial.

---

## 2. High value, cheap

### 2.5 No duplicate/replay protection — **shipped** (§7)
Moved to §7. The number is kept as a heading because other sections and code
comments cite it.

---

## 3. Key model — decided: server-side secret key

The key stays a **secret**, used from the customer's backend. `/v1/send` is
server-to-server only: the key travels in an `Authorization` header, which a plain
HTML form cannot set, and putting it in page JavaScript would publish it. **Browser
calls are not served, and no browser-facing headers will be added for them** — that
is settled, not parked.

The public-key model (rename the field so nobody mistakes it for a secret, accept
that it is visible in page source, and defend the endpoint with a per-app origin
allowlist + per-app quota + captcha instead) is the honest alternative and matches
static-site customers, but it is not being built. Revisit only if a real customer
needs a static-site integration; it would then have to ship *with* §1.2 and the
allowlist, because a public identifier with no quota is an open relay. Note it would
also need a browser-callable shape — a plain form POST, since header auth is
impossible from a form — which is a second reason it is a bundle, not a rename.

Note the consequence under a permanently shared sender (§0): `From:` is *always*
ours, so an exposed key can never become the customer's spoofing problem — it is only
ever ours, which is why the allowlist and quota would be the whole defence.

The docs no longer contradict this decision (§7).

---

## 4. Product features worth adding

### 4.1 Generic BYO-SMTP as an upgrade tier — **rejected** (§0)
Kept as a numbered section because code comments cite it. Per-app host / port / user
/ password would have moved heavy users off our sending reputation, but it makes us a
credential vault: today a breach leaks bcrypt and sha256 hashes, whereas this leaks
the ability to send mail *as* customers, so envelope encryption with a KMS-held key,
credential rotation and a "provider revoked the token at 3am" story all become
mandatory. That is a large surface to own for a product whose pitch is that the user
configures nothing — and it also splits every abuse control down two paths.

Sending stays shared: the address a user gives is the destination, never the sender.
`sendMail()` still stays the single choke point, but for the provider move in §1.4,
not for a per-app transport config.

### 4.2 Autoresponder — **shipped** (§7)
Moved to §7. Kept as a heading because §1.2 and code comments cite it.

### 4.3 Webhooks / additional destinations
The same submission forwarded to Slack, Discord, or a customer URL. Widens the
product beyond email — and unlike email, it doesn't consume the sending allowance.

### 4.4 Honeypot + submission timing — **shipped** (§7)
Moved to §7. Kept as a heading because §0 and code comments cite it.

### 4.5 Content spam filtering — **shipped** (§7)
Moved to §7. Kept as a heading because §0 and code comments cite it.

### 4.6 Per-app analytics for users — **shipped** (§7)
Moved to §7. Kept as a heading because §2.4 cites it.

### 4.7 Captcha as a last resort
Still open, and deliberately last: §4.4 and §4.5 were built first because they cost
the visitor nothing. Only worth adding for an app that is being targeted *specifically*
— a per-app switch, never platform-wide, since a captcha is a tax on every real
visitor to stop a machine.

---

## 5. Structural

### 5.1 `sendMail` blocks the response
The route awaits the full SMTP handshake, so a slow provider means a slow form
submit — and with the autoresponder on (§4.2) it awaits two. Once volume justifies it,
accept and process from a queue — the `202` we already return makes that a
non-breaking change.

### 5.2 No test suite
`tsc --noEmit` and `next build` are the only automated checks. Verification of the
recent work was done with **throwaway** harnesses (compile a lib file, drive it,
delete it) covering `otp.ts`, `findReplyTo()` and `body-limit.ts` — the logic was
exercised, but nothing guards it against regression. Those harnesses should become a
committed suite, starting with: `flatten.ts` escaping, `findReplyTo()` header safety,
`body-limit.ts` (especially the lying-`content-length` case), and whatever
rate-limit arithmetic §1.2 introduces.

### 5.3 Second DB roundtrip per send
The owner-disabled check is on the hot path. Denormalize `ownerDisabled` onto `App`
when an admin toggles it, or consciously accept the cost.

---

## 6. Suggested sequencing

1. **§1.2 platform half** — the last launch blocker. The per-app cap shipped, but
   nothing bounds the *sum*, and 500/app/day already exceeds one mailbox's total
   capacity (§0) — more so now that an autoresponse costs a second send (§4.2).
2. **§1.4 DNS half** (SPF + DMARC) — minutes of work, no code.
3. **§5.2** once §1.2's platform arithmetic exists, since that is the first logic
   where a silent regression would be expensive. The spam scoring in §4.5 wants the
   same suite: its weights are a judgement call that should not drift unnoticed.
4. **§5.1** (queue the send) before §4.3 — with the autoresponder shipped, a
   submission can now await two SMTP handshakes inside one request.
5. The relay move in **§1.4** whenever volume or deliverability forces it — with
   BYO-SMTP rejected (§0), this is the only remaining transport work.

---

## 7. Shipped

Retired section numbers, kept because code comments cite them. Behaviour is
documented in [SPEC.md](SPEC.md) and [CLAUDE.md](../CLAUDE.md).

| § | What shipped |
|---|---|
| **§1.1** | Destination verification by emailed OTP — [otp.ts](../src/lib/otp.ts), [verification-mail.ts](../src/lib/verification-mail.ts). Account address verified at registration (`/verify-email`, middleware-gated, `requireVerifiedUser()`); an app's destination verified by code unless it *is* the owner's own address. An unconfirmed app holds the hash of a discarded key, so it has no usable key at all; `/v1/send` returns `403 destination_unverified`. Migration grandfathers existing users. SPEC §3a, §3e. |
| **§1.3** | Request body bounded by one knob — [body-limit.ts](../src/lib/body-limit.ts), `MAX_BODY_BYTES` 500KB, counted as bytes arrive and cancelled on overflow (`content-length` is only an early hint). No per-field cap: N fields at the maximum multiply, so the total is the only real bound. `MAX_DEPTH` guards `flatten.ts`'s recursion, where a 10KB deeply-nested body used to return a 500. `deploy/nginx.conf` tightened 25m → 1m. SPEC §4a. |
| **§1.4** *(code half)* | Transport parameterised — `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_FROM`, no provider pinned in code, `sendMail()` still the single choke point. Plus [scripts/check-smtp.mjs](../scripts/check-smtp.mjs) to prove settings without a running app. The operational half stays open above. |
| **§2.1** | `Reply-To:` set to the submitter via [`findReplyTo()`](../src/lib/flatten.ts) — top-level string fields only, explicit `reply_to`/`email` preferred, and values containing whitespace, CR/LF, commas or angle brackets rejected because this lands in a header. `From:` stays ours; the reverse is spoofing and fails DMARC. |
| **§2.2** | SMTP failures record `code \| responseCode \| message \| response` into `SendLog.error` instead of the literal `"sendMail threw"`. |
| **§2.4** | `SendLog` retention + hot-path index — 90-day TTL on `createdAt` (ascending, so it also serves the admin view's `sort({ createdAt: -1 })`) and `{ appId: 1, createdAt: -1 }` for per-app history (§4.6). [scripts/migrate-sendlog-indexes.mjs](../scripts/migrate-sendlog-indexes.mjs) builds both and drops the superseded single-field `appId` index, which `autoIndex` would leave behind. |
| **§3** *(doc half)* | Docs match the server-side-key decision: the browser-`fetch` HTML form example in [api-docs.ts](../src/lib/api-docs.ts) is replaced by a form posting to the customer's own route plus the route that forwards it, the auth section states the endpoint is server-to-server only, and SPEC §1/§2/§3c say the same. The *decision* in §3 stays open for revisit. |
| *(new — no prior §)* | Per-app **field contract** — [fields.ts](../src/lib/fields.ts). Each app declares `[{ name, required }]` (default name/email/phone/message) and `/v1/send` refuses an undeclared field with `400 unknown_field` and a missing required one with `400 missing_field`. Shrinks the blast radius of a leaked key from "mail anything to the destination" to "mail this form's fields", which is why it matters to the §3 decision. Rows are emitted in declared order so the destination's layout is stable. SPEC §4b. |
| **§2.5** | Duplicate/replay suppression — [dedupe.ts](../src/lib/dedupe.ts) + [SendDedupe](../src/models/SendDedupe.ts). sha256 of `appId` + the canonicalised (already field-ordered) submission holds a 60s claim; a repeat answers `202 { duplicate: true }` with no second email. Atomic by construction: the upsert only matches an already-expired row, so a live claim collides on the unique index instead of passing — check-then-insert would let two double-click requests both through. Released on send failure, so a legitimate retry after a `502` still delivers, and it never consumes a quota slot. Fails **open**: a duplicate email is waste, an unsent one is a lost enquiry. SPEC §4c. |
| **§1.2** *(per-app half)* | Per-app daily cap — [send-limit.ts](../src/lib/send-limit.ts) + [DailyUsage](../src/models/DailyUsage.ts). 500 sends per UTC day from `SEND_APP_DAILY_LIMIT`, atomic `$inc` on `{ appId, date }`, `429 daily_limit_exceeded` past it, TTL'd counters. Increment-then-compare and fail-closed. Published in the docs, which read the configured value. The **platform** cap stays open above — this bounds each tenant, not the sum. SPEC §4c. |
| **§4.4** | Bot signals — [bot-guard.ts](../src/lib/bot-guard.ts). Per-app honeypot (the *owner* names the field, so there is no platform-wide name for a bot author to learn) plus a minimum fill time read from an elapsed duration, an epoch stamp or an ISO date; `422 honeypot_filled` / `too_fast` / `timing_missing`, refused before the quota is touched. Guard fields are stripped before the §4b contract runs, so a honeypot is never declared and never reaches the email. A negative elapsed time (client clock ahead) passes on purpose. SPEC §4d. |
| **§4.5** | Content scoring — [spam-score.ts](../src/lib/spam-score.ts). Link volume, anchor/BBCode markup, mail-header probes, a small phrase list and shouting, against `SPAM_SCORE_THRESHOLD` (default 6) → `422 spam_rejected`, score and reasons kept in the log row rather than returned. Structural signals do the blocking: phrase hits are capped **below** the threshold on purpose, because a false positive is a lost enquiry nobody hears about while a missed spam is one unwanted email. SPEC §4d. |
| **§4.2** | Autoresponder — [auto-responder.ts](../src/lib/auto-responder.ts) + `renderAutoReplyHtml()`. Per-app opt-in with owner-editable subject/message (blank = built-in wording, so improving it reaches every app), rendered from the chosen design's extracted `palette`. Sent only to the address `findReplyTo()` found in the submission, carrying no submitted content — a leaked key can pick the recipient, never the words. Takes its **own** quota slot, is the part dropped when the day runs out, and runs after the `202` so its failure can't change the caller's result. SPEC §4e. |
| **§4.6** | Per-app activity for owners — `GET /api/apps/[id]/logs` + the dashboard's Activity panel. Status counts, today's usage against the limit, and the newest rows with the provider's own error or the guard's reason; scoped by `userId` in the query itself. `SendLog` gained `kind: submission \| autoresponse` and the `blocked_bot` / `blocked_spam` statuses — all additive, so no migration. SPEC §4f. |
