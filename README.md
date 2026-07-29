# Mailer by satz

A middleware service that lets any website deliver its form submissions to an
email inbox — without the website owning any mail infrastructure. The destination
can be any provider: Gmail, Zoho, Outlook or your own domain.

A visitor fills out a form on your site and clicks **Send**. Your **backend**
`POST`s the form fields (plus a secret key) to this service — the key is a
server-side credential, so a static site posts to a small route of its own that
forwards the submission. Mailer verifies the secret, checks the submission against
the fields that app declared, renders them with the app's chosen **mail design**,
and emails it — from **our own** sending account — to the **destination address**
you configured when you registered the app.

> This is **Step 1 (Basic)**. See [docs/SPEC.md](docs/SPEC.md) for the full,
> authoritative scope and what is deliberately left out (file handling details,
> rate limiting, OAuth login). Selectable mail designs and provider-agnostic
> destinations are specified in
> [docs/MAIL_TEMPLATES_SPEC.md](docs/MAIL_TEMPLATES_SPEC.md).

## How it works

```
Website form (name / message / file)
        │  click "Send"
        ▼
Your own backend route   ← holds the secret key; the browser never sees it
        │
        ▼
POST /v1/send            ← called server-to-server
  Authorization: Bearer <secret key>
  body: { name, message, ... }
        │
        ▼
Mailer API
  1. read + verify the secret key   ──► invalid → 401
  1b. destination confirmed?        ──► no → 403 destination_unverified
  2. render the fields with the app's chosen mail design
  3. send email via our SMTP account  ──► configured destination address
        │
        ▼
202 Accepted
```

The dashboard (register / login / register-app) and the REST API run in the same
Next.js app. Users, apps, and hashed secret keys live in MongoDB. Email is sent
with Nodemailer over our own SMTP account, configured from env.

## Tech stack

- **Next.js 15** (App Router) — dashboard + REST API routes
- **MongoDB** (via Mongoose) — users, registered apps, hashed secret keys
- **Nodemailer + our own SMTP account** — sends the email (host/port from env)
- **jose** (JWT sessions) + **bcryptjs** (password / secret hashing) + **zod** (validation)

The `/v1/send` route runs on the **Node.js runtime** (not Edge) so Nodemailer can
open an SMTP socket.

## Prerequisites

- **Node.js 20+**
- A **MongoDB** instance (local or hosted)
- An **SMTP account to send from** — any host. On Gmail/Workspace that means an
  [App Password](https://myaccount.google.com/apppasswords) (2-Step Verification
  must be enabled first; the regular account password will not work); on a
  transactional provider such as Resend it is an API key.

## Setup

```bash
# 1. Clone
git clone git@github.com:mrsathishe/mail_sender.git
cd mail_sender

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env
```

Then edit `.env`:

| Variable | Description |
|---|---|
| `APP_URL` | Base URL of the app (e.g. `http://localhost:3000`). Used in password-reset and destination-confirmation links. |
| `AUTH_SECRET` | JWT session signing secret. Generate with `openssl rand -base64 32`. |
| `MONGO_URI` | MongoDB connection string. URL-encode special chars in the password (`@` → `%40`). |
| `SMTP_HOST` | **Required.** Submission host of the sending account — e.g. `smtpout.secureserver.net` for GoDaddy Professional Email (not the MX host). |
| `SMTP_PORT` | Optional. Defaults to `587` (STARTTLS). Use `465` for implicit TLS. |
| `SMTP_SECURE` | Optional. Inferred from the port (`true` for 465) — set only if your host differs. |
| `SMTP_USER` | The account that **sends** the mail (ours) — the full email address. |
| `SMTP_PASS` | Its password: the mailbox password, a Gmail **App Password**, or the provider's API key. |
| `SMTP_FROM` | Optional. Defaults to `SMTP_USER`; may carry a display name, e.g. `"Mailer by satz" <mail@satz.co.in>`. |
| `SEND_APP_DAILY_LIMIT` | Optional. Emails one app may send per UTC day. Defaults to `500`; an invalid value throws rather than becoming unlimited. |
| `SPAM_SCORE_THRESHOLD` | Optional. Score at which a submission is refused with `422 spam_rejected`. Defaults to `6`; raise it to loosen the filter. |

`.env*` files are gitignored and excluded from the Docker image — never commit secrets.

Verify the mail settings before running the app — a wrong port/TLS pair otherwise
only shows up as a `502` inside a request:

```bash
node scripts/check-smtp.mjs                  # connect + authenticate
node scripts/check-smtp.mjs you@example.com  # also send one test message
```

## Run the application

### Development

```bash
npm run dev
```

Open http://localhost:3000. The dev server hot-reloads on change.

### Production

```bash
npm run build
npm start
```

### Health check

```bash
curl http://localhost:3000/api/health
```

## Using it

1. **Register** an account (email + password) at `/register`. We email an
   **8-character code**; enter it on `/verify-email` to activate the account. Until
   then every authed page redirects back there.
2. From the **dashboard**, register an app by providing a website name, the
   **destination email** (where submissions land — any provider), the **form
   fields** it will submit, and one of the five **mail designs**.
   - Tick **"send to my account address"** (or type the address you signed up with)
     and the app is ready immediately — the **secret key** is shown **once**, so
     copy it; only a hash is stored.
   - Any other address is emailed a code. The app is created with **no key**;
     entering the code confirms the address and issues the key.
   The fields and design can both be changed later from the same screen; the
   destination, confirmation status, fields and design are shown on each app row.
3. Call the API **from your server** with that key — it is a server-side
   credential, and a browser cannot make the call anyway: the key travels in an
   `Authorization` header, which a plain HTML form cannot set. A static site posts
   its form to a small route of its own that forwards the submission:

```http
POST /v1/send
Authorization: Bearer <secret key>
Content-Type: application/json

{ "name": "Jane", "message": "Hello there", "phone": "12345" }
```

Each declared field becomes one row of the HTML email, with a `Key: value`
plain-text alternative:

```
Name: Jane
Message: Hello there
Phone: 12345
```

**Form fields.** Every app declares which field names it accepts. A new one starts
with `name`, `email` and `message` **required** plus `phone` optional, and you can
add, rename or remove up to 25 of them from the dashboard. The check is strict: a
field you didn't declare is refused with `400 unknown_field` and a missing required
one with `400 missing_field` (both name the offending field), and no email is sent.
That is what stops a leaked key being used to mail arbitrary content to your inbox.
Names match case-insensitively, and rows always arrive in the order you declared —
an optional field you left out still shows as `—`, so the email layout never shifts.

**Sending limits.** Each app may send **500 emails per day** (UTC, reset at
midnight). A contact form never comes close; the limit is there so one runaway script
can't spend the shared sending allowance every other app depends on. Over it,
submissions are refused with `429 daily_limit_exceeded` — nothing is dropped
silently. It's a setting (`SEND_APP_DAILY_LIMIT`), so it can be raised per
deployment. An identical submission from the same app within **60 seconds** is
treated as the request you already made: `202` with `duplicate: true` and no second
email, so a double-clicked submit button is harmless. A failed send doesn't count as
a duplicate, so retrying after a `502` does deliver.

**Spam protection.** Two optional bot signals per app, plus content scoring that is
always on. Configure the first two from the app's **Spam guard** panel:

- a **honeypot** — you name a field, add it to the form as a hidden empty input, and
  anything that fills it is refused with `422 honeypot_filled`. The name is yours
  rather than one we publish, because a shared name is one every bot could learn to
  skip;
- a **minimum fill time** — you name a field carrying how long the form was on screen
  (elapsed milliseconds, or the render time as an epoch stamp or ISO date) and a
  minimum in seconds. Faster than that is `422 too_fast`, nothing usable in the field
  is `422 timing_missing`. A client clock running ahead of ours is never treated as a
  bot.

Neither field goes in your form-field list — both are removed from the submission
before it is checked, so they never appear in the email. **Content scoring** then
looks at link volume, anchor/BBCode markup, values that open with a mail header like
`bcc:`, a small phrase list and shouting; past `SPAM_SCORE_THRESHOLD` (default 6) the
submission is refused with `422 spam_rejected` and the reason is recorded in the app's
activity. Phrases alone can never reach the threshold — a real enquiry may
legitimately mention SEO or backlinks — so blocking needs a structural signal.
Nothing refused with a `422` costs you a send.

**Automatic reply.** An app can send a "we got your message" confirmation back to
whoever filled the form, from its **Auto-reply** panel: switch it on and optionally
write your own subject and message (blank uses the built-in wording). It goes only to
an address found in the submission, carries your text only — nothing the visitor typed
is quoted back — and is rendered in the app's mail design. It is a second email, so it
uses a second send from the daily allowance; if the day runs out, the submission still
delivers and the confirmation is what gets skipped.

**Activity.** Each app row has an **Activity** panel showing what actually happened:
counts of sent, failed and blocked, today's usage against the limit, and the newest
attempts with the mail server's own error or the guard's reason. Rows are kept for 90
days, and the auto-reply is labelled separately from the submission.

**Responses**

| Status | Meaning |
|---|---|
| `202` | Accepted — email sent to the configured address. |
| `202` | `duplicate: true` — identical submission within 60s; no second email sent. |
| `400` | Bad request (missing/invalid body). |
| `400` | `unknown_field` / `missing_field` — the submission broke the app's field list. |
| `400` | `body_too_deep` — the body nests more than 5 levels. |
| `401` | Secret key missing or invalid. |
| `403` | `destination_unverified` — the destination hasn't confirmed its address. |
| `413` | `payload_too_large` — the request body exceeded 500KB. |
| `422` | `honeypot_filled` / `too_fast` / `timing_missing` — a bot signal fired. |
| `422` | `spam_rejected` — the content scored past the spam threshold. |
| `429` | `daily_limit_exceeded` — the app used its 500 sends for the day. |
| `502` | Mail send failed. |

**Destination confirmation.** A destination other than your own account address is
emailed an 8-character code, and the app is created with no secret key at all;
entering the code on the dashboard confirms the address and issues the key. Until
then `/v1/send` rejects every submission with `403 destination_unverified` — this
is what stops the service being pointed at an inbox that never asked for the mail.
Codes last 15 minutes and allow 5 attempts; the dashboard can send a fresh one.

Forgot your password? Use the **"Forgot password?"** link on the login page — a
single-use, time-limited reset link is emailed via the same mailer.

## Deployment

### VPS (nginx + systemd)

Runs the app in place from the repo clone — no Docker. nginx reverse-proxies all
traffic to the Next.js server, which systemd keeps alive on `127.0.0.1:3100`.
Scripts live in [deploy/](deploy/).

```bash
# On the VPS, in your home folder:
git clone git@github.com:mrsathishe/mail_sender.git
cd mail_sender

# One-time: installs deps, builds, creates .env, installs+starts the systemd service.
npm run setup
nano .env                       # set AUTH_SECRET, MONGO_URI, SMTP_*
sudo systemctl restart mail-sender

# nginx site + HTTPS:
sudo cp deploy/nginx.conf /etc/nginx/sites-available/mail-sender
sudo ln -s /etc/nginx/sites-available/mail-sender /etc/nginx/sites-enabled/mail-sender
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mail.satz.co.in    # edit the domain in nginx.conf first
```

Later updates: `git pull && npm run deploy` (installs deps, rebuilds, restarts the
service). Check status/logs with `sudo systemctl status mail-sender` and
`journalctl -u mail-sender -f`.

#### One-off migration (mail designs release)

The release that renamed `destinationGmail` → `destinationEmail` and added
`templateId` needs a one-time data migration. Run it with the service stopped so
the running build never reads half-migrated documents:

```bash
sudo systemctl stop mail-sender
git pull && npm ci
node scripts/migrate-app-fields.mjs      # idempotent — safe to re-run
npm run deploy                            # rebuilds + restarts
```

#### One-off migration (email OTP verification release)

The release that added OTP verification grandfathers existing accounts as verified,
but marks an app's destination unverified unless it *is* the owner's own address.
Those apps stop delivering (`403 destination_unverified`) until the owner enters a
code from the dashboard — which also issues a new secret key, so those sites need
updating. Tell users before running it.

```bash
sudo systemctl stop mail-sender
git pull && npm ci
node scripts/migrate-destination-verification.mjs   # idempotent — safe to re-run
npm run deploy
```

#### One-off migration (send-log retention release)

The release that added a **90-day TTL** to `sendlogs` plus the
`{ appId: 1, createdAt: -1 }` index. Mongoose would build both itself on the next
boot, but it never drops the superseded single-field `appId` index, and an
unattended TTL build is not something to discover mid-deploy — so the script does
it explicitly and prints how many rows the TTL is about to delete.

**This deletes send-log rows older than 90 days, permanently, within a minute of
running.** If the log is wanted as a long-term audit trail, change
`SEND_LOG_TTL_DAYS` in [src/models/SendLog.ts](src/models/SendLog.ts) first.

```bash
sudo systemctl stop mail-sender
git pull && npm ci
node scripts/migrate-sendlog-indexes.mjs   # idempotent — safe to re-run
npm run deploy
```

#### This release (spam guards, auto-reply, activity) — no migration

`spamGuard`, `autoResponder`, `SendLog.kind` and the two `blocked_*` statuses are all
**additive**, so existing documents stay readable and every app keeps behaving exactly
as before (both new settings default to off). A plain update is enough:

```bash
git pull && npm run deploy
```

`SPAM_SCORE_THRESHOLD` is optional — leave it out and the filter uses `6`.

#### Starting over on an empty database

Wipes the five collections in [docs/SPEC.md](docs/SPEC.md) §7 and nothing else, so it
is safe against a database shared with other apps. **Every account, app and secret key
is destroyed** — any website still posting to `/v1/send` gets `401 invalid_key` until
its owner registers again. Both flags are required, and the database name must match
the one in `MONGO_URI`:

```bash
sudo systemctl stop mail-sender
node scripts/reset-db.mjs                       # dry run: prints the counts, changes nothing
node scripts/reset-db.mjs --db mail_sender --yes # actually drops them
npm run deploy
```

Indexes are dropped with the data and rebuilt from the current schemas on first write,
so none of the `migrate-*.mjs` scripts need running afterwards. Then register an
account, verify it with the emailed code, and promote the first admin directly in the
DB (`db.users.updateOne({ email: "you@example.com" }, { $set: { role: "admin" } })`).

### Docker (production-only image)

```bash
docker build -t mail-sender .
docker run -p 3000:3000 --env-file .env.production mail-sender
```

Multi-stage build on `node:20-alpine`, runs as a non-root user, uses Next.js
**standalone** output. Secrets are injected at **runtime** via env — never baked
into the image.

### Kubernetes

Manifests (namespace, deployment, service, ingress, HPA, kustomization) are in
[k8s/](k8s/). See [k8s/README.md](k8s/README.md) for details.

## Project layout

```
src/
  app/
    api/
      auth/            register, login, logout, forgot/reset password, email OTP
      apps/            register + list apps, edit fields/design/guard/auto-reply,
                       confirm/resend destination, per-app activity
      templates/       design previews for the dashboard picker
      v1/send/         the public send endpoint (Node runtime)
      health/          health check
    page.tsx           public landing page (signed-in visitors → /dashboard)
    dashboard/         apps manager UI
    login/ register/ forgot-password/ reset-password/ verify-email/
    robots.ts sitemap.ts manifest.ts opengraph-image.tsx apple-icon.tsx icon.svg
  components/          site shell — header, mobile nav, footer, logo, page header
  lib/                 auth, db, jwt, mailer, password, secret, env, flatten,
                       templates, fields, bot-guard, spam-score, auto-responder,
                       api-docs, base-url, brand, otp, verification-mail
  models/              User, App, SendLog, DailyUsage, SendDedupe (Mongoose)
  middleware.ts        session + email-verification gating
public/                logo-lockup.png (hero/OG), logo-mark.png (header), icon-512.png
deploy/                VPS deploy — nginx.conf, setup.sh, deploy.sh, systemd unit
scripts/               one-off data migrations + reset-db.mjs (destructive wipe)
k8s/                   Kubernetes manifests
Dockerfile             production image
docs/SPEC.md           source-of-truth spec (Step 1)
docs/MAIL_TEMPLATES_SPEC.md  mail designs + any-provider destinations
```
