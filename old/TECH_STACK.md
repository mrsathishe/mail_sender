# Mail Sender — Architecture & Tech Decision (v3, Next.js)

> Supersedes v2. Same multi-tenant SaaS shape; framework switched from Fastify to **Next.js 15 (App Router)** because the dashboard + future template designer make full-stack React the right fit. Updated 2026-06-05.

---

## 1. What We're Building

A SaaS where:

1. **Users sign up** for a dashboard account (email + password, Google OAuth later).
2. **Users register "apps"** — one per environment (`dev` / `uat` / `prod`). Each app has:
   - A friendly name (e.g. "Acme Website — prod")
   - A registered domain (e.g. `acme.com`) — used for optional Origin checks
   - A destination email (where feedback ends up, e.g. `support@acme.com`)
   - An auto-generated API key (shown **once** at creation)
   - A call mode: `browser`, `server`, or `both`
3. **Customer's website / backend** calls our API with that key:
   ```
   POST https://app.mailsender.example/v1/send
   Authorization: Bearer mks_live_<key>
   Content-Type: application/json

   { "subject": "Feedback", "name": "Jane", "message": "Hello" }
   ```
4. **We send the payload** as a plain-text email — flattened to a single string — from **our** Gmail account to the app's configured destination email.

Future (out of v1): drag-and-drop template designer in the dashboard, HTML emails, attachments, webhooks, analytics. Next.js is chosen specifically because this UI work is on the roadmap.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | One repo for dashboard + public API; React Server Components + Server Actions for the future designer |
| Runtime | Node.js 20 LTS | LTS until Apr 2026; **Nodemailer requires Node runtime — never Edge** |
| Language | TypeScript (strict) | — |
| Database | **MongoDB 7** | User's choice |
| ODM | **Mongoose 8** | Schemas, indexes-as-code, hooks |
| Auth | **Auth.js v5 (NextAuth)** with Credentials + Google providers | Drop-in cookie sessions, JWT strategy required for Credentials |
| Password hashing | **argon2** | Current best practice |
| API-key gen | Built-in `crypto.randomBytes` | No dep; SHA-256 the key for storage |
| Mail | **Nodemailer** + Gmail SMTP (App Password) | One sender Gmail (ours); destination is per-app from DB |
| Validation | **Zod** | One schema for body validation + TS types |
| Forms (dashboard) | **react-hook-form** + **zod resolver** + **Server Actions** | Type-safe forms, no client-side fetch wiring |
| UI | **Tailwind CSS** + **shadcn/ui** | Sensible defaults, easy to customize for the future designer |
| Logging | **Pino** | JSON logs, fast, works in Node runtime |
| Rate limit | **MongoDB TTL counter** (v1) → **@upstash/ratelimit** (v2 if needed) | Per-API-key, no extra infra in v1 |
| Security headers | **next-secure-headers** or `headers()` in `next.config.ts` | CSP, HSTS, etc. |
| Testing | **Vitest** + **Playwright** + **mongodb-memory-server** | Unit + E2E + real Mongo |
| Lint/format | ESLint + Prettier | — |

**Critical constraint:** the `/v1/send` Route Handler **must** declare `export const runtime = 'nodejs'`. The Edge runtime cannot open SMTP sockets, so Nodemailer would fail.

---

## 3. Data Model (MongoDB) — unchanged from v2

### `users`
```ts
{
  _id: ObjectId,
  email: string,                  // unique, lowercased
  passwordHash: string,           // argon2id (null if user signed up via Google)
  emailVerified: Date | null,     // Auth.js convention
  name: string | null,
  image: string | null,           // Google avatar etc.
  createdAt: Date,
  updatedAt: Date
}
```
Indexes: `{ email: 1 }` unique.

### `apps`
```ts
{
  _id: ObjectId,
  userId: ObjectId,
  name: string,
  environment: 'dev' | 'uat' | 'prod',
  domain: string,                 // "acme.com" (no scheme)
  destinationEmail: string,
  callMode: 'browser' | 'server' | 'both',
  apiKeyPrefix: string,           // "mks_live_8h2k" (visible in dashboard)
  apiKeyHash: string,             // sha256 of full key (lookup key)
  active: boolean,
  createdAt: Date,
  lastUsedAt: Date | null,
  rateLimit: { perMinute: number, perDay: number }   // defaults: 30 / 1000
}
```
Indexes: `{ userId: 1, environment: 1 }`, `{ apiKeyHash: 1 }` unique.

### `mail_logs`
```ts
{
  _id: ObjectId,
  appId: ObjectId,
  status: 'sent' | 'failed' | 'rejected',
  reason?: string,
  subject: string,
  bytes: number,
  origin?: string,
  ip: string,
  createdAt: Date
}
```
Indexes: `{ appId: 1, createdAt: -1 }`, TTL on `createdAt` (90 days).

### `rate_counters` (new — for the Mongo-based limiter)
```ts
{
  _id: string,                    // `${appId}:${windowStart}` (minute or day bucket)
  appId: ObjectId,
  count: number,
  expiresAt: Date                 // TTL index — auto-purged
}
```

> **Why a separate collection** rather than embedding logs/counters in `apps`: per-app log volume is unbounded; embedding would blow past Mongo's 16 MB document limit and cause hot-document write contention.

---

## 4. Authentication — Auth.js v5

### 4a. User login (dashboard)
- **Credentials provider** (email + password): verify against `users.passwordHash` with argon2.
- **Google provider** (later): drop in `GoogleProvider({ clientId, clientSecret })`. Match existing user by email.
- **Session strategy:** `jwt` (mandatory for Credentials provider). Auth.js sets an httpOnly, Secure, SameSite=Lax cookie automatically.
- **Adapter:** `@auth/mongodb-adapter` for the OAuth account linking tables (only needed once Google login is added).

```ts
// lib/auth.ts
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import argon2 from "argon2"
import { User } from "@/models/User"
import { connectDB } from "@/lib/db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        await connectDB()
        const user = await User.findOne({ email: String(creds.email).toLowerCase() })
        if (!user?.passwordHash) return null
        const ok = await argon2.verify(user.passwordHash, String(creds.password))
        return ok ? { id: user._id.toString(), email: user.email } : null
      },
    }),
  ],
  pages: { signIn: "/login" },
})
```

Dashboard pages and Server Actions check `await auth()` to gate access.

### 4b. API-key auth (the public `/v1/send` endpoint)
- Key format: `mks_<env>_<32 random base64url chars>`
- On creation: generate, **show full key once** in dashboard, store only `sha256(key)` and a 12-char `apiKeyPrefix`.
- On request: extract `Authorization: Bearer <key>` → `sha256(key)` → lookup `apps` by `apiKeyHash` (unique index, single query).
- Never log the full key. Never compare in plaintext.

---

## 5. CORS / Origin handling — per-app via `callMode`

| `callMode` | Browser CORS preflight | Origin header check | Use case |
|---|---|---|---|
| `browser` | `Access-Control-Allow-Origin: <app.domain>` | Must match | Static-site widget |
| `server`  | No CORS headers | None | Backend-to-backend |
| `both`    | Permissive preflight; if `Origin` present, must match `domain`; if absent, treated as server call | Conditional | Mixed |

Implemented in `middleware.ts` (which can read the API key from the header, look up the app, and set CORS headers dynamically — but middleware runs in Edge by default; for DB access we either:
1. Set `export const config = { runtime: 'nodejs' }` on middleware (Next.js 15 supports this), **or**
2. Skip middleware for `/v1/send` and handle CORS inside the Route Handler itself (simpler, what we'll do in v1).

> **Heads-up on browser-side keys:** any key shipped to a browser is *inherently* extractable. Origin checks stop honest browsers; an attacker can replay the key from their own server with a spoofed Origin. We mitigate (tight rate limits + captcha later), we don't eliminate.

---

## 6. API Surface (v1)

### Public — customer-facing (Route Handler)
```http
POST /v1/send
Authorization: Bearer mks_live_<key>
Content-Type: application/json

{ "subject": "<= 200 chars",  // required
  "...": "any other fields"  } // flattened into body

→ 202 { "id": "<log id>" }
→ 400 { "error": "validation", "details": [...] }
→ 401 { "error": "invalid_key" }
→ 403 { "error": "origin_not_allowed" }
→ 429 { "error": "rate_limited", "retryAfter": 42 }
→ 502 { "error": "smtp_failed" }
```

**Body flattening (v1 plain-text rule):**
```
Subject: <subject>
From:    <our Gmail>
To:      <app.destinationEmail>
Reply-To: <fromEmail if provided, else our Gmail>

<for each top-level key except "subject">
  <key>: <value, JSON.stringify if non-string>
```

### Dashboard
- Pages: `/login`, `/signup`, `/apps`, `/apps/new`, `/apps/[id]`, `/apps/[id]/logs`
- Mutations via **Server Actions** in `actions/`:
  - `signupAction(email, password)`
  - `createAppAction(input)` → returns API key once
  - `updateAppAction(id, patch)`
  - `rotateApiKeyAction(id)` → returns new key once
  - `deleteAppAction(id)`
- Logs list paginated via Route Handler `/api/apps/[id]/logs?cursor=...` (cursor-based; large datasets shouldn't be Server-Action-shaped).

### Auth.js
- `app/api/auth/[...nextauth]/route.ts` exposes the standard endpoints (signin, signout, callback, csrf, session).

---

## 7. Project Layout

```
mail_sender/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                 # auth-gated, navbar
│   │   ├── apps/
│   │   │   ├── page.tsx               # list
│   │   │   ├── new/page.tsx           # create
│   │   │   └── [id]/
│   │   │       ├── page.tsx           # detail / settings
│   │   │       └── logs/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── apps/[id]/logs/route.ts    # paginated logs
│   │   └── v1/
│   │       └── send/route.ts          # PUBLIC API — runtime='nodejs'
│   ├── layout.tsx
│   └── page.tsx                       # marketing/landing
├── actions/
│   ├── auth.ts                        # signupAction
│   └── apps.ts                        # CRUD + rotate-key
├── lib/
│   ├── db.ts                          # mongoose connect (global-cached)
│   ├── auth.ts                        # NextAuth config
│   ├── mailer.ts                      # nodemailer transport singleton
│   ├── apiKey.ts                      # generate / hash / verify
│   ├── flatten.ts                     # JSON → plain text body
│   ├── rateLimit.ts                   # mongo TTL counter
│   └── env.ts                         # zod-validated process.env
├── models/
│   ├── User.ts
│   ├── App.ts
│   ├── MailLog.ts
│   └── RateCounter.ts
├── components/                        # shadcn/ui + custom
├── middleware.ts                      # auth-gating dashboard routes
├── next.config.ts
├── tsconfig.json
└── package.json
```

### The Mongoose connection gotcha (Next.js dev mode)
Next.js hot-reload re-imports modules; without caching you'll create a new Mongoose connection every save until the pool exhausts. Standard fix:

```ts
// lib/db.ts
import mongoose from "mongoose"

const uri = process.env.MONGO_URI!
let cached = (global as any)._mongoose as { conn: any; promise: any } | undefined
if (!cached) cached = (global as any)._mongoose = { conn: null, promise: null }

export async function connectDB() {
  if (cached!.conn) return cached!.conn
  if (!cached!.promise) cached!.promise = mongoose.connect(uri, { bufferCommands: false })
  cached!.conn = await cached!.promise
  return cached!.conn
}
```

---

## 8. Environment Variables

```
NODE_ENV=production

# MongoDB
MONGO_URI=mongodb://localhost:27017/mailsender

# Sender Gmail (ours)
SMTP_USER=ouraccount@gmail.com
SMTP_PASS=<16-char app password>

# Auth.js
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=http://localhost:3000          # https://app.mailsender.example in prod
# Later, when Google login is added:
# AUTH_GOOGLE_ID=...
# AUTH_GOOGLE_SECRET=...

# Defaults
DEFAULT_RATE_PER_MINUTE=30
DEFAULT_RATE_PER_DAY=1000
LOG_RETENTION_DAYS=90
```

---

## 9. Security Checklist (must-do before public launch)

1. **API keys hashed** (sha256) in DB; full key shown once and never retrievable.
2. **Argon2id** for passwords. Auth.js Credentials provider compares via `argon2.verify`.
3. **Auth.js cookie** is httpOnly + Secure + SameSite=Lax by default — keep it that way.
4. **Per-app rate limits** (default 30/min, 1000/day) backed by Mongo TTL counter; respond 429 with `Retry-After`.
5. **Body size cap ~16 KB** on `/v1/send` — enforce in the Route Handler before parsing.
6. **Strip `\r\n`** from any user-supplied subject/header field (header-injection guard).
7. **`destinationEmail` server-side only** — never read recipient from the request body.
8. **Origin allow-list** for `callMode: 'browser'` apps.
9. **Security headers** via `next-secure-headers` or `next.config.ts` `headers()` (CSP, HSTS, X-Frame-Options).
10. **No SMTP errors** echoed to clients — generic 502.
11. **Mongoose `strict: true`** on all schemas.
12. **`/v1/send` route MUST set `export const runtime = 'nodejs'`** — Edge runtime can't do SMTP.
13. **CSRF for Server Actions** — Next.js handles this automatically on same-origin POST; don't disable it.

---

## 10. Deployment Notes

- **Self-host on a VPS / Docker** is straightforward — Next.js runs as a normal Node process (`next start`).
- **Vercel** works for the dashboard, but the public `/v1/send` route must stay on the **Node.js runtime** (default; just don't switch to Edge). Cold starts on Vercel's Hobby plan can spike latency for low-traffic apps — acceptable for v1.
- MongoDB: Atlas free tier is fine to start; in prod, ensure connection pooling (`maxPoolSize ~10`) and use Atlas's IP allow-list.
- The sender Gmail's App Password lives only in env vars — never commit, rotate on suspected exposure.

---

## 11. Open Questions / Defer to v1.x

- **Email verification on signup** — required before public launch. Auth.js + Nodemailer, separate `email_verifications` collection or signed token.
- **Password reset flow** — same plumbing.
- **Captcha on `/v1/send`** for `callMode: browser` apps (Cloudflare Turnstile, free).
- **Background queue** (BullMQ + Redis) once SMTP latency or failure rate matters; v1 sends synchronously.
- **Switching rate limit to `@upstash/ratelimit`** once you're on serverless and Mongo round-trip cost matters.
- **Template designer** — explicitly future scope. Will live under `app/(dashboard)/apps/[id]/templates/`.
- **Plan tiers / billing** — not now.

---

## 12. Decision Summary

> **Next.js 15 (App Router) + TypeScript + Mongoose/MongoDB + Auth.js v5 + Argon2 + Nodemailer + Tailwind/shadcn.**
> One repo for dashboard + public API. Multi-tenant from day one: users → apps (one per env) → API keys. Single sender Gmail (ours, SMTP+App Password); destination email per-app from DB. Per-app `callMode` decides Origin enforcement. Plain-text body in v1 via JSON flattening; designer comes later. `/v1/send` route pinned to Node runtime so Nodemailer works.
