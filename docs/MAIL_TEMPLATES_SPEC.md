# Mail Designs & Provider-Agnostic Destinations — Implementation Spec

Status: **Implemented**

Two related changes to the outgoing-email path:

1. **Destinations become provider-neutral.** Any inbox — Gmail, Zoho, Outlook, or a
   custom domain — is a valid destination. This already works technically; the field
   name, UI labels, and docs wrongly imply Gmail-only.
2. **Selectable mail designs.** Five built-in HTML designs. The app owner picks one
   when registering an app and can switch it later. Designs are **selection-only** —
   not editable, no per-app colors/logos/HTML.

The **sender** stays a single account (our Gmail today). Moving it to a custom-domain
mailbox is out of scope — see §9.

> Migration required before this build serves traffic: existing `apps` /
> `sendlogs` documents hold `destinationGmail` and no `templateId`. See §7.

---

## 1. Why

| Gap | Today |
|-----|-------|
| Destination looks Gmail-only | `POST /api/apps` accepts any address (`z.string().email()`, `src/app/api/apps/route.ts:33`) and Nodemailer delivers to any domain — but the DB field is `destinationGmail`, the dashboard label reads "Gmail to send submissions to", the create error says "a valid Gmail address", and README/SPEC repeat "destination Gmail". A user pointing an app at Zoho cannot tell it is supported. |
| One hardcoded look | `src/lib/flatten.ts` renders exactly one design (dark header + white card + two-column rows). No choice. |

---

## 2. The design catalog

Five built-ins, defined in code (no DB records):

| id | Name | Look |
|----|------|------|
| `card` | Card *(default)* | Today's design — dark header bar, white rounded card, two-column rows, timestamp footer |
| `minimal` | Minimal | No card or borders; bold label above each value, generous spacing, plain white |
| `compact` | Compact table | Dense bordered grid, smaller type — best for forms with many fields |
| `dark` | Dark | Dark background, light text, subtle row dividers |
| `accent` | Accent bar | Colored left stripe, large title, zebra-striped rows |

Constraints every design must hold to: inline styles only, table-based layout,
≤600px wide, mobile-safe, and all submitted values HTML-escaped. The plain-text
alternative part (`buildEmailBody`) is shared and identical across designs.

---

## 3. Rendering architecture

### `src/lib/flatten.ts` (edit)

Keeps `buildEmailBody`, `sanitizeSubject`, `titleize`, `escapeHtml`, `htmlValue`, and
gains:

- `toRows(data)` → `{ label, valueHtml }[]` — labels titleized + escaped, values run
  through the existing `htmlValue`. Shared by all five renderers so escaping lives in
  exactly one place.

One behavioral tweak: `htmlValue`'s nested-object / array markup currently hardcodes
`#111827` / `#6b7280`. Change it to inherit `color` / `font` so nested values pick up
each design's palette (otherwise dark-background designs render unreadable sub-tables).

`buildEmailHtml` is removed — its card markup moves to the `card` renderer.

### `src/lib/templates.ts` (new)

The registry and the only place design markup lives:

```ts
export const DEFAULT_TEMPLATE_ID = "card";
export const TEMPLATES = { card: {...}, minimal: {...}, compact: {...}, dark: {...}, accent: {...} };
// each entry: { id, name, description, render(rows, meta: { websiteName, receivedAt }): string }

export type TemplateId = keyof typeof TEMPLATES;
export const TEMPLATE_IDS: TemplateId[];                   // zod enum + Mongoose enum source
export const TEMPLATE_LIST: { id, name, description }[];   // dashboard picker
export function resolveTemplateId(v: unknown): TemplateId; // unknown/missing → default
export function renderEmailHtml(id: unknown, data, meta): string;
```

`resolveTemplateId` is the safety net for apps written before the migration — an
absent or unrecognized id silently falls back to `card` rather than failing the send.

---

## 4. Data model changes

### `src/models/App.ts` (edit)

- `destinationGmail` → **`destinationEmail`**
- add `templateId: { type: String, enum: TEMPLATE_IDS, default: "card" }`

No new collection: a design choice is a single field, and designs are not editable, so
there is nothing else to persist.

### `src/models/SendLog.ts` (edit)

- `destinationGmail` → **`destinationEmail`** (still a snapshot at send time)

---

## 5. API surface

| Method | Route | Change |
|--------|-------|--------|
| POST | `/api/apps` | accepts optional `templateId` (zod enum from `TEMPLATE_IDS`, default `card`); request/response key `destinationGmail` → `destinationEmail`; returns `templateId` |
| GET | `/api/apps` | projection + response include `templateId`; renamed destination key |
| PATCH | `/api/apps/[id]` | **new** — body `{ templateId }`, the "change design later" path |
| GET | `/api/templates/[id]/preview` | **new** — session-required, returns `text/html` of that design rendered with fixed sample data, for the dashboard `<iframe>` |
| GET | `/api/admin/apps` | includes `templateName` (resolved server-side for display); renamed destination key |
| GET | `/api/admin/logs` | renamed destination key |
| POST | `/v1/send` | renders via `renderEmailHtml(app.templateId, …)` instead of the single hardcoded builder |

`PATCH /api/apps/[id]` scopes by owner like the existing
`src/app/api/apps/[id]/regenerate-key/route.ts:21`
(`findOneAndUpdate({ _id: id, userId: session.userId })`), returning `404` for an app
the caller does not own or for a malformed id (guarded with `isValidObjectId`, so a bad
id cannot raise a CastError 500). The preview response carries
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and the
dashboard iframe is `sandbox=""` — the preview is a static, script-free document.
Design metadata is imported directly by the dashboard server component, so no
catalog-list endpoint is needed.

**No back-compat shim for the rename.** `destinationGmail` appears only in the
dashboard/admin APIs consumed by this repo's own UI. The public contract
(`POST /v1/send`) never accepted a destination, so third-party integrations are
unaffected.

---

## 6. UI

### Dashboard (`src/app/dashboard/AppsManager.tsx`, `DesignPicker.tsx`)

- The picker is its own client component, `src/app/dashboard/DesignPicker.tsx`
  (`role="radiogroup"` with `aria-checked` buttons), reused by both the register form
  and the per-app "change design" panel.
- The catalog is passed down from the server page (`dashboard/page.tsx` →
  `<AppsManager designs={TEMPLATE_LIST} />`) so design markup and render functions never
  ship in the client bundle.
- **Register form** — the picker (name + one-line description per design, `card`
  preselected) with a live `<iframe src="/api/templates/{selected}/preview">` that swaps
  as the selection changes. `templateId` goes in the POST body.
- **App list row** — shows the current design name plus a **Change design** button that
  expands the same picker + preview and `PATCH`es on save.
- Label becomes "Email to send submissions to"; the create error becomes
  "…a valid email address". `type="email"` is kept — it already accepts any domain.
- Picker/preview styles go in `src/app/globals.css`, following the existing
  `.card` / `.app-item` conventions.

### Admin

- `src/app/admin/apps/AppsAdmin.tsx` — add a design column (useful when a user reports
  "my emails look wrong"); renamed destination field.
- `src/app/admin/logs/LogsViewer.tsx` — renamed destination field (the column header
  already reads "Destination").

### Wording

Replace Gmail-specific phrasing with "email inbox" / "destination email", stating that
Gmail, Zoho, Outlook and custom domains all work: `src/app/layout.tsx:6`,
`src/app/docs/page.tsx` (lines 81/84/125/157), `src/app/docs/TrySend.tsx` (14/86),
`README.md` (4/9/30/111/135), `docs/SPEC.md` (§1, §2, §5, §6, §9, §11, §14),
`docs/ADMIN_SPEC.md:33`. The `/docs` "Request body" section also notes that fields
render using the app's selected design.

Left as Gmail on purpose: the `SMTP_USER` / `SMTP_PASS` README rows and
`service: "gmail"` in `src/lib/mailer.ts:9` — the *sender* is still Gmail.

---

## 7. Migration

`scripts/migrate-app-fields.mjs` (new `scripts/` dir) — connects via Mongoose using
`MONGO_URI` (env, falling back to `.env` so it needs no extra setup on the VPS), prints
modified counts, idempotent (safe to re-run; the filters make a second run a no-op):

```js
apps.updateMany({ destinationGmail: { $exists: true } },
                { $rename: { destinationGmail: "destinationEmail" } })
sendlogs.updateMany({ destinationGmail: { $exists: true } },
                    { $rename: { destinationGmail: "destinationEmail" } })
apps.updateMany({ templateId: { $exists: false } },
                { $set: { templateId: "card" } })
```

Without the rename, `app.destinationEmail` reads `undefined` on existing documents and
every send fails as `smtp_failed`.

Deploy order on the VPS — a short stop avoids a window where running code and the DB
disagree:

```
sudo systemctl stop mail-sender
git pull && npm ci
node scripts/migrate-app-fields.mjs
npm run deploy          # builds + restarts
```

These steps are added to README's deploy section.

---

## 8. Verification

1. `npx tsc --noEmit` and `npx next build` — the rename is type-driven, so a missed
   reference fails the typecheck.
2. Migration on a dev DB: seed a doc with `destinationGmail` and no `templateId`, run
   the script, confirm the rename + backfill; re-run and confirm zero modifications.
3. `npm run dev` → register form, click through all five designs, confirm each preview
   iframe renders (header, rows, nested list, footer) intact.
4. Register one app with a **Zoho / custom-domain** destination and design `dark`, and
   one with a Gmail destination and design `compact`.
5. **Try it** on `/docs` for both, with a payload exercising a long message, an array, a
   nested object, and an empty value. Expect `202` and the *selected* design in each
   inbox. If the Zoho one lands in Spam, that is the `gmail.com` From vs custom-domain
   policy (§9), not a bug in this work.
6. **Change design** on an existing app → re-send → the new design arrives. A `PATCH`
   against another user's app id returns `404`.
7. An app with `templateId` manually unset still sends, falling back to `card`.
8. `/admin/logs` shows a `sent` row per attempt with the right destination;
   `/admin/apps` shows the design column.

---

## 9. Out of scope

**Custom-domain sender (planned next).** Still a single sender, but from your own
domain instead of Gmail:

- add `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` to `src/lib/env.ts` and use
  `{ host, port, secure }` instead of `service: "gmail"` in `src/lib/mailer.ts:8-11`,
  with the Gmail values as defaults so nothing breaks;
- set `SMTP_FROM` to a mailbox that SMTP account is authorised to send as — providers
  reject or rewrite arbitrary `From` values;
- publish SPF/DKIM (ideally DMARC) for the domain, or mail lands in spam regardless of
  code.

**Also excluded:** per-app sender credentials, user-editable or custom designs, logo /
color overrides, and `Reply-To` derived from a submitter-supplied email field.

---

## Files touched

**New:** `src/lib/templates.ts`, `src/app/dashboard/DesignPicker.tsx`,
`src/app/api/apps/[id]/route.ts`, `src/app/api/templates/[id]/preview/route.ts`,
`scripts/migrate-app-fields.mjs`, this document.

**Edited:** `src/lib/flatten.ts`, `src/models/App.ts`, `src/models/SendLog.ts`,
`src/app/api/apps/route.ts`, `src/app/api/admin/apps/route.ts`,
`src/app/api/admin/logs/route.ts`, `src/app/api/v1/send/route.ts`,
`src/app/dashboard/AppsManager.tsx`, `src/app/admin/apps/AppsAdmin.tsx`,
`src/app/admin/logs/LogsViewer.tsx`, `src/app/globals.css`, `src/app/layout.tsx`,
`src/app/docs/page.tsx`, `src/app/docs/TrySend.tsx`, `README.md`, `docs/SPEC.md`,
`docs/ADMIN_SPEC.md`.
