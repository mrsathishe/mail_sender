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

  // Inputs that have to exist in the owner's own markup, because no JS can supply
  // them: a honeypot is only a trap if a bot parsing the page can see it, and a file
  // input is the only way a visitor picks a file. The timing value is deliberately
  // *not* here — it is set on the FormData below, so a form that never got this block
  // pasted still sends instead of failing `timing_missing` on every submission.
  const markupParts = [
    spamGuard.honeypotField
      ? `<!-- Bot trap: real visitors never see this, so anything that fills it is refused.\n` +
        `     Keep it off-screen rather than display:none — some bots skip hidden inputs. -->\n` +
        `<div style="position:absolute;left:-9999px" aria-hidden="true">\n` +
        `  <label for="${spamGuard.honeypotField}">Leave this field empty</label>\n` +
        `  <input id="${spamGuard.honeypotField}" name="${spamGuard.honeypotField}"\n` +
        `         type="text" tabindex="-1" autocomplete="off" value="" />\n` +
        `</div>`
      : "",
    attachments.enabled
      ? `<!-- Up to ${attachments.maxFiles} file${attachments.maxFiles === 1 ? "" : "s"}; the FormData below carries them as they are. -->\n` +
        `<input name="files" type="file" multiple accept="${ACCEPT_ATTRIBUTE}" />`
      : "",
  ].filter(Boolean);

  const markup = markupParts.length
    ? `<!-- Paste inside your own <form id="contact"> alongside your ${fields.length === 1 ? "field" : "fields"}. -->\n` +
      markupParts.join("\n\n")
    : "";

  // The one call, wherever it runs. A browser handler, a framework's onSubmit and your
  // own server all send the identical request and read the identical reply, so there is
  // nothing here to fork on: `new FormData(form)` already carries any file the form has,
  // and there is a single endpoint whether or not this app accepts uploads.
  const call =
    `// Paste into your page. Runnable as it stands — only the key is yours to fill in.\n` +
    `//\n` +
    `// Anyone who opens the page can read this key. What bounds it is the field list\n` +
    `// this app declares, its confirmed destination and its daily send limit.\n` +
    `const SECRET_KEY = "YOUR_SECRET_KEY";\n\n` +
    `const form = document.getElementById("contact"); // your form's id\n` +
    (spamGuard.timingField
      ? `\n// This app refuses a submission sent in under ${spamGuard.minSubmitSeconds}s, measured from here.\n` +
        `const shownAt = Date.now();\n`
      : "") +
    `\n` +
    `form.addEventListener("submit", async (event) => {\n` +
    `  event.preventDefault();\n\n` +
    `  // Carries every field the form has, files included.\n` +
    `  const body = new FormData(form);\n` +
    (spamGuard.timingField
      ? `  // Set here rather than in a hidden input, so it is right even if the form was\n` +
        `  // re-rendered — and cannot be forgotten in the markup.\n` +
        `  body.set("${spamGuard.timingField}", String(Date.now() - shownAt));\n`
      : "") +
    `\n` +
    `  const res = await fetch("${endpoint}", {\n` +
    `    method: "POST",\n` +
    `    headers: { "Authorization": \`Bearer \${SECRET_KEY}\` },\n` +
    `    // Never set Content-Type by hand — fetch has to add the multipart boundary itself.\n` +
    `    body,\n` +
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

  // The timing guard has to be satisfied here too, or a copied cURL answers
  // `422 timing_missing` and reads as a broken sample rather than a guard doing its job.
  // A plain elapsed duration, not an epoch stamp, so it stays valid whenever it is run.
  if (spamGuard.timingField && spamGuard.minSubmitSeconds > 0) {
    sample[spamGuard.timingField] = String((spamGuard.minSubmitSeconds + 1) * 1000);
  }

  const curl = attachments.enabled
    ? `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer YOUR_SECRET_KEY" \\\n` +
      Object.entries(sample)
        .map(([key, value]) => `  -F "${key}=${shellSingleQuoted(value)}" \\\n`)
        .join("") +
      `  -F "files=@/path/to/file.pdf"`
    : `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer YOUR_SECRET_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '${shellSingleQuoted(JSON.stringify(sample))}'`;

  return [
    // Only shown when there is something the markup must carry — an app with no
    // honeypot and no uploads needs nothing added to its form.
    ...(markup ? [{ id: "markup", label: "Hidden inputs your form needs", code: markup }] : []),
    { id: "call", label: "The call that sends your form", code: call },
    { id: "curl", label: "cURL — try it from a terminal", code: curl },
  ];
}
