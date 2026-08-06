# Mailer by satz

A middleware service that lets any website deliver its form submissions to an
email inbox — without the website owning any mail infrastructure. The destination
can be any provider: Gmail, Zoho, Outlook or your own domain.

A visitor fills out a form on your site and clicks **Send**. One `fetch` call
`POST`s the form fields (plus a secret key) to this service — from the page itself,
your own backend or a shell script, since the endpoint accepts cross-origin calls
and answers the same way to all three. Mailer verifies the secret, checks the
submission against the fields that app declared, renders them with the app's chosen
**mail design**, and emails it — from **our own** sending account — to the
**destination address** you configured when you registered the app.

> This is **Step 1 (Basic)**. This README and [CLAUDE.md](CLAUDE.md) are the
> authoritative description of what the service does — including the selectable mail
> designs, provider-agnostic destinations and opt-in file attachments — and what is
> deliberately left out (OAuth login, a platform-wide send budget).

## How it works

```
Website form (name / message / file)
        │  submit handler, fetch(FormData)
        ▼
POST /v1/send            ← from the page, your server or curl; same either way
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
200 OK
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

#### Local development with no database (mock mode)

`npm run dev` needs neither MongoDB nor an SMTP account if `MOCK_MODE=1` is set: the five
models are swapped for the in-memory ones in [src/mocks/mock-db.ts](src/mocks/mock-db.ts),
seeded from [src/mocks/mock-data.ts](src/mocks/mock-data.ts), and mail is printed to the
terminal instead of being sent.

Put it in **`.env.development`** rather than `.env` — Next loads that file for `npm run dev`
and never for `npm run build` / `npm start`, so the mock cannot follow a deploy. `mockMode`
in [src/lib/env.ts](src/lib/env.ts) also requires `NODE_ENV=development`, which is the
backstop:

```bash
# .env.development  (git-ignored)
MOCK_MODE=1
AUTH_SECRET=any-throwaway-value-openssl-rand-base64-32
```

Sign in with either seeded account:

| Email | Password | Role |
| --- | --- | --- |
| `mock@satz.co.in` | `Mock@12345` | user — owns three apps, one of them awaiting confirmation |
| `admin@satz.co.in` | `Admin@12345` | admin — the `/admin` pages |

The pending destination code on the unconfirmed app is `TESTCODE`. A code issued *during* a
mock session is printed to the terminal, which is the only inbox there is. Edits made while
clicking around survive hot-reload (the store is cached on `global`) and are lost when the
dev server restarts. Nothing about mock mode reaches the real database in `.env` — that is
the point of it. To exercise `/v1/send` end to end, or registration and password reset,
which need real mail, drop `MOCK_MODE` and point `MONGO_URI` at a database.

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
2. From the **dashboard**, follow **Register an app** to `/dashboard/register`. The
   whole thing is one page of numbered sections: a website name, the **destination
   email** (where submissions land — any provider), the **form fields** it will
   submit, one of the five **mail designs**, and then the three optional settings —
   **auto-reply**, **spam guard** and **attachments**, each marked optional and off
   unless you switch it on. A review of the choices is the last section, and the key
   is issued from there.
   - Tick **"send to my account address"** (or type the address you signed up with)
     and the app is ready immediately — the **secret key** is shown **once**, so
     copy it; only a hash is stored.
   - Any other address is emailed a code. The app is created with **no key**;
     entering the code confirms the address and issues the key.
   Every one of those settings can be changed later from the app's row on the
   dashboard, through the row's single **Actions** menu — edit fields, change design,
   auto-reply, spam guard, attachments, get the code, regenerate key. Opening one turns
   the menu into **Cancel**, so a row is only ever doing one thing at a time. The
   destination, confirmation status, fields and design are shown on each row, and an
   app that has a key carries its **Activity** panel at the bottom of the row.
3. Call the API with that key from wherever your form lives — the page's own submit
   handler, your backend, or curl. Cross-origin calls are accepted from any origin,
   so no route of your own is needed. The one thing that won't work is a plain HTML
   form submit: the key travels in an `Authorization` header, which a native form
   post cannot set, so use `fetch`. A key in page JavaScript is readable by anyone,
   so put it in an environment variable where you have somewhere server-side to do
   that; where you don't, a scraped key still reaches only that app's confirmed
   destination, only in its declared fields, and only up to its daily limit.

```http
POST /v1/send
Authorization: Bearer <secret key>
Content-Type: application/json

{ "name": "Jane", "message": "Hello there", "phone": "12345" }
```

To attach files, post `multipart/form-data` to that **same** endpoint — same key, same
URL, same fields, same responses, with the whole request capped at 5MB rather than 500KB.
Switch attachments on for the app first (dashboard → **Attachments**), or a file part is
refused with `422 attachments_not_enabled` and nothing is sent. Accepted types are checked
by their *contents*, not their name. The dashboard's **Get the code** action on each app row
generates the `fetch` call that sends your form and a cURL example, both from that app's own
fields and settings, so the snippet always matches the contract the endpoint enforces. The
form markup itself is yours — what you cannot guess is the request, so that is what is
generated, with any guard or file inputs your app needs named in comments above the call. Every
response is JSON plus an HTTP status — the API never answers with a redirect, so showing a
message or moving the visitor to a thank-you page is your site's decision.

Each declared field becomes one row of the HTML email, with a `Key: value`
plain-text alternative:

```
Name: Jane
Message: Hello there
Phone: 12345
```

**Form fields.** Every app declares its fields as a **pair**: the `id` your form posts,
and the label the email row carries. So `company` / "Company Name" means a submission of
`{ "company": "Acme Inc." }` arrives as a row reading `Company Name: Acme Inc.` — the label
is your text, used as written, so nothing turns `Order ID` into `Order id`. A new app
starts with `name`, `email`, `phone` and `message`, and you can add, rename or remove up to
25 of them from the dashboard.

The check is strict in one direction only: a field you didn't declare is refused with
`400 unknown_field` (naming it) and no email is sent — that is what stops a leaked key
being used to mail arbitrary content to your inbox. Nothing is **required**, because
whether a visitor had to fill something in is your own form's check, in your own words,
next to the input; a field that arrives empty is delivered as `—`. Ids match
case-insensitively, and rows always arrive in the order you declared, so the email layout
never shifts.

**Sending limits.** Each app may send **500 emails per day** (UTC, reset at
midnight). A contact form never comes close; the limit is there so one runaway script
can't spend the shared sending allowance every other app depends on. Over it,
submissions are refused with `429 daily_limit_exceeded` — nothing is dropped
silently. It's a setting (`SEND_APP_DAILY_LIMIT`), so it can be raised per
deployment. An identical submission from the same app within **60 seconds** is
treated as the request you already made: `200` with `duplicate: true` and no second
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
| `200` | Email sent to the configured address. |
| `200` | `duplicate: true` — identical submission within 60s; no second email sent. |
| `400` | Bad request (missing/invalid body). |
| `400` | `unknown_field` — the submission contained a field the app doesn't declare. |
| `400` | `body_too_deep` — the body nests more than 5 levels. |
| `401` | Secret key missing or invalid. |
| `403` | `destination_unverified` — the destination hasn't confirmed its address. |
| `413` | `payload_too_large` — the request body exceeded 500KB, or 5MB for an app with attachments switched on. |
| `422` | `honeypot_filled` / `too_fast` / `timing_missing` — a bot signal fired. |
| `422` | `spam_rejected` — the content scored past the spam threshold. |
| `422` | `attachments_not_enabled` / `too_many_files` / `unsupported_file_type` / `empty_file` / `invalid_filename` — an attachment was refused. |
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

**Need help?** `/contact` carries the email address, phone number and a **help form**,
plus the FAQ. The form is public, so it runs the same guards `/v1/send` does — a
honeypot, a minimum fill time, content scoring, and one message per client per minute.

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

> **File uploads need the nginx config recopied.** `client_max_body_size` is
> per-location: the server default stays at `1m`, and `deploy/nginx.conf` raises it to
> `6m` on `/api/v1/send` and `/api/contact`. An older copy of the file rejects every
> upload with an nginx `413` before the app ever sees it, so redo the two `cp` /
> `nginx -t` steps above on an existing VPS — and do it *before* `npm run deploy`, since
> the app alone cannot raise the edge limit. No database migration is needed —
> `attachments` defaults to off on every app, and it is that per-app setting, not the
> URL, that decides which of the two body caps applies.

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

#### One-off migration (field ids and labels release)

A field used to be `{ name, required }`, where `name` was both the key the form posted and
the source of the row's label. It is now `{ id, name }` — the posted key and the label you
write — and there is no `required` any more, so `/v1/send` no longer answers
`400 missing_field`: an empty value is delivered as empty, because whether a visitor had to
fill it in is your own form's check.

Not strictly required for correctness — `resolveFields()` reads a legacy row as
`{ id: <that name>, name: titleize(<that name>) }`, which is exactly what the script writes
— but a document that says what it means is worth having, and the label is seeded with the
same wording the old renderer produced, so no email changes on the day it runs. Owners can
then edit `Order id` into `Order ID`, which is the point of storing it.

```bash
sudo systemctl stop mail-sender
git pull && npm ci
node scripts/migrate-app-field-ids.mjs   # idempotent — apps already carrying `id` are skipped
npm run deploy
```

#### The spam guards, auto-reply and activity release — no migration

`spamGuard`, `autoResponder`, `SendLog.kind` and the two `blocked_*` statuses are all
**additive**, so existing documents stay readable and every app keeps behaving exactly
as before (both new settings default to off). A plain update is enough:

```bash
git pull && npm run deploy
```

`SPAM_SCORE_THRESHOLD` is optional — leave it out and the filter uses `6`.

#### Starting over on an empty database

Wipes the five collections this service owns and nothing else, so it
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
      v1/send/         the public send endpoint — JSON or multipart, with file
                       uploads up to 5MB for apps that enable them (Node runtime)
      contact/         our own help form (internal, unauthenticated, guarded)
      health/          health check
    page.tsx           public landing page (signed-in visitors → /dashboard)
    contact/           contact details, help form, FAQ
    dashboard/         apps manager UI + register/ (the register page's sections)
    login/ register/ forgot-password/ reset-password/ verify-email/
    robots.ts sitemap.ts manifest.ts opengraph-image.tsx apple-icon.tsx icon.svg
  components/          site shell — header, mobile nav, footer, logo, page header
  lib/                 auth, db, jwt, mailer, password, secret, env, flatten,
                       templates, fields, bot-guard, spam-score, auto-responder,
                       api-docs, base-url, brand, seo, otp, verification-mail
  models/              User, App, SendLog, DailyUsage, SendDedupe — each one either the
                       Mongoose model or its mock, chosen by MOCK_MODE
  mocks/               mock-data.ts (the values) + mock-db.ts (in-memory models),
                       read only in development, never in a build
  proxy.ts             session + email-verification gating (Next 16's middleware hook)
public/                logo-lockup.png (hero/OG), logo-mark.png (header), icon-512.png
deploy/                VPS deploy — nginx.conf, setup.sh, deploy.sh, systemd unit
scripts/               one-off data migrations + reset-db.mjs (destructive wipe)
k8s/                   Kubernetes manifests
Dockerfile             production image
docs/                  VPS deploy playbook
```
