# syntax=docker/dockerfile:1

# Production-only image for Mail Sender (Next.js).
# Requires `output: 'standalone'` in next.config.js (see DEPLOY note below).
# Build:  docker build -t mail-sender .
# Run:    docker run -p 3000:3000 --env-file .env.production mail-sender

# ---- 1. deps: install production-locked dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. build: compile the Next.js standalone output ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. runner: minimal production runtime ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output bundles only what the server needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# The /v1/send route needs the Node runtime (SMTP sockets) — this is a plain
# Node server process, so that's satisfied. Secrets (SMTP_*, AUTH_SECRET,
# MONGO_URI) are injected at runtime via env, never baked into the image.
CMD ["node", "server.js"]
