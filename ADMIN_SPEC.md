# Admin View — Implementation Spec

Status: **Implemented**

Adds an admin area on top of the existing user-centric app. Admins are designated
via a **manual DB flag** and get **full management** capability: view all users, apps,
and email send logs, plus enable/disable/delete actions.

> No DB migration needed: MongoDB/Mongoose create the `sendlogs` collection on first
> write, and the new `role`/`disabled` User fields apply via schema defaults
> (existing users read back as `role: "user"`, `disabled: false`).

---

## 1. Data model changes

### `src/models/User.ts` (edit)
Add two fields:

- `role: { type: String, enum: ["user", "admin"], default: "user", index: true }`
- `disabled: { type: Boolean, default: false }`

Promote an admin by editing the DB record directly (`role: "admin"`).

### `src/models/SendLog.ts` (new)
Records every `/v1/send` attempt against a known app:

| Field | Type | Notes |
|-------|------|-------|
| `appId` | ObjectId ref `App` | which app |
| `userId` | ObjectId ref `User` | app owner |
| `websiteName` | String | snapshot at send time |
| `destinationGmail` | String | snapshot at send time |
| `status` | String enum `"sent" \| "smtp_failed"` | outcome |
| `error` | String (optional) | failure detail |
| `createdAt` / `updatedAt` | Date | `{ timestamps: true }` |

---

## 2. Session & auth (load-bearing change)

`SessionPayload` is currently `{ userId, email }` with no role (`src/lib/jwt.ts:7`).

- Add `role` to `SessionPayload` and encode it into the JWT (`src/lib/jwt.ts`).
- Set it at login by reading `user.role` (`src/app/api/auth/login/route.ts`).
- Add a `requireAdmin()` helper in `src/lib/auth.ts` that does an **authoritative DB
  check** (fetch user, verify `role === "admin"` and not `disabled`), returning
  401/403 otherwise.

**Why two layers:** JWTs live 7 days, so a stale token cannot be trusted for
privilege. Middleware uses the JWT role claim as a cheap edge gate; every
`/api/admin/*` route re-checks the DB via `requireAdmin()` (defense-in-depth).

> Note: a freshly-promoted user must re-login to get the admin claim in their cookie.

---

## 3. Middleware (`src/middleware.ts`)

- Extend matcher to `["/dashboard/:path*", "/admin/:path*"]`.
- For `/admin/*`: if `session.role !== "admin"`, redirect to `/dashboard`.

---

## 4. Enforce `disabled` in existing flows

- `src/app/api/auth/login/route.ts`: reject login when `user.disabled`.
- `src/app/api/v1/send/route.ts`: after resolving the app, reject if the owner is
  disabled; write a `SendLog` on both success and `smtp_failed` (wrapped so logging
  never breaks the send).

---

## 5. Admin API routes (all guarded by `requireAdmin()`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/admin/users` | all users with role, disabled, app counts |
| PATCH | `/api/admin/users/[id]` | enable/disable (optionally toggle role) |
| DELETE | `/api/admin/users/[id]` | delete user + cascade their apps |
| GET | `/api/admin/apps` | all apps with owner email |
| DELETE | `/api/admin/apps/[id]` | delete an app |
| GET | `/api/admin/logs` | paginated send logs |

**Safety guards:** an admin cannot disable/delete themselves, and cannot remove the
last remaining admin.

---

## 6. Admin UI (`src/app/admin/...`)

- `admin/page.tsx` — overview (counts + nav)
- `admin/users/` — user table with enable/disable + delete actions
- `admin/apps/` — all-apps table with delete
- `admin/logs/` — send-log table
- Add a conditional **"Admin"** link in the user dashboard, shown only when
  `role === "admin"`.

---

## 7. Resolved decisions

- **Promote via UI:** the admin Users page can promote/demote (`PATCH` with `role`),
  in addition to the DB flag. Bootstrapping the *first* admin is still DB-only.
- **Hard delete:** user deletion is a hard delete that cascades their apps and send
  logs. `disable` remains available as a reversible alternative.

---

## 8. Verification

- Manually set a user to `role: "admin"` in the DB, log in, confirm `/admin` loads and
  a non-admin gets redirected.
- Hit each `/api/admin/*` route as admin (200) and as a regular user (403).
- Submit via `/v1/send` and confirm a `SendLog` row appears; confirm a disabled user's
  app is rejected.

---

## Files touched

**New:** `src/models/SendLog.ts`, `src/app/admin/**`, `src/app/api/admin/**`,
admin guard in `src/lib/auth.ts`.

**Edited:** `src/models/User.ts`, `src/lib/jwt.ts`, `src/lib/auth.ts`,
`src/middleware.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/v1/send/route.ts`,
user dashboard nav.
