# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Next.js 15 (App Router) middleware service: a website `POST`s its form
submissions plus a secret key to `/v1/send`, and the service emails them to the
destination inbox configured for that app. Users register apps in a dashboard;
admins manage users/apps/logs. Mail goes out through **one** SMTP account we own
(Gmail today) — the per-app address is the **destination**, never the sender.

`docs/` is the source of truth for scope and behaviour, and is expected to be kept
in sync with code changes:

- [docs/SPEC.md](docs/SPEC.md) — the core service (step 1)
- [docs/ADMIN_SPEC.md](docs/ADMIN_SPEC.md) — admin area
- [docs/MAIL_TEMPLATES_SPEC.md](docs/MAIL_TEMPLATES_SPEC.md) — the 5 mail designs + provider-agnostic destinations
- [docs/VPS_PROJECT_PLAYBOOK.md](docs/VPS_PROJECT_PLAYBOOK.md) — nginx/systemd VPS pattern
- `old/` holds superseded design docs — do not treat them as current

## Commands

```bash
npm run dev            # dev server on :3000
npm run build          # production build (standalone output)
npm start              # serve the build
npx tsc --noEmit       # typecheck

npm run setup          # VPS first run: deps, build, .env, install+start systemd unit
npm run deploy         # VPS updates: npm ci, rebuild, systemctl restart mail-sender

node scripts/migrate-app-fields.mjs   # one-off data migration (idempotent)
```

There is **no test suite and no lint config** — `npx next lint` prompts to set
ESLint up interactively, so don't run it. Verification is `tsc --noEmit` +
`next build` + exercising the real endpoints. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))
only runs `npm ci && npm run build`, and only on pushes to the `deploy` branch.

To check mail rendering, sign in and open `/api/templates/<id>/preview` (or the
picker on `/dashboard`) — it renders a design with fixed sample data. The
`Try it` panel on `/docs` sends a real email using an app's secret key.

Required env vars are listed in [.env.example](.env.example): `APP_URL`,
`AUTH_SECRET`, `MONGO_URI`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`.
`SMTP_PASS` must be a Gmail App Password, not the account password.

## Architecture

**Auth is two-layered on purpose.** [src/middleware.ts](src/middleware.ts) does a
cheap edge check of the JWT session cookie for `/dashboard`, `/docs`, `/admin`
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

**The send pipeline** ([src/app/api/v1/send/route.ts](src/app/api/v1/send/route.ts)):
bearer key → `hashSecret` lookup of the `App` → owner-disabled check → parse JSON
or form body → `buildEmailBody()` (plain text) + `renderEmailHtml()` (HTML) →
`sendMail()` → `SendLog` row on both success and failure (logging is wrapped so it
can never affect the response). This route **must** stay
`export const runtime = "nodejs"` — Nodemailer opens an SMTP socket, which Edge
cannot do.

**Mail rendering is split in two.** [src/lib/flatten.ts](src/lib/flatten.ts) owns
data→email conversion and **all** HTML escaping (`toRows()`, `htmlValue()`);
[src/lib/templates.ts](src/lib/templates.ts) owns the 5 designs and nothing else.
When adding or editing a design: build it from the pre-escaped rows (never
re-escape or interpolate raw values), inline styles only, table-based, ≤600px, and
let nested values inherit `color`/`font` so dark palettes stay readable. Note that
a table-level `border-left` is dropped under `border-collapse:collapse` — use a
real stripe cell (see the `accent` design). Designs are **selection-only**: an app
stores a `templateId` and users pick/switch, never edit.

**Env access is lazy** ([src/lib/env.ts](src/lib/env.ts)): getters that throw only
when a value is read at request time, so a missing var never breaks the build.
Mongoose connections are cached on `global` ([src/lib/db.ts](src/lib/db.ts)) to
survive dev hot-reloads; every route calls `connectDB()` itself.

**Client/server split in the dashboard.** Server pages read the session and pass
data down; e.g. [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx) imports
`TEMPLATE_LIST` and passes it to the client `AppsManager`, so design markup and
render functions never reach the browser bundle. Import via the `@/*` → `src/*`
alias.

**Password reset** ([forgot-password](src/app/api/auth/forgot-password/route.ts) →
[reset-password](src/app/api/auth/reset-password/route.ts)): a random token is
emailed in plaintext through the same mailer, only its sha256 hash plus a 30-minute
expiry are stored on the user, and both fields are cleared on use. Forgot-password
always returns the same response whether or not the email exists.

## Data model (3 collections, [src/models/](src/models/))

- **User** — `email`, `passwordHash`, `role: "user" | "admin"`, `disabled`,
  `resetTokenHash`/`resetTokenExpiresAt`. Deleting a user cascades their apps and
  logs; `disabled` is the reversible alternative. The **first** admin must be
  promoted directly in the DB — after that the admin Users page can promote/demote.
- **App** — `userId`, `websiteName`, `destinationEmail` (any provider),
  `templateId` (design enum, default `card`), `secretKeyHash`.
- **SendLog** — one row per `/v1/send` attempt, with `websiteName`/`destinationEmail`
  snapshotted at send time and `status: "sent" | "smtp_failed"`.

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
  401/400/404/502. `/v1/send` returns `202` on success.
- Public API responses never leak internals; user-scoped routes filter by
  `userId: session.userId` so ownership is enforced in the query itself, and guard
  ids with `isValidObjectId` before querying (a malformed id would otherwise throw
  a CastError 500).
- Comments explain *why* (proxy header quirks, hash choice, runtime pinning), not
  what. Match that density rather than adding narration.
- Renaming a persisted field requires a migration in `scripts/` plus README deploy
  steps — schema changes alone leave existing documents unreadable. Run migrations
  with the service stopped: `systemctl stop` → `npm ci` → migrate → `npm run deploy`.
