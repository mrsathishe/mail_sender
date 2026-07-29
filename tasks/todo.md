# Todo — HARDENING_ROADMAP §4.2, §4.4, §4.5, §4.6

Scope agreed with the user (§2.5 is already shipped — skipped):

- **§4.2 Autoresponder** — per-app opt-in, owner-editable subject + message, sent to
  the submitter's address only, counts against §1.2's daily quota.
- **§4.4 Honeypot + timing** — per-app config (the honeypot's *name* is the
  customer's own choice), both off by default.
- **§4.5 Content spam filtering** — score the submission; past the threshold refuse
  with `422` and log it so the owner can see it in §4.6.
- **§4.6 Per-app analytics** — the owner can read their own app's send history and
  counts, not just admins.

## 1. Libraries (rules live here, routes defer)

- [x] `src/lib/bot-guard.ts` — `SpamGuard` type, `resolveSpamGuard()`,
      `parseSpamGuard()`, `splitGuardFields()` (strip guard names before the field
      contract sees them), `checkBotSignals()` → `honeypot_filled` / `too_fast` /
      `timing_missing`
- [x] `src/lib/spam-score.ts` — `scoreSubmission()` over every string value:
      links, anchor/BBCode markup, mail-header probes, keyword amplifiers (capped so
      keywords alone can never block), shouting. `env.spamScoreThreshold` (default 6)
- [x] `src/lib/auto-responder.ts` — `resolveAutoResponder()`, `parseAutoResponder()`,
      default subject/message, `buildAutoReply()` (text + html + subject)
- [x] `src/lib/templates.ts` — per-design `palette` + `renderAutoReplyHtml()`, so the
      acknowledgement matches the app's chosen design without five more renderers
- [x] `src/lib/send-limit.ts` — `peekDailySend()` (read-only, for the activity panel)

## 2. Data model

- [x] `App.spamGuard { honeypotField, timingField, minSubmitSeconds }` (all off by default)
- [x] `App.autoResponder { enabled, subject, message }`
- [x] `SendLog.status` += `blocked_bot` / `blocked_spam`; new `kind: submission | autoresponse`
- [x] No migration: additive fields + additive enum values, so existing rows stay readable

## 3. Send pipeline (`/api/v1/send`)

- [x] strip guard fields → bot signals (`422`) → field contract → spam score (`422`)
      → dedupe → quota → send → log
- [x] blocked attempts write a `SendLog` row (owner-visible in §4.6) and consume
      neither a quota slot nor a dedupe claim
- [x] autoresponse **after** the `202` is earned: own quota slot, own log row, wrapped
      so its failure can never change the caller's result

## 4. API + dashboard

- [x] `PATCH /api/apps/[id]` accepts `spamGuard` / `autoResponder`; `GET /api/apps`
      returns them (registration form stays short — both are configured after)
- [x] `GET /api/apps/[id]/logs` — user-scoped history + status counts + today's usage
- [x] `SpamGuardEditor.tsx`, `AutoReplyEditor.tsx`, `ActivityPanel.tsx` + wiring
- [x] admin log view labels the two new statuses

## 5. Docs (kept in sync, per CLAUDE.md)

- [x] `docs/SPEC.md` §3b table, §4d (guards), §4e (autoresponder), §5 responses, §7 data
- [x] `docs/HARDENING_ROADMAP.md` — retire §4.2/§4.4/§4.5/§4.6 into §7, fix §0/§1.2/§6
- [x] `docs/ADMIN_SPEC.md` — SendLog status/kind
- [x] `src/lib/api-docs.ts` — spam/bot guard + autoresponder sections, `422` rows
- [x] `README.md`, `CLAUDE.md`, `.env.example` (`SPAM_SCORE_THRESHOLD`)

## 6. Verify

- [x] throwaway harness over `bot-guard.ts` + `spam-score.ts` (§5.2 pattern)
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Review

All four sections are in. `npx tsc --noEmit` and `npm run build` both pass.

**How it was verified.** A throwaway harness (compiled `bot-guard.ts`,
`spam-score.ts`, `auto-responder.ts` and `templates.ts`, drove them, deleted it —
the §5.2 pattern) covered guard parsing, the guard-field split, every `elapsedMs`
shape, the scoring thresholds and the auto-reply escaping. All assertions passed
except one where the *assertion* was wrong, not the code: anchor markup + 3 links +
apparent shouting scores 5, because the mixed-case HTML in the value keeps the
uppercase ratio under the shouting threshold. That is the conservative direction, so
it was left as is.

**Not verified at runtime.** No DB or SMTP was exercised — the guards, the
autoresponse and the activity panel still want one pass against a real app: post a
filled honeypot, a too-fast submission, an 8-link message, and one clean submission
with the auto-reply on, then open the Activity panel and check the four rows.

### Decisions worth remembering

- **Keywords can never block on their own.** Keyword hits are capped at +3 against a
  threshold of 6, because an SEO agency's inbox legitimately receives "we need SEO
  services / backlinks". Blocking needs a structural signal (link volume, anchor
  markup, mail-header probes).
- **Guard fields are stripped before the field contract runs**, so a honeypot name
  never has to be declared as a form field and never reaches the email.
- **Timing is skew-tolerant**: a negative elapsed time (client clock ahead of ours)
  passes, because a wrong clock is not evidence of a bot.
- **The autoresponse never echoes submitted content** — only owner-authored text —
  since its recipient is chosen by whoever posted the form.
