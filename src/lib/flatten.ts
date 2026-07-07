// Turns a received submission body into a readable "Key: value" email, one line
// per field (SPEC §4).

function titleize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function buildEmailBody(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => `${titleize(key)}: ${stringify(value)}`)
    .join("\n");
}

// Header-injection guard: strip CR/LF from anything used in the subject line.
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}
