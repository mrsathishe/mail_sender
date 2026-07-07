# Mail Sender — Spec (Step 1: Basic)

> Current source of truth. Earlier design docs (`TECH_STACK.md`, `ROADMAP.md`,
> `DESIGN_TEMPLATES.md`, `new_different_doc.md`) are archived under `old/` for
> reference. This doc describes the **basic first version** only.

---

## 1. What it is

A **middleware** service that lets a website send its form submissions to a Gmail
inbox — without the website owning any mail infrastructure.

- A user fills a form on a website (name, message, maybe a file).
- They click **Send**.
- The website's Send button calls our REST API (`POST`) with the form data (and
  optional file) and a **secret key**.
- We receive the call, verify the secret, turn the received fields into a
  readable message, and **send it as an email to the Gmail configured for that app**.

The email is sent **from our middleware's own Gmail account** (SMTP). The
"configured gmail" chosen during app registration is the **destination** — where
the form submissions land.

---

## 2. End-to-end flow

```
Website form (user types name / message / file)
        │  click "Send"
        ▼
POST  /v1/send          ← called by the website frontend
  header: secret key
  body:   { name, message, ... }  (+ optional file)
        │
        ▼
Mail Sender API endpoint
  1. collect the posted data
  2. read the secret from the request
  3. verify the secret  ─────────►  invalid → 401 reject
  4. build the message text from the received fields
  5. send email via our Gmail (SMTP)  ──────►  configured destination Gmail
        │
        ▼
202 accepted  (email sent)
```

---

## 3. Step 1 scope

### 3a. User accounts (manual)
- User **registers** by typing email + password.
- User **logs in** with the same email + password.
- User can **reset a forgotten password** (see §3d).
- No Google/OAuth login in step 1 — manual typing only.

### 3d. Forgot password
- On the login page, a **"Forgot password?"** link opens a form where the user
  types their email.
- We generate a **single-use, time-limited reset token** (e.g. valid 30 min),
  store its hash against the user, and email a reset link to that address
  **using our Gmail (SMTP)** — the same mailer that sends form submissions.
- The link opens a **"set new password"** page; on submit we verify the token
  (unexpired, unused, matches the stored hash), set the new `passwordHash`, and
  invalidate the token.
- Always respond with the same "if that email exists, a reset link was sent"
  message — never reveal whether an email is registered.

### 3b. Register an app
After login, the user registers an "app" by providing:

| Field | Meaning |
|---|---|
| **Website name** | Friendly label for this app (e.g. "Acme contact form"). |
| **Gmail to send to** | The destination Gmail inbox where submissions are delivered. |
| **Secret key** | **Generated** by us at registration. Shown once. The website puts this in the `POST /v1/send` request to authenticate. |

### 3c. Send flow (the public API)
- The website calls `POST /v1/send` with the secret key and the form fields.
- We verify the secret against the registered app.
- We build the email body and send it to that app's configured destination Gmail.

---

## 4. Message building (received data → email)

Whatever fields arrive in the POST body are turned into simple `Key: value`
lines, one per field, and joined into the email message.

**Example** — request body:

```json
{ "name": "Jane", "message": "Hello there", "phone": "12345" }
```

**Becomes the email body:**

```
Name: Jane
Message: Hello there
Phone: 12345
```

Rule: each top-level field becomes one line `<FieldName>: <value>`. Non-string
values are stringified. (This is the same plain-text idea used later for the
subject line too.)

---

## 5. API contract (step 1)

```http
POST /v1/send
Authorization: Bearer <secret key>
Content-Type: application/json   (or multipart/form-data when a file is attached)

{ "name": "Jane", "message": "Hello", "...": "any other fields" }
```

Responses:

| Status | Meaning |
|---|---|
| `202` | Accepted — email sent to the configured Gmail. |
| `400` | Bad request (missing/invalid body). |
| `401` | Secret key missing or invalid. |
| `502` | Mail send failed. |

---

## 6. Tech stack (unchanged, locked)

Carried over from the archived design — still the intended stack:

- **Next.js** — dashboard (register/login/register-app) + the REST API routes.
- **MongoDB** — stores users, registered apps, and secret keys.
- **Nodemailer + our Gmail (SMTP)** — actually sends the email.

The API route that sends mail must run on the **Node.js runtime** (not Edge) so
Nodemailer can open an SMTP connection.

---

## 7. Data (step 1)

**users** — `{ email, passwordHash, resetTokenHash?, resetTokenExpiresAt?, createdAt }`
- `resetTokenHash` / `resetTokenExpiresAt` are set when a password reset is
  requested and cleared once the password is changed or the token expires.

**apps** — `{ userId, websiteName, destinationGmail, secretKeyHash, createdAt }`
- The secret key is **hashed** in the DB; the full key is shown once at creation
  and never stored in plaintext.

---

## 8. Deliberately out of step 1

- File attachment handling details (accepted in the flow, spec'd later).
- Secret key rotation.
- Rate limiting / quotas.
- Google/OAuth login.
- HTML templates.
- Multiple / per-app sender accounts — sender is always **our** Gmail.

---

## 8b. Deployment — Docker (production only)

The app ships as a **production-only** Docker image ([Dockerfile](Dockerfile)):

- Multi-stage build (`deps` → `builder` → `runner`) on `node:20-alpine`, runs as
  a non-root user, final stage is `NODE_ENV=production` running `node server.js`.
- Uses Next.js **standalone** output — this requires `output: 'standalone'` in
  `next.config.js` once the app is scaffolded, otherwise `server.js` won't exist.
- The mail route runs on the **Node runtime** (SMTP sockets), which a plain Node
  container satisfies — do not switch it to Edge.
- Secrets (`SMTP_USER`, `SMTP_PASS`, `AUTH_SECRET`, `MONGO_URI`) are injected at
  **runtime** via env / orchestrator secrets — never baked into the image
  (enforced by [.dockerignore](.dockerignore), which excludes `.env*`).
- No dev-mode / hot-reload container — production build only, by design.

> Not yet buildable: the repo currently holds only the spec. The Dockerfile is
> ready for the moment the Next.js project (with `package.json`) is added.

---

## 9. Note on the archived `new_different_doc.md`

That draft proposed each app sending through **its own** connected mail account
(Gmail OAuth / SMTP per app). This spec **does not** adopt that: the sender is a
single Gmail we own, and the app's configured Gmail is only the **destination**.
Kept in `old/` for reference.
