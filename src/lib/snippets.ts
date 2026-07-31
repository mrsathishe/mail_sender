// Ready-to-paste integration code, generated from what an app actually declares.
//
// The point is that a form's field list is the app's own: telling an owner to post
// `name`/`email`/`message` is only right until they add `company` or rename `phone`,
// after which the docs' generic example produces `400 unknown_field` and reads like a
// bug in us. Generating from `fields`, `spamGuard` and `attachments` means the snippet
// cannot disagree with the contract the endpoint will enforce.
//
// Pure and free of Node built-ins, so the dashboard renders these in the browser.

import { titleize } from "./flatten";
import type { AppField } from "./fields";
import type { SpamGuard } from "./bot-guard";
import { ACCEPT_ATTRIBUTE, type AttachmentConfig } from "./attachments";

export type Snippet = { id: string; label: string; code: string };

export type SnippetInput = {
  /** Absolute URL of the endpoint this app should post to. */
  endpoint: string;
  fields: AppField[];
  spamGuard: SpamGuard;
  attachments: AttachmentConfig;
};

/**
 * Which HTML control a declared field wants. A guess from the name, because that is all
 * we have — the contract stores no type — but a wrong guess is cosmetic: the field still
 * posts under the same name, so the submission is valid either way.
 */
type Control = "text" | "email" | "tel" | "url" | "number" | "textarea";

function controlFor(name: string): Control {
  const key = name.toLowerCase();
  if (key.includes("email") || key.includes("mail")) return "email";
  if (key.includes("phone") || key.includes("mobile") || key.includes("tel")) return "tel";
  if (key.includes("url") || key.includes("website") || key.includes("link")) return "url";
  if (key.includes("quantity") || key.includes("count") || key.includes("budget")) return "number";
  if (
    key.includes("message") ||
    key.includes("comment") ||
    key.includes("detail") ||
    key.includes("description") ||
    key.includes("enquiry") ||
    key.includes("inquiry") ||
    key.includes("note")
  ) {
    return "textarea";
  }
  return "text";
}

// A plausible value per field, so the cURL and fetch samples can be run as they are.
function sampleFor(name: string): string {
  switch (controlFor(name)) {
    case "email":
      return "jane@example.com";
    case "tel":
      return "+1 555 0100";
    case "url":
      return "https://example.com";
    case "number":
      return "2";
    case "textarea":
      return "Hello! I'd like to know more.";
    default:
      return name.toLowerCase().includes("name") ? "Jane Doe" : "Example";
  }
}

/** Escape for an HTML attribute value — a field name could carry a quote or a bracket. */
function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Escape for a single-quoted shell argument, which is how cURL takes JSON. */
function shellSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function htmlControl(field: AppField): string {
  const name = attr(field.name);
  const label = attr(titleize(field.name));
  const required = field.required ? " required" : "";
  const control = controlFor(field.name);

  if (control === "textarea") {
    return `  <label for="f-${name}">${label}</label>\n` +
      `  <textarea id="f-${name}" name="${name}" rows="6"${required}></textarea>`;
  }
  return `  <label for="f-${name}">${label}</label>\n` +
    `  <input id="f-${name}" name="${name}" type="${control}"${required} />`;
}

export function integrationSnippets(input: SnippetInput): Snippet[] {
  const { endpoint, fields, spamGuard, attachments } = input;
  const controls = fields.map(htmlControl).join("\n\n");

  const honeypot = spamGuard.honeypotField
    ? `\n\n  <!-- Honeypot: a person never sees it, so anything that fills it is a bot.\n` +
      `       Leave the value empty. Not in your field list on purpose. -->\n` +
      `  <input type="text" name="${attr(spamGuard.honeypotField)}" value="" tabindex="-1"\n` +
      `         autocomplete="off" aria-hidden="true"\n` +
      `         style="position:absolute;left:-9999px" />`
    : "";

  const timing = spamGuard.timingField
    ? `\n\n  <!-- How long the form has been on screen, in milliseconds. Anything faster\n` +
      `       than ${spamGuard.minSubmitSeconds}s is refused with 422 too_fast. -->\n` +
      `  <input type="hidden" id="f-elapsed" name="${attr(spamGuard.timingField)}" value="0" />`
    : "";

  const timingScript = spamGuard.timingField
    ? `\n<script>\n` +
      `  const shownAt = Date.now();\n` +
      `  document.getElementById("contact").addEventListener("submit", () => {\n` +
      `    document.getElementById("f-elapsed").value = Date.now() - shownAt;\n` +
      `  });\n` +
      `</script>`
    : "";

  const fileInput = attachments.enabled
    ? `\n\n  <!-- Up to ${attachments.maxFiles} file(s); the whole request must stay under the\n` +
      `       size limit shown in the docs. -->\n` +
      `  <input name="files" type="file" multiple accept="${ACCEPT_ATTRIBUTE}" />`
    : "";

  // `enctype` only matters when there is a file to carry.
  const enctype = attachments.enabled ? ` enctype="multipart/form-data"` : "";

  const html =
    `<!-- Posts to a route on YOUR site, never to us: the secret key must not be in\n` +
    `     the browser, and a plain form can't send an Authorization header anyway. -->\n` +
    `<form id="contact" method="POST" action="/api/contact"${enctype}>\n` +
    `${controls}${fileInput}${honeypot}${timing}\n\n` +
    `  <button type="submit">Send</button>\n` +
    `</form>${timingScript}`;

  // The forwarding route. With attachments the incoming FormData is passed straight
  // through — re-serialising it would drop the files, and fetch sets the multipart
  // boundary itself.
  const route = attachments.enabled
    ? `// app/api/contact/route.js — runs on your server, where the key is safe.\n` +
      `export async function POST(request) {\n` +
      `  const form = await request.formData();\n\n` +
      `  // Forwarded as-is: text fields and files both survive. Do not set\n` +
      `  // Content-Type here — fetch has to add the multipart boundary itself.\n` +
      `  const res = await fetch("${endpoint}", {\n` +
      `    method: "POST",\n` +
      `    headers: { "Authorization": \`Bearer \${process.env.MAIL_SENDER_KEY}\` },\n` +
      `    body: form,\n` +
      `  });\n\n` +
      `  // 303 so the browser follows with GET and a refresh doesn't re-submit.\n` +
      `  const next = res.ok ? "/thanks" : "/contact?error=1";\n` +
      `  return Response.redirect(new URL(next, request.url), 303);\n` +
      `}`
    : `// app/api/contact/route.js — runs on your server, where the key is safe.\n` +
      `export async function POST(request) {\n` +
      `  const form = await request.formData();\n\n` +
      `  const res = await fetch("${endpoint}", {\n` +
      `    method: "POST",\n` +
      `    headers: {\n` +
      `      "Authorization": \`Bearer \${process.env.MAIL_SENDER_KEY}\`,\n` +
      `      "Content-Type": "application/json",\n` +
      `    },\n` +
      `    body: JSON.stringify(Object.fromEntries(form)),\n` +
      `  });\n\n` +
      `  // 303 so the browser follows with GET and a refresh doesn't re-submit.\n` +
      `  const next = res.ok ? "/thanks" : "/contact?error=1";\n` +
      `  return Response.redirect(new URL(next, request.url), 303);\n` +
      `}`;

  const sample: Record<string, string> = {};
  for (const field of fields) sample[field.name] = sampleFor(field.name);

  const curl = attachments.enabled
    ? `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer YOUR_SECRET_KEY" \\\n` +
      fields
        .map((f) => `  -F "${f.name}=${shellSingleQuoted(sample[f.name])}" \\\n`)
        .join("") +
      `  -F "files=@/path/to/file.pdf"`
    : `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer YOUR_SECRET_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '${shellSingleQuoted(JSON.stringify(sample))}'`;

  const fetchSample =
    `// Server-side only — keep the key in an environment variable.\n` +
    `await fetch("${endpoint}", {\n` +
    `  method: "POST",\n` +
    `  headers: {\n` +
    `    "Authorization": \`Bearer \${process.env.MAIL_SENDER_KEY}\`,\n` +
    `    "Content-Type": "application/json",\n` +
    `  },\n` +
    `  body: JSON.stringify(${JSON.stringify(sample, null, 4).replace(/\n/g, "\n  ")}),\n` +
    `});`;

  const snippets: Snippet[] = [
    { id: "html", label: "1. The form, on your site", code: html },
    { id: "route", label: "2. The route that forwards it (Next.js)", code: route },
    { id: "curl", label: "cURL — try it from a terminal", code: curl },
  ];

  // With attachments on, a JSON example would be misleading: it cannot carry a file.
  if (!attachments.enabled) {
    snippets.push({ id: "fetch", label: "Node.js (fetch)", code: fetchSample });
  }

  return snippets;
}
