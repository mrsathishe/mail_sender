# VPS Project Playbook

How to stand up **any new project** on the shared VPS, following the same pattern
`mail_sender` and `status` already use.

**The pattern in one sentence:** every project is cloned into your home folder,
runs as *your* user under **systemd** on a **unique `127.0.0.1` port**, and
**nginx** reverse-proxies a domain to that port (with HTTPS from certbot). No
Docker, nothing in `/opt`.

```
Internet ──▶ nginx :80/:443 (per-domain server block)
                │  proxy_pass
                ▼
        127.0.0.1:PORT  ◀── systemd service (runs `next start` / node / static)
                │
                ▼
         the project's code in ~/<project>
```

---

## 0. One-time VPS bootstrap (skip if the box is already set up)

Do this **once per server**, not per project.

```bash
# Node 22 LTS (via nodesource) — needed by Next.js / node apps
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# nginx + certbot for reverse proxy + HTTPS
sudo apt-get install -y nginx
sudo apt-get install -y certbot python3-certbot-nginx

# (optional) MongoDB / Postgres / etc. only if a project needs a local DB
```

Confirm: `node -v` (≥ 20), `nginx -v`, `systemctl status nginx`.

---

## 1. Pick a unique port

Each project's server binds to its own `127.0.0.1:PORT`. Two projects **cannot**
share a port. Keep a simple registry:

| Project      | Port   | Domain                |
|--------------|--------|-----------------------|
| mail_sender  | `3100` | `mail.satz.co.in`     |
| status-api   | `3200` | (your status domain)  |
| **new one**  | `3300` | `foo.satz.co.in`      |

Before choosing, verify the port is free: `sudo ss -ltnp | grep :3300`.

---

## 2. Add the four deploy files to the new project

Copy `deploy/` from `mail_sender` into the new repo and change the project name,
port, and domain. Every project ships exactly these four files:

```
deploy/
  setup.sh              # one-time: install deps, build, create + start systemd unit
  deploy.sh             # every update: pull → install → build → restart
  <project>.service     # systemd unit reference (setup.sh generates the real one)
  nginx.conf            # reverse-proxy server block for this project's domain
```

And add these scripts to `package.json`:

```json
"scripts": {
  "setup":  "bash deploy/setup.sh",
  "deploy": "bash deploy/deploy.sh"
}
```

### 2a. `deploy/setup.sh` (self-generating systemd unit)

The key trick: `setup.sh` **generates** the systemd unit at run time filling in
the real absolute path, your user, and the node binary — so nothing is hardcoded
to one machine. Copy `mail_sender/deploy/setup.sh` and change only:

- `SERVICE="/etc/systemd/system/<project>.service"`
- the `Description=`
- `PORT=3300` (your port from step 1) and the two `-p 3300` flags in `ExecStart`
- `ExecStart` command:
  - **Next.js app** → `.../node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3300`
  - **plain Node/Express** → `$NODE_BIN $APP_DIR/server.js` (with `PORT` from env)
  - **static site** → you don't need a service; let nginx serve `dist/` directly
    (see §4b) — skip the systemd parts.

### 2b. `deploy/deploy.sh`

Idempotent update script — copy as-is; it bootstraps `setup.sh` on first run,
then on every run does `npm ci → npm run build → systemctl restart <project>`.
Change only the `SERVICE=` path to match your project name.

### 2c. `deploy/nginx.conf`

Copy `mail_sender/deploy/nginx.conf` and change:

- `server_name` → your domain (e.g. `foo.satz.co.in`)
- `proxy_pass http://127.0.0.1:3300;` → your port
- `client_max_body_size` → only if you expect large uploads

---

## 3. Environment / secrets

- Keep secrets in a **gitignored `.env`** at the project root — never committed.
- Provide a committed `.env.example` documenting every variable.
- `setup.sh` copies `.env.example → .env` on first run; you then edit real values.
- systemd loads them via `EnvironmentFile=$APP_DIR/.env` (already wired by setup.sh).

Generate signing secrets with `openssl rand -base64 32`. URL-encode special chars
in any DB password (`@` → `%40`).

---

## 4. Deploy the new project on the VPS

### 4a. Server app (Next.js / Node) — the common case

```bash
# In your home folder on the VPS:
git clone git@github.com:<you>/<project>.git
cd <project>

npm run setup                      # installs deps, builds, creates + starts the service
nano .env                          # fill in real secrets
sudo systemctl restart <project>   # pick up the edited .env

# Wire up the domain in nginx:
sudo cp deploy/nginx.conf /etc/nginx/sites-available/<project>
sudo ln -s /etc/nginx/sites-available/<project> /etc/nginx/sites-enabled/<project>
sudo nginx -t && sudo systemctl reload nginx

# HTTPS (edit the domain in nginx.conf first):
sudo certbot --nginx -d foo.satz.co.in
```

### 4b. Static site (no server process)

Skip systemd. Build to `dist/`, then point nginx at it with `root`/`try_files`
instead of `proxy_pass`. See `status/deploy/nginx.conf` for that variant.

---

## 5. DNS

Before certbot can issue a cert, the domain must resolve to the VPS:

- Add an **A record** for `foo.satz.co.in` → the VPS public IP.
- Wait for propagation (`dig +short foo.satz.co.in` shows the VPS IP), then run
  certbot.

---

## 6. Updating a project later

```bash
cd ~/<project>
git pull
npm run deploy          # install → build → restart service
```

## 7. Operate / debug

```bash
sudo systemctl status <project>        # is it running?
journalctl -u <project> -f             # live logs
sudo ss -ltnp | grep :3300             # is the port bound?
sudo nginx -t && sudo systemctl reload nginx   # after editing nginx.conf
sudo systemctl restart <project>       # after editing .env
```

---

## Checklist for each new project

- [ ] One-time VPS bootstrap done (node, nginx, certbot) — server-wide, once.
- [ ] Unique port chosen and recorded in the registry table.
- [ ] `deploy/` copied in; name, port, domain updated in all four files.
- [ ] `setup` + `deploy` scripts added to `package.json`.
- [ ] `.env.example` committed; real `.env` gitignored.
- [ ] DNS A record points the domain at the VPS.
- [ ] `npm run setup` run, `.env` filled, service restarted.
- [ ] nginx site enabled, `nginx -t` passes, reloaded.
- [ ] `certbot --nginx -d <domain>` issued HTTPS.
- [ ] `systemctl status` green; domain loads over HTTPS.
