# Design — v1.5 Named HTML Templates

> Companion to `TECH_STACK.md` (architecture) and `ROADMAP.md` (priorities). This doc is the build-ready spec for the v1.5 milestone — Named HTML Templates with paste-source authoring. Decisions captured here are locked from the planning conversation; do not re-derive without revisiting `ROADMAP.md` §v1.5.

---

## 1. Scope

Customers register a **pool of HTML/MJML templates per user**, opt each app (`dev` / `uat` / `prod`) into a subset by name, then send via `POST /v1/send` with `{ "template": "<name>", "subject": "...", ...vars }`. Variables substitute by Mustache-style `{{var}}` against the rest of the request body. The v1 plain-text flatten path remains the no-template fallback when the request omits `template` entirely.

**Non-goals for v1.5** (deferred to v2.0+, see §11):
- Drag-and-drop visual designer
- Versioning / drafts / rollback
- Mustache sections, helpers, partials, includes
- Per-template analytics
- Declared variable schemas with API-level validation
- Scheduled sends, A/B testing

---

## 2. Locked decisions (recap)

| Area | Decision |
|---|---|
| Storage scope | Per-user pool. `templates` collection keyed by `(userId, name)`. |
| App linking | Each app stores `allowedTemplates: string[]`. Send rejects names not on the list. |
| Authoring | Paste-source. Monaco editor in dashboard. MJML strongly preferred; raw HTML allowed. |
| Subject | Always from the **request**, not the template. Missing → 400. Mustache-substituted, then `\r\n`-stripped. |
| Substitution | Mustache `{{var}}` HTML-escaped by default; `{{{var}}}` raw passthrough. **Variable-only** — no sections, helpers, or partials in v1.5. |
| Variable schema | **Implicit.** No declaration. Missing fields render as empty string. |
| Plain-text part | **Auto-derived** from rendered HTML by default. Optional paired plain-text source overrides. |
| Edit semantics | Replace in place. Audit-logged. No drafts/versions. |
| Test send | Dashboard "Send test to my email" button, included in v1.5. |
| Fallback | If request omits `template`, fall back to v1 plain-text flatten. Existing apps keep working. |

---

## 3. Data model

### 3a. New collection — `templates`

```ts
{
  _id: ObjectId,
  userId: ObjectId,                  // owner; FK to users
  name: string,                      // 1..64 chars, [a-z0-9-_], unique within userId
  format: 'html' | 'mjml',           // determines compile step at save time
  source: string,                    // raw user-authored HTML or MJML (≤ 256 KB)
  compiledHtml: string,              // for format='mjml': MJML output. For 'html': same as source.
  sourceText: string | null,         // optional paired plain-text override
  active: boolean,                   // soft-disable; default true
  createdAt: Date,
  updatedAt: Date,
}
```

Indexes:
- `{ userId: 1, name: 1 }` **unique**
- `{ userId: 1 }` (list view)

> **Why store `compiledHtml` at save time** rather than compile per send: MJML compilation is ~10-50 ms and pure (same source → same output). Pre-compiling on save makes the send path render-only and avoids a per-process LRU cache. The cost is one extra string field on the document; for ~10 templates per user at ≤256 KB each, this is trivial.

### 3b. `apps` schema delta

Add one field:

```ts
allowedTemplates: string[]           // names of templates from THIS user's pool that THIS app may invoke
```

Default: `[]`. Existing apps unaffected — empty array means "no templates allowed; only the v1 plain-text path works for this app."

No new index — `allowedTemplates` is checked by the in-memory app document already loaded for API-key auth.

### 3c. Cross-collection consistency

Deleting a template from `templates` MUST cascade to remove its `name` from every app's `allowedTemplates` array, in the same write. Implementation: a Mongoose `pre('deleteOne')` hook on the `Template` model, or an explicit transaction in `deleteTemplateAction`.

Renaming is **disallowed** in v1.5 — `name` is the API lookup key, and a rename invisibly breaks every customer integration. Dashboard exposes "delete + create new" if a customer needs a different name.

---

## 4. API contract — `/v1/send` v1.5

### 4a. Request

```http
POST /v1/send
Authorization: Bearer mks_<env>_<key>
Content-Type: application/json

{
  "template": "feedback-form",          // optional. If absent → v1 plain-text flatten.
  "subject": "Feedback from {{name}}",  // REQUIRED when template present. Mustache-substituted.
  "name": "Jane Doe",                   // any other top-level keys form the substitution context
  "email": "jane@acme.com",
  "message": "Hello"
}
```

Substitution context: every top-level key **except `template` and `subject`**.

### 4b. Behavior matrix

| Request shape | Path |
|---|---|
| `template` absent | v1 plain-text flatten (unchanged from `TECH_STACK.md` §6) |
| `template` present, name unknown to user OR not in app's `allowedTemplates` OR template inactive | `400 template_not_found` |
| `template` present, `subject` absent or empty | `400 subject_required` |
| `template` present, valid | Render → send → 202 with log id |

Response shapes unchanged from v1 — see `TECH_STACK.md` §6.

### 4c. Field constraints (template path)

| Field | Type | Constraint |
|---|---|---|
| `template` | string | 1..64 chars, `[a-z0-9-_]` |
| `subject` | string | 1..200 chars, `\r\n` stripped after substitution |
| `<other vars>` | any JSON | Stringified via `JSON.stringify` if not a primitive before HTML-escape |

Total request body cap stays at **16 KB** (`TECH_STACK.md` §9.5).

---

## 5. Render pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  POST /v1/send                                                  │
└─────────────┬───────────────────────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │ Auth: hash key →    │
   │ lookup App by hash  │── 401 invalid_key on miss
   └──────────┬──────────┘
              │
   ┌──────────▼──────────┐
   │ Origin check        │── 403 origin_not_allowed (browser callMode)
   │ Rate limit check    │── 429 rate_limited
   └──────────┬──────────┘
              │
   ┌──────────▼──────────┐
   │ template field?     │── absent → v1 flatten path (existing)
   └──────────┬──────────┘
              │ present
   ┌──────────▼──────────────────────────────────────┐
   │ Validate `template` ∈ app.allowedTemplates       │── 400 template_not_found
   │ Lookup Template by (userId=app.userId,           │   (combined with "doesn't exist"
   │                     name=template, active=true)  │    to prevent enumeration)
   └──────────┬──────────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │ Validate `subject`  │── 400 subject_required
   │ present & non-empty │
   └──────────┬──────────┘
              │
   ┌──────────▼──────────────────────┐
   │ Build substitution context =     │
   │ body minus { template, subject } │
   └──────────┬──────────────────────┘
              │
   ┌──────────▼─────────────────────────────────┐
   │ Render HTML: Mustache(compiledHtml, ctx)   │
   │   {{var}}  → HTML-escaped                  │
   │   {{{var}}} → raw passthrough              │
   │   missing → empty string                   │
   └──────────┬─────────────────────────────────┘
              │
   ┌──────────▼─────────────────────────────────┐
   │ Render plain-text:                          │
   │   if sourceText: Mustache(sourceText, ctx)  │
   │   else:          html-to-text(rendered)     │
   └──────────┬─────────────────────────────────┘
              │
   ┌──────────▼─────────────────────────────────┐
   │ Render subject: Mustache(subject, ctx)      │
   │ then strip \r\n (header-injection guard)    │
   └──────────┬─────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │ Nodemailer send:    │── 502 smtp_failed
   │ multipart text+html │
   └──────────┬──────────┘
              │
   ┌──────────▼──────────┐
   │ MailLog write       │── 202 { id }
   └─────────────────────┘
```

### 5a. Substitution engine

Use **Mustache.js** with logic features disabled. Wrapper:

```ts
// lib/render.ts
import Mustache from "mustache"

// Disable sections/helpers/partials by validating the source at save time
// rejects anything with #, ^, /, >, ! tokens. Send-path uses raw Mustache.render.
export function renderHtml(compiledHtml: string, ctx: Record<string, unknown>): string {
  return Mustache.render(compiledHtml, sanitizeContext(ctx))
  // Mustache.js HTML-escapes {{var}} by default; {{{var}}} passes raw — exactly what we want.
}

function sanitizeContext(ctx: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v)
  }
  return out
}
```

### 5b. MJML compile (save time only)

```ts
// in createTemplateAction / updateTemplateAction, when format === 'mjml'
import mjml2html from "mjml"
const result = mjml2html(input.source, { validationLevel: "strict" })
if (result.errors.length) throw new ValidationError(result.errors)
template.compiledHtml = result.html
```

For `format === 'html'`, `compiledHtml = source` (saves the send path a branch).

### 5c. Plain-text auto-derive

Use [`html-to-text`](https://www.npmjs.com/package/html-to-text):

```ts
import { convert } from "html-to-text"
const text = convert(renderedHtml, {
  wordwrap: 78,
  selectors: [{ selector: "img", format: "skip" }],
})
```

If `template.sourceText` is non-null, render that with Mustache instead and skip auto-derive.

---

## 6. Dashboard surface

### 6a. Routes

| Route | Purpose |
|---|---|
| `/templates` | List user's templates. Columns: name, format, last edit, active toggle, link to detail. |
| `/templates/new` | Create form. Fields: name, format selector, source editor (Monaco), optional plain-text editor, active toggle. Submit calls `createTemplateAction`. |
| `/templates/[id]` | Detail/edit. Same fields as `/new` plus a **Test Send** panel (§6c). |
| `/apps/[id]` | Existing page; add a multi-select / chip input bound to `allowedTemplates`. Options come from the user's template pool. |

Layout: `/templates*` lives under the `(dashboard)` route group, auth-gated by the existing `middleware.ts`.

### 6b. Monaco editor config

- Language: `html` for `format='html'`, `xml` for `format='mjml'` (closest tokenizer).
- Read-only mode for users on the free plan if/when plan tiers ship (v2.1) — not yet.
- Word wrap on; line numbers on; default theme matches the dashboard.

### 6c. Test Send panel

Located on `/templates/[id]`. UI:
- A JSON textarea ("Test data") prefilled with the keys parsed from `{{var}}` occurrences in the source — this is the **only** save-time parse of the source, and it's a UX hint, not a schema.
- A **Send Test** button. On click, calls `testSendTemplateAction(id, testData)`.
- Status line shows result: "Sent to your-email@example.com" or render-error message.

The recipient is **always** the authenticated user's verified email — never read from the test data. Rate-limited 10 sends/min/user to prevent abuse.

---

## 7. Server actions

All under `actions/templates.ts`. All gated by `await auth()`.

| Action | Args | Returns | Notes |
|---|---|---|---|
| `createTemplateAction` | `{ name, format, source, sourceText? }` | `{ id }` | Validates name regex + uniqueness; compiles MJML; rejects forbidden Mustache tokens. |
| `updateTemplateAction` | `id, patch` | `{ ok }` | Re-compiles MJML if source/format changed. **Cannot change `name`** (see §3c). Audit-logged. |
| `deleteTemplateAction` | `id` | `{ ok }` | Removes name from every app's `allowedTemplates` in the same write. |
| `toggleTemplateActiveAction` | `id, active` | `{ ok }` | Soft-disable. Same effect as deletion at the API layer. |
| `testSendTemplateAction` | `id, testData` | `{ ok, error? }` | Renders + sends to authenticated user's email. Rate-limited. |

Existing `updateAppAction` (in `actions/apps.ts`) extended to accept `allowedTemplates: string[]` patch. Validation: every entry must exist in the user's `templates` and be `active`.

---

## 8. Security & validation

### 8a. Substitution safety

- `{{var}}` HTML-escapes by default — this is Mustache.js's built-in behavior. Verified by unit test (§10).
- `{{{var}}}` is the explicit raw-passthrough. Document loudly: "only use for trusted server-side fields like rendered Markdown."
- Save-time **token blocklist**: regex-reject any source containing `{{#`, `{{^`, `{{/`, `{{>`, `{{!` — these activate Mustache sections/helpers/partials which are out of scope for v1.5. Cleaner error than letting the engine attempt them.

### 8b. Header injection

Subject is always Mustache-substituted **before** `\r\n` stripping. Strip after substitution, not before — otherwise a substituted variable could re-introduce CRLF.

```ts
const rawSubject = Mustache.render(req.body.subject, ctx)
const subject = rawSubject.replace(/[\r\n]+/g, " ").slice(0, 200)
```

### 8c. Allow-list enforcement

Every send path checks `name in app.allowedTemplates` **before** the DB lookup. Even if a customer crafts a request that bypasses the dashboard, the API still reads `allowedTemplates` from the loaded app document.

Active state is a second gate — `active: false` templates render `template_not_found`, identical to "doesn't exist," so a customer can't tell whether a name is unknown or just disabled (defense against template-name enumeration).

### 8d. Source size + content limits

- Source ≤ 256 KB at save time.
- Compiled HTML ≤ 1 MB (catches MJML-expansion bombs).
- Reject sources containing `<script>` tags entirely — no legitimate email needs them and they're a clear sign of misuse. Note: this is a save-time check, not a render-time sanitizer; raw passthrough variables are still the customer's responsibility.

### 8e. Test-send abuse

`testSendTemplateAction` rate-limited 10/min/user via the same Mongo TTL counter as the public API (§v1.2 in roadmap). Prevents using the dashboard as a spam outlet.

---

## 9. Error codes

Additions to the existing `/v1/send` error table (`TECH_STACK.md` §6):

| Status | Code | When |
|---|---|---|
| 400 | `template_not_found` | Name unknown for user, not on app's `allowedTemplates`, or template `active=false`. Deliberately ambiguous to prevent enumeration. |
| 400 | `subject_required` | `template` present, `subject` missing or empty. |
| 400 | `subject_too_long` | Subject after substitution > 200 chars. |
| 400 | `invalid_template_field` | `template` field present but fails regex (`[a-z0-9-_]{1,64}`). |
| 500 | `render_failed` | Mustache engine threw unexpectedly. Should not happen with token blocklist; logged with full stack. |

All other v1 codes (401, 403, 429, 502) unchanged.

---

## 10. Testing strategy

### 10a. Unit (Vitest)

- `renderHtml({{name}}, { name: "<script>" })` produces `&lt;script&gt;`, not raw.
- `renderHtml({{{name}}}, { name: "<b>X</b>" })` produces `<b>X</b>`.
- `renderHtml` with missing key → empty substitution.
- Subject substitution + CRLF stripping leaves no `\r` or `\n`.
- MJML compile: valid input → `compiledHtml` populated; invalid input → `ValidationError`.
- Token blocklist: `{{#section}}` source rejected at save.

### 10b. Integration (mongodb-memory-server + ethereal SMTP)

- Full `POST /v1/send` with `template` happy path → email captured by ethereal, body matches expected render.
- `template` not in app's `allowedTemplates` → 400 `template_not_found`.
- `template` exists but `active=false` → 400 `template_not_found` (not a different code).
- `template` absent → falls back to v1 flatten (regression test).

### 10c. E2E (Playwright)

- Create template via dashboard → assign to app → send via API → verify email body.
- Test-send button: render error surfaces in dashboard panel.

---

## 11. Out of scope for v1.5 (deferred)

| Item | Milestone |
|---|---|
| Drag-and-drop visual designer | v2.0 |
| Template versioning / drafts / rollback | v2.0 (alongside designer) |
| Mustache sections (`{{#x}}`), helpers, partials, includes | v2.0+ |
| Declared variable schemas with API-level validation | Out — explicit choice was implicit |
| Per-template analytics (open/click/bounce) | v2.0 (Analytics) |
| Template renaming | Out — name is the API key. "Delete + create new" is the pattern. |
| HTML sanitization beyond `<script>` rejection | Out — customer's HTML is their responsibility. |

---

## 12. Migration & rollout

### 12a. Backward compatibility

- Existing apps default to `allowedTemplates: []` (empty array). No behavior change — they keep using the v1 plain-text path.
- v1 callers (no `template` field) continue working unchanged on day one.
- New `templates` collection is additive; no migration of `users` or `mail_logs`.

### 12b. Deploy order

1. Schema: add `allowedTemplates: []` to existing apps via `db.apps.updateMany({}, { $set: { allowedTemplates: [] } })`. Idempotent.
2. Ship the API change — `template` field accepted but no templates exist yet → all template requests 400 until dashboard publishes one. Acceptable because no customer is using `template` yet.
3. Ship the dashboard pages.
4. Announce to customers.

No feature flag needed; the empty `allowedTemplates` is the implicit gate.

### 12c. Rollback

- Removing the `template` parsing branch from `/v1/send` reverts to v1 behavior cleanly.
- The `templates` collection and `allowedTemplates` field can sit unused indefinitely; no data hazard.

---

## 13. Open implementation questions (resolve at build time)

These don't change the design — flagging so the implementer can decide without re-opening the spec:

1. **Audit log destination.** New `audit_logs` collection or extend `mail_logs`? Recommendation: new collection, scoped per-user, since edit events are dashboard-user actions, not customer-API actions.
2. **MJML version pin.** Pick a specific `mjml` npm version and pin it; major upgrades can change rendered output, which would silently re-render existing templates. Snapshot test the compile output of a representative template across version bumps.
3. **Monaco bundle size.** Monaco is ~3 MB; lazy-load it only on `/templates/*` routes via `next/dynamic({ ssr: false })`. Don't ship to the rest of the dashboard.
4. **Compiled HTML staleness when MJML version upgrades.** If we upgrade `mjml`, existing `compiledHtml` is from the old version. Decision: re-compile lazily on the next `updateTemplateAction`, OR run a one-shot batch re-compile on deploy. Pick batch for predictability.
