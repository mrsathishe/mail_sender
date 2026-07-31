// Turns a received submission body into the shared pieces every mail design
// needs: escaped label/value rows for the HTML part, and a readable
// "Key: value" plain-text alternative (SPEC §4). The designs themselves live in
// ./templates.

/**
 * `phone_number` → "Phone number". Exported because the same rule turns a declared
 * field name into a form label in the dashboard's generated snippets — an email row and
 * a form label reading differently for the same field would be its own small confusion.
 */
export function titleize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Plain-text rendering of a single value. Objects/arrays are expanded into
// indented lines rather than raw JSON so the text part stays readable.
function textValue(value: unknown, indent = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) {
    return value.length === 0
      ? "—"
      : "\n" + value.map((v) => `${indent}  - ${textValue(v, `${indent}  `)}`).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length === 0
      ? "—"
      : "\n" +
          entries
            .map(([k, v]) => `${indent}  ${titleize(k)}: ${textValue(v, `${indent}  `)}`)
            .join("\n");
  }
  return String(value);
}

export function buildEmailBody(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => `${titleize(key)}: ${textValue(value)}`)
    .join("\n");
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMPTY = '<span style="opacity:0.55;">—</span>';

// HTML rendering of a single value: newlines become <br>, arrays become lists,
// nested objects become a small inner table. Everything is escaped first.
// Colours and fonts are deliberately inherited, never hardcoded, so nested
// values pick up the surrounding design's palette (e.g. the dark template).
function htmlValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY;
    const items = value.map((v) => `<li style="margin:0 0 4px;">${htmlValue(v)}</li>`).join("");
    return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return EMPTY;
    const rows = entries
      .map(
        ([k, v]) =>
          `<tr>` +
          `<td style="padding:2px 10px 2px 0;font-size:13px;opacity:0.7;vertical-align:top;white-space:nowrap;">${escapeHtml(
            titleize(k)
          )}</td>` +
          `<td style="padding:2px 0;font-size:13px;">${htmlValue(v)}</td>` +
          `</tr>`
      )
      .join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;color:inherit;font:inherit;">${rows}</table>`;
  }
  return escapeHtml(String(value)).replace(/\r?\n/g, "<br />");
}

// One rendered field, ready to drop into any design. Both halves are already
// escaped — designs must never re-escape or build these themselves, so the
// escaping rules live in exactly one place.
export type EmailRow = { label: string; valueHtml: string };

export function toRows(data: Record<string, unknown>): EmailRow[] {
  return Object.entries(data).map(([key, value]) => ({
    label: escapeHtml(titleize(key)),
    valueHtml: htmlValue(value),
  }));
}

/**
 * Owner-authored prose (the autoresponder message, SPEC §4e) as escaped paragraphs:
 * a blank line starts a new `<p>`, a single newline becomes a `<br />`. Lives here
 * with the other escaping so no design ever interpolates raw text of its own.
 */
export function paragraphsHtml(text: string, style: string): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .map((block) => `<p style="${style}">${escapeHtml(block).replace(/\r?\n/g, "<br />")}</p>`)
    .join("");
}

// Header-injection guard: strip CR/LF from anything used in the subject line.
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

// Deliberately strict: this value ends up in a mail header, so anything with
// whitespace, CR/LF or a comma (which would start a second address) is rejected.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;
// Checked in order, so an explicit "reply to" field wins over an incidental one.
const REPLY_KEYS = ["replyto", "reply", "email", "emailaddress", "mail", "from", "contact"];

/**
 * Find the submitter's address in a submission so the destination inbox can just
 * hit reply (HARDENING_ROADMAP §2.1). Only top-level string fields are considered:
 * a nested value is too ambiguous to guess a header from. Returns undefined when
 * nothing looks like a single valid address.
 */
export function findReplyTo(data: Record<string, unknown>): string | undefined {
  const candidates = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!EMAIL_RE.test(trimmed)) continue;
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (!candidates.has(normalized)) candidates.set(normalized, trimmed);
  }
  if (candidates.size === 0) return undefined;

  for (const key of REPLY_KEYS) {
    const hit = candidates.get(key);
    if (hit) return hit;
  }
  // A field named something unexpected ("your_address") still holds a valid
  // address, and one is better than none.
  return candidates.values().next().value;
}
