// Lazy env access — never throws at import/build time, only when a value is
// actually needed at request time.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const env = {
  get mongoUri() {
    return requireEnv("MONGO_URI");
  },
  get authSecret() {
    return requireEnv("AUTH_SECRET");
  },
  get smtpHost() {
    // Required rather than defaulted: a silent fallback to Gmail would send real
    // mail through the wrong account if this were ever missing.
    return requireEnv("SMTP_HOST");
  },
  get smtpPort() {
    const raw = process.env.SMTP_PORT;
    const port = raw ? Number(raw) : 587;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid SMTP_PORT: ${raw}`);
    }
    return port;
  },
  get smtpSecure() {
    // Implicit TLS is port 465's convention; anything else (587) starts plain and
    // upgrades with STARTTLS. Overridable for hosts that don't follow it.
    const raw = process.env.SMTP_SECURE;
    if (raw) return raw === "true" || raw === "1";
    return env.smtpPort === 465;
  },
  get smtpUser() {
    return requireEnv("SMTP_USER");
  },
  get smtpPass() {
    return requireEnv("SMTP_PASS");
  },
  get smtpFrom() {
    // May be a full header value: `"Satz Forms" <forms@send.satz.co.in>`.
    return process.env.SMTP_FROM || requireEnv("SMTP_USER");
  },
  get appUrl() {
    return process.env.APP_URL || "http://localhost:3000";
  },
  get appDailySendLimit() {
    // Per-app sends per UTC day. A knob rather than a constant so a busy customer
    // can be raised with a `.env` edit and a restart; a bad value must not silently
    // become "unlimited", so it throws.
    const raw = process.env.SEND_APP_DAILY_LIMIT;
    if (!raw) return 500;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`Invalid SEND_APP_DAILY_LIMIT: ${raw}`);
    }
    return limit;
  },
  get spamScoreThreshold() {
    // Score at which a submission is refused (spam-score.ts). Tunable without a
    // release because the right number is only learnable from real traffic; raise it
    // to loosen the filter, and a very high value effectively turns it off.
    const raw = process.env.SPAM_SCORE_THRESHOLD;
    if (!raw) return 6;
    const threshold = Number(raw);
    if (!Number.isInteger(threshold) || threshold <= 0) {
      throw new Error(`Invalid SPAM_SCORE_THRESHOLD: ${raw}`);
    }
    return threshold;
  },
};
