# Mail Sender

A middleware service that lets any website deliver its form submissions to a
Gmail inbox — without the website owning any mail infrastructure.

A visitor fills out a form on your site and clicks **Send**. Your frontend
`POST`s the form fields (plus a secret key) to this service. Mail Sender verifies
the secret, turns the submitted fields into a readable message, and emails it —
from **our** Gmail account — to the **destination Gmail** you configured when you
registered the app.

> This is **Step 1 (Basic)**. See [SPEC.md](SPEC.md) for the full, authoritative
> scope and what is deliberately left out (file handling details, key rotation,
> rate limiting, OAuth login, HTML templates).

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
  2. build message text from the fields
  3. send email via our Gmail (SMTP) ──► configured destination Gmail
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
2. From the **dashboard**, register an app by providing a website name and the
   **destination Gmail** (where submissions land). A **secret key** is generated
   and shown **once** — copy it now, it is stored only as a hash.
3. Wire your website's form to call the API with that key:

```http
POST /v1/send
Authorization: Bearer <secret key>
Content-Type: application/json

{ "name": "Jane", "message": "Hello there", "phone": "12345" }
```

Each top-level field becomes one `Key: value` line in the email body:

```
Name: Jane
Message: Hello there
Phone: 12345
```

**Responses**

| Status | Meaning |
|---|---|
| `202` | Accepted — email sent to the configured Gmail. |
| `400` | Bad request (missing/invalid body). |
| `401` | Secret key missing or invalid. |
| `502` | Mail send failed. |

Forgot your password? Use the **"Forgot password?"** link on the login page — a
single-use, time-limited reset link is emailed via the same Gmail mailer.

## Deployment

### VPS (nginx + systemd)

Runs the app in place from the repo clone — no Docker. nginx reverse-proxies all
traffic to the Next.js server, which systemd keeps alive on `127.0.0.1:3000`.
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
      apps/            register + list apps
      v1/send/         the public send endpoint (Node runtime)
      health/          health check
    dashboard/         apps manager UI
    login/ register/ forgot-password/ reset-password/
  lib/                 auth, db, jwt, mailer, password, secret, env, flatten
  models/              User, App (Mongoose)
  middleware.ts        session gating
deploy/                VPS deploy — nginx.conf, setup.sh, deploy.sh, systemd unit
k8s/                   Kubernetes manifests
Dockerfile             production image
SPEC.md                source-of-truth spec (Step 1)
```
