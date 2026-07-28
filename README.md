# Mail Sender

A middleware service that lets any website deliver its form submissions to an
email inbox — without the website owning any mail infrastructure. The destination
can be any provider: Gmail, Zoho, Outlook or your own domain.

A visitor fills out a form on your site and clicks **Send**. Your frontend
`POST`s the form fields (plus a secret key) to this service. Mail Sender verifies
the secret, renders the submitted fields with the app's chosen **mail design**,
and emails it — from **our** Gmail account — to the **destination address** you
configured when you registered the app.

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
POST /v1/send            ← called by the website frontend
  Authorization: Bearer <secret key>
  body: { name, message, ... }
        │
        ▼
Mail Sender API
  1. read + verify the secret key   ──► invalid → 401
  2. render the fields with the app's chosen mail design
  3. send email via our Gmail (SMTP) ──► configured destination address
        │
        ▼
202 Accepted
```

The dashboard (register / login / register-app) and the REST API run in the same
Next.js app. Users, apps, and hashed secret keys live in MongoDB. Email is sent
with Nodemailer over Gmail SMTP.

## Tech stack

- **Next.js 15** (App Router) — dashboard + REST API routes
- **MongoDB** (via Mongoose) — users, registered apps, hashed secret keys
- **Nodemailer + Gmail SMTP** — sends the email
- **jose** (JWT sessions) + **bcryptjs** (password / secret hashing) + **zod** (validation)

The `/v1/send` route runs on the **Node.js runtime** (not Edge) so Nodemailer can
open an SMTP socket.

## Prerequisites

- **Node.js 20+**
- A **MongoDB** instance (local or hosted)
- A **Gmail account** with an [App Password](https://myaccount.google.com/apppasswords)
  (2-Step Verification must be enabled — the regular account password will not work)

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
| `APP_URL` | Base URL of the app (e.g. `http://localhost:3000`). Used in password-reset links. |
| `AUTH_SECRET` | JWT session signing secret. Generate with `openssl rand -base64 32`. |
| `MONGO_URI` | MongoDB connection string. URL-encode special chars in the password (`@` → `%40`). |
| `SMTP_USER` | The Gmail address that **sends** the mail (ours). |
| `SMTP_PASS` | The 16-char Gmail **App Password** (not the account password). |
| `SMTP_FROM` | Optional. Defaults to `SMTP_USER`. |

`.env*` files are gitignored and excluded from the Docker image — never commit secrets.

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

1. **Register** an account (email + password) at `/register`, then **log in**.
2. From the **dashboard**, register an app by providing a website name, the
   **destination email** (where submissions land — any provider) and one of the
   five **mail designs**. A **secret key** is generated and shown **once** — copy
   it now, it is stored only as a hash. The design can be changed later from the
   same screen; the destination and design are shown on each app row.
3. Wire your website's form to call the API with that key:

```http
POST /v1/send
Authorization: Bearer <secret key>
Content-Type: application/json

{ "name": "Jane", "message": "Hello there", "phone": "12345" }
```

Each top-level field becomes one row of the HTML email, with a `Key: value`
plain-text alternative:

```
Name: Jane
Message: Hello there
Phone: 12345
```

**Responses**

| Status | Meaning |
|---|---|
| `202` | Accepted — email sent to the configured address. |
| `400` | Bad request (missing/invalid body). |
| `401` | Secret key missing or invalid. |
| `502` | Mail send failed. |

Forgot your password? Use the **"Forgot password?"** link on the login page — a
single-use, time-limited reset link is emailed via the same Gmail mailer.

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
      auth/            register, login, logout, forgot/reset password
      apps/            register + list apps, change an app's mail design
      templates/       design previews for the dashboard picker
      v1/send/         the public send endpoint (Node runtime)
      health/          health check
    dashboard/         apps manager UI
    login/ register/ forgot-password/ reset-password/
  lib/                 auth, db, jwt, mailer, password, secret, env, flatten, templates
  models/              User, App, SendLog (Mongoose)
  middleware.ts        session gating
deploy/                VPS deploy — nginx.conf, setup.sh, deploy.sh, systemd unit
scripts/               one-off data migrations
k8s/                   Kubernetes manifests
Dockerfile             production image
docs/SPEC.md           source-of-truth spec (Step 1)
docs/MAIL_TEMPLATES_SPEC.md  mail designs + any-provider destinations
```
