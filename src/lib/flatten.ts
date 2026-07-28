// Turns a received submission body into the shared pieces every mail design
// needs: escaped label/value rows for the HTML part, and a readable
// "Key: value" plain-text alternative (SPEC §4). The designs themselves live in
// ./templates.

function titleize(key: string): string {
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

// Header-injection guard: strip CR/LF from anything used in the subject line.
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}
