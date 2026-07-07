# Mail Sender — Roadmap (post-v1)

> Companion to `TECH_STACK.md` (v3). Takes the deferred items from §1 ("Future") and §11 ("Open Questions / Defer to v1.x") and sequences them into milestones. No implementation detail — that lives in design docs written per item when its milestone is picked up.

---

## Milestone overview

| Milestone | Theme | Items |
|---|---|---|
| **v1.0** | Public launch blockers | Email verification, Password reset |
| **v1.1** | Friction & browser hardening | Google OAuth, Captcha, HMAC option |
| **v1.2** | Reliability at scale | Background queue, Ratelimit upgrade |
| **v1.5** | Named HTML templates | Per-user template library, per-app allow-list, send-by-name |
| **v2.0** | Product expansion | Attachments, Webhooks, Analytics, Drag-and-drop designer |
| **v2.1** | Monetization | Plan tiers / billing |

---

## Dependency graph

```
Email verification ──┐
Password reset ──────┴──► v1.0 launch
                         │
                         ├─► Google OAuth
                         ├─► Captcha (browser callMode)
                         └─► HMAC option (browser callMode alt)
                                    │
                         Background queue ──┐
                         Ratelimit upgrade ─┤
                                            │
                         Named HTML templates ──► Drag-and-drop designer
                         Attachments ──────────► (needs queue)
                         Webhooks ─────────────► (needs queue)
                         Analytics ────────────┐
                                               └─► Plan tiers / billing
```

Two hard chains:
- **Drag-and-drop designer** is meaningless without **Named HTML templates** first — the templates feature provides the data model and render runtime; the designer is a friendlier authoring surface on top of it.
- **Plan tiers** needs **Analytics** before it; metered billing requires the volume metrics that the analytics work produces.

Soft chains (item works without dep, but is materially better with it):
- **Attachments** and **Webhooks** both want **Background queue** before them — large payloads and outbound HTTP retries shouldn't sit on the SMTP request path.

---

## v1.0 — Public launch blockers

Both items are explicitly called "required before public launch" in `TECH_STACK.md` §11. Nothing else ships before these.

### Email verification on signup
Without it, a malicious signup can register an app pointed at a victim's destination email and use us as an open spam relay against them. Auth.js + Nodemailer plumbing already exists; needs a `email_verifications` collection (or a signed token in the link) and a gate on app creation until `users.emailVerified` is set.

### Password reset flow
Lost-password recovery is table stakes; without it, every forgotten password is a permanently dead account. Same Nodemailer + signed-token plumbing as email verification, so build them together.

---

## v1.1 — Friction & browser hardening

Items that become visible problems within weeks of launch. None of them block launch, all of them get easier the earlier they ship.

### Google OAuth login
Doc already lists this as "later" (§1, §4a) and the Auth.js config is shaped to drop it in. Reduces signup friction substantially for the dashboard-side audience (the customers who'd integrate us into their own product), and the matching-by-email logic is trivial because every Credentials user already has a verified email after v1.0.

### Captcha on `/v1/send` for `callMode: 'browser'`
The doc itself flags (§5) that browser-shipped keys are inherently leakable — Origin checks stop honest browsers, not attackers. Cloudflare Turnstile (free) is the explicit suggestion in §11. Only enforced for `browser` and the browser branch of `both`; pure server-to-server apps don't need it.

### HMAC signing option (alt key scheme for browser use)
Listed in §2 as "deferred." HMAC lets the browser sign each request with a short-lived nonce instead of carrying a long-lived bearer token, which materially shrinks the blast radius if a key leaks. Make it opt-in per-app — most customers will stay on bearer keys; HMAC is for the security-sensitive minority.

---

## v1.2 — Reliability at scale

Triggered by real-world load, not by calendar. Build when SMTP latency starts showing in p99 or when synchronous failures start losing emails.

### Background queue (BullMQ + Redis)
§11 explicitly defers this until "SMTP latency or failure rate matters." v1 sends synchronously inside the request handler, which couples customer-perceived latency to Gmail's mood and turns transient SMTP failures into 502s. A queue gives retries-with-backoff, dead-letter handling, and decouples the API response from delivery. Required before Webhooks (which want the same retry semantics) and Attachments (large payloads shouldn't block the request).

### Ratelimit upgrade (Mongo TTL counter → `@upstash/ratelimit`)
§11 says: switch only if "Mongo round-trip cost hurts on serverless." Self-hosted on a VPS, the Mongo counter is fine and free. On Vercel with Hobby cold starts, the extra Mongo round-trip per request is meaningful, and Upstash's edge-cached counter is ~1 ms. Decision is conditional on deployment shape, not a hard milestone.

---

## v1.5 — Named HTML templates

Pulled forward out of v2.0 in this conversation. The named-template runtime ships first as a paste-source feature; the drag-and-drop designer (v2.0) layers a friendlier authoring surface over the same data model later. The v1 plain-text flatten remains as the no-template fallback so existing apps keep working unchanged.

### Named HTML templates

The user maintains a pool of templates at the dashboard level (typical scale: ~10 per user). Each app — `dev` / `uat` / `prod` — declares an allow-list of template names drawn from that pool, so promoting a template to production is an explicit dashboard action, not a global rollout. The customer's developers call `/v1/send` with `{ "template": "<name>", "subject": "...", ...vars }`; an unknown or unlisted template name returns `400 { error: "template_not_found" }`, and a missing `subject` returns `400 { error: "subject_required" }` (templates do not carry subjects in v1.5 — `subject` always comes from the request, exactly like the v1 plain-text path). Authoring is paste-source (Monaco editor; **MJML strongly preferred** over raw HTML for cross-client rendering safety). Substitution is Mustache-style `{{var}}` resolved against the request body at render time, **HTML-escaped by default**; `{{{var}}}` is the explicit raw-passthrough escape hatch. Missing variables render as empty strings — implicit substitution, no save-time or send-time variable validation; the dashboard test-send (below) is the debugging surface.

**Locked decisions** (this conversation):
- **Scope:** templates are owned at the **user level** — apps reference them by name from a shared pool.
- **App linking:** per-app **allow-list** (`allowedTemplates: string[]`). Promoting a template to prod = adding its name to the prod app's allow-list.
- **Send API:** `template` field required; unknown or unlisted names rejected. `subject` lives on the request (template carries no subject); missing `subject` → 400. Plain-text flatten remains as the fallback **only** when the request omits `template` entirely.
- **Substitution:** Mustache-style `{{var}}` with default HTML-escape; raw passthrough `{{{var}}}` opt-in per placeholder. **Implicit variables** — no declaration, missing body fields render empty.
- **Plain-text part:** **auto-derived from the rendered HTML by default** (`html-to-text` or Nodemailer built-in). Customers may optionally upload a paired plain-text template per HTML one to override the auto-derived output.
- **Edit semantics:** edits replace in place, audit-logged. No drafts / versioning / rollback in v1.5 — defer to v2.0 designer.
- **Test send:** dashboard exposes a "Send test to my email" button on the template page with a JSON test-data field — included in v1.5, not deferred.
- **Schema:** new `templates` collection (`{ userId, name, sourceHtml, sourceText?, format: 'html'|'mjml', createdAt, updatedAt }`); `(userId, name)` unique. App's `allowedTemplates` stays a denormalized name array; deleting a template from the user's pool cascades to remove the name from every app's allow-list in the same write.

---

## v2.0 — Product expansion

The features that turn this from "JSON-to-email proxy" into "the email feedback product." Order within the milestone is loose; the only rigid bit is that the designer is downstream of v1.5 named templates.

### Attachments
Customers will ask within weeks ("attach the screenshot"). Multipart MIME, hard size cap (~5 MB), and ideally virus scanning before relay. Better behind the queue (large payloads on the request path = bad p99).

### Drag-and-drop designer
Follow-on to **v1.5 Named HTML templates** — same data model and same render runtime, just replaces the paste-source editor with a component-palette designer (live preview, variable binding UI, MJML under the hood for email-client safety). The headline UI feature and the explicit reason §1 picked Next.js over Fastify in v3 of the design. Spec as its own design doc when v2 starts.

### Webhooks
Per-app webhook URLs that fire on `sent` / `failed` / `bounced`. Required for customers who want delivery state in their own systems instead of polling `/api/apps/[id]/logs`. Wants the queue first so retries-on-customer-5xx are clean.

### Analytics
Send volume, success rate, p95 latency, bounce rate, per-app and rolled-up. Already half-present via `mail_logs`; needs aggregation queries (or a rollup collection) and a dashboard page. Precondition for billing — metered plans need this data.

---

## v2.1 — Monetization

### Plan tiers / billing
§11: "not now." Becomes "now" once free tier abuse or hosting cost forces the question. Stripe + a `subscriptions` collection + per-plan rate-limit overrides. Metered billing (per-email above included quota) needs Analytics in place; flat-tier-with-cap can ship without it but is leaving money on the table.

---

## Items intentionally **not** on this roadmap

Listed here so we don't accidentally re-derive them as "future ideas" later — they were considered and excluded from the doc's deferred list.

- **Per-tenant sender Gmail (OAuth-impersonated send)** — §2 rules this out; we are the relay, not impersonating customers.
- **Multiple plan-tier rate limits beyond the per-app default** — folded into "Plan tiers / billing" above.
- **Switching off MongoDB** — user's choice, locked.
- **Switching off Next.js** — v3 decision, locked.

Anything else that lands in the deferred list later (custom sender domains, suppression lists, sender-pool migration off Gmail, audit log, scheduled sends, team accounts) should be added to a "v3+ — open questions" section at the bottom of this doc as it's raised, **not** silently absorbed into a milestone.
