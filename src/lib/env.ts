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
  get smtpUser() {
    return requireEnv("SMTP_USER");
  },
  get smtpPass() {
    return requireEnv("SMTP_PASS");
  },
  get smtpFrom() {
    return process.env.SMTP_FROM || requireEnv("SMTP_USER");
  },
  get appUrl() {
    return process.env.APP_URL || "http://localhost:3000";
  },
};
