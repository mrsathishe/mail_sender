// Ready-to-paste integration code, generated from what an app actually declares.
//
// The point is that a form's field list is the app's own: telling an owner to post
// `name`/`email`/`message` is only right until they add `company` or rename `phone`,
// after which the docs' generic example produces `400 unknown_field` and reads like a
// bug in us. Generating from `fields`, `spamGuard` and `attachments` means the snippet
// cannot disagree with the contract the endpoint will enforce.
//
// Pure and free of Node built-ins, so the dashboard renders these in the browser.

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
 * What kind of value a declared field probably holds, guessed from its id and label
 * because the contract stores no type. Only used to pick a plausible sample value for
 * the cURL body, so a wrong guess is cosmetic — the field still posts under its id.
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

/** Escape for a single-quoted shell argument, which is how cURL takes JSON. */
function shellSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function integrationSnippets(input: SnippetInput): Snippet[] {
  const { endpoint, fields, spamGuard, attachments } = input;

  // Extra inputs this app's form needs that aren't declared fields. They used to be
  // shown in a generated `<form>`; the markup is the owner's own, so what is left is
  // naming them here — the guards reject a submission that arrives without them.
  const guardNotes = [
    spamGuard.honeypotField
      ? `// Your form also needs a hidden honeypot input named "${spamGuard.honeypotField}",\n` +
        `// left empty and off-screen — anything that fills it is refused as a bot.\n`
      : "",
    spamGuard.timingField
      ? `// ...and a hidden input named "${spamGuard.timingField}" carrying how long the form\n` +
        `// has been on screen in ms; faster than ${spamGuard.minSubmitSeconds}s is refused.\n`
      : "",
    attachments.enabled
      ? `// Files: add <input name="files" type="file" multiple accept="${ACCEPT_ATTRIBUTE}" />\n` +
        `// — up to ${attachments.maxFiles}. FormData below carries them as they are.\n`
      : "",
  ].join("");

  // The one call, wherever it runs. A browser handler, a framework's onSubmit and your
  // own server all send the identical request and read the identical reply, so there is
  // nothing here to fork on: `new FormData(form)` already carries any file the form has,
  // and there is a single endpoint whether or not this app accepts uploads.
  const call =
    `// Paste into your form's submit handler.\n` +
    `//\n` +
    `// Anyone who opens the page can read this key. What bounds it is the field list\n` +
    `// this app declares, its confirmed destination and its daily send limit.\n` +
    guardNotes +
    `const SECRET_KEY = "YOUR_SECRET_KEY";\n\n` +
    `const form = document.getElementById("contact"); // your form's id\n` +
    (spamGuard.timingField ? `const shownAt = Date.now();\n` : "") +
    `\n` +
    `form.addEventListener("submit", async (event) => {\n` +
    `  event.preventDefault();\n` +
    (spamGuard.timingField
      ? `  form.elements["${spamGuard.timingField}"].value = Date.now() - shownAt;\n\n`
      : "") +
    `  const res = await fetch("${endpoint}", {\n` +
    `    method: "POST",\n` +
    `    headers: { "Authorization": \`Bearer \${SECRET_KEY}\` },\n` +
    `    // Carries every field the form has, files included. Never set Content-Type by\n` +
    `    // hand here — fetch has to add the multipart boundary itself.\n` +
    `    body: new FormData(form),\n` +
    `  });\n\n` +
    `  // Always JSON plus a status, never a redirect, so this page decides what happens\n` +
    `  // next — a message of your own, or location.assign("/thanks") instead.\n` +
    `  if (res.ok) {\n` +
    `    form.reset();\n` +
    `    alert("Thanks — your message is on its way.");\n` +
    `  } else {\n` +
    `    alert("Sorry, that didn't send. Please try again.");\n` +
    `  }\n` +
    `});`;

  // Keyed by id: the id is what the request carries, the label only names the row in
  // the email that arrives.
  const sample: Record<string, string> = {};
  for (const field of fields) sample[field.id] = sampleFor(`${field.id} ${field.name}`);

  const curl = attachments.enabled
    ? `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer YOUR_SECRET_KEY" \\\n` +
      fields
        .map((f) => `  -F "${f.id}=${shellSingleQuoted(sample[f.id])}" \\\n`)
        .join("") +
      `  -F "files=@/path/to/file.pdf"`
    : `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer YOUR_SECRET_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '${shellSingleQuoted(JSON.stringify(sample))}'`;

  return [
    { id: "call", label: "The call that sends your form", code: call },
    { id: "curl", label: "cURL — try it from a terminal", code: curl },
  ];
}
