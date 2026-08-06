// Single source of truth for the PUBLIC API docs. Both the HTML page (/docs) and
// the machine-readable mirrors (/docs.md, /llms.txt) are generated from these
// sections, so the two surfaces can never drift apart.
//
// Content lives in a TS module rather than a root .md file on purpose: with
// `output: "standalone"` Next only copies files reachable through imports, so a
// markdown file read via fs at runtime would be missing in the production build.
//
// Blocks are typed rather than one markdown blob so the page can render each kind
// with its own component (CodeBlock keeps its copy button, tables keep .doc-table)
// while the markdown builder emits the plain equivalent.
//
// Structured as numbered steps in the order an integrator does them — register, get a
// key, send, read the reply — rather than by subject area. Keep it a *reference*: every
// rule the endpoint enforces belongs here, the reasoning behind it belongs in CLAUDE.md.
// An earlier draft argued its own design decisions to the reader and buried the facts.

import { BRAND_FULL, BRAND_TAGLINE, CONTACT_EMAIL } from "./brand";
import { DEFAULT_FIELDS, MAX_FIELDS } from "./fields";
import {
  ACCEPTED_EXTENSIONS,
  ATTACHMENT_MAX_TOTAL_BYTES,
  MAX_ATTACHMENTS_CEILING,
  formatBytes,
} from "./attachments";
import { env } from "./env";

export type DocBlock =
  | { kind: "prose"; markdown: string }
  | { kind: "code"; label?: string; code: string }
  | { kind: "endpoint"; method: string; url: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

export type DocSection = { id: string; heading: string; blocks: DocBlock[] };

export const DOCS_TITLE = `${BRAND_FULL} — API documentation`;
/**
 * Deliberately *not* `BRAND_TAGLINE`. This renders as the page subtitle and as /docs'
 * meta description, and the tagline is already the landing hero's lede — a visitor who
 * arrived here has read it, and two pages sharing one description is also the thing
 * search engines de-duplicate. So this says what *this page* holds.
 */
export const DOCS_TAGLINE =
  "Four steps: register an app, get its key, post a submission, read the response.";

export function docSections(base: string): DocSection[] {
  const endpoint = `${base}/api/v1/send`;

  return [
    {
      id: "register",
      heading: "1. Register your app",
      blocks: [
        {
          kind: "prose",
          markdown:
            `On the [dashboard](${base}/dashboard), **Register an app** walks through a ` +
            "name, the **destination address** submissions should land in, the **fields** " +
            "your form posts, and a mail design — plus the optional auto-reply, spam guard " +
            "and attachment settings. The secret key is issued at the end.",
        },
        {
          kind: "prose",
          markdown:
            "**A field is a pair: an id and a label.** The id is what your form posts; " +
            "the label is what the email row is called. So a field with the id `company` " +
            'and the label "Company Name", given `{ "company": "Acme Inc." }`, arrives as:',
        },
        { kind: "code", code: "Company Name: Acme Inc." },
        {
          kind: "prose",
          markdown:
            `A new app starts with ` +
            DEFAULT_FIELDS.map((f) => `\`${f.id}\``).join(", ") +
            ` (labelled ` +
            DEFAULT_FIELDS.map((f) => `“${f.name}”`).join(", ") +
            `), and you can edit the list any time up to ${MAX_FIELDS} fields.\n\n` +
            "An id must start with a letter and contain only letters, digits, `_` or `-`, " +
            "and is matched case-insensitively — posting `Email` satisfies a declared " +
            "`email`. A label is your own text, used exactly as you wrote it: nothing " +
            "reformats `Order ID` into `Order id`.",
        },
        {
          kind: "prose",
          markdown:
            "The list is enforced strictly, and in one direction only:\n\n" +
            "- a field you didn't declare → `400 unknown_field`, and no email is sent;\n" +
            "- a declared field may be absent or empty, and appears in the email as `—`.\n\n" +
            "**Nothing is mandatory here.** Whether a visitor has to fill something in is " +
            "your form's own check, next to the input and in your own words — this endpoint " +
            "delivers what it is given rather than second-guessing it. Rows always arrive " +
            "in the order you declared them.",
        },
        {
          kind: "prose",
          markdown:
            "**The destination has to confirm.** Your own account address is already " +
            "proven, so the key appears immediately. Any other address is emailed an " +
            "8-character code, and until it is entered the app has **no working key** — " +
            "submissions get `403 destination_unverified`. Codes last 15 minutes and allow " +
            "5 attempts.",
        },
      ],
    },
    {
      id: "authentication",
      heading: "2. Send the key as a Bearer token",
      blocks: [
        {
          kind: "prose",
          markdown:
            "The key is shown once, at creation and on rotation. Pass it in the " +
            "`Authorization` header — missing or wrong returns `401`.",
        },
        { kind: "code", code: "Authorization: Bearer YOUR_SECRET_KEY" },
        {
          kind: "prose",
          markdown:
            "That is the **only header the API requires**. Add " +
            "`Content-Type: application/json` if you post JSON; with `FormData` leave it " +
            "off entirely, because the browser has to set it along with the multipart " +
            "boundary it generated.",
        },
        { kind: "endpoint", method: "POST", url: endpoint },
      ],
    },
    {
      id: "send",
      heading: "3. Post the submission",
      blocks: [
        {
          kind: "code",
          label: "Without files — JSON",
          code: `const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Jane Doe",
    email: "jane@example.com",
    message: "Hello!",
  }),
});`,
        },
        {
          kind: "prose",
          markdown:
            "A form post works the same way — `new FormData(form)` sends every declared " +
            "field, and is also how files travel. Switch **attachments** on for the app " +
            "first; until you do, a file part is refused with " +
            "`422 attachments_not_enabled` and nothing is sent.\n\n" +
            "The file input must be named `files` — `<input name=\"files\" type=\"file\" " +
            "multiple />` — and leave `Content-Type` unset, because fetch has to add the " +
            "multipart boundary itself. Clearing the form only on success leaves what the " +
            "visitor typed intact on a `400`.",
        },
        {
          kind: "code",
          label: "With files — multipart",
          code: `const res = await fetch("${endpoint}", {
  method: "POST",
  headers: { "Authorization": \`Bearer \${SECRET_KEY}\` },
  body: new FormData(form),
});

if (res.ok) form.reset();`,
        },
        {
          kind: "prose",
          markdown:
            `With attachments on, the whole request may total **${formatBytes(
              ATTACHMENT_MAX_TOTAL_BYTES
            )}** — fields and every file together, not per file — across at most ` +
            `${MAX_ATTACHMENTS_CEILING} files. A file's *contents* are checked against its ` +
            "extension, so renaming one to get past the list does not work " +
            "(`422 unsupported_file_type`). Archives, programs and legacy `.doc`/`.xls` are " +
            "not accepted. Files arrive as real attachments plus an *Attached files* row, " +
            "and a file input does **not** belong in your field list.\n\n" +
            "**Supported formats:** " +
            ACCEPTED_EXTENSIONS.map((ext) => `\`.${ext}\``).join(", ") +
            ".",
        },
      ],
    },
    {
      id: "responses",
      heading: "4. Read the response",
      blocks: [
        {
          kind: "prose",
          markdown:
            "Always JSON plus a status, never a redirect — so what a visitor sees next is " +
            "your decision. Success is `{ \"ok\": true }`; every failure carries a " +
            "machine-readable `error` code, and the two field errors name the field.",
        },
        {
          kind: "table",
          headers: ["Status", "Meaning"],
          rows: [
            ["`200`", "The email was sent to the configured address."],
            [
              "`200`",
              "`duplicate: true` — an identical submission within 60s; no second email sent.",
            ],
            ["`400`", "Empty or invalid body."],
            [
              "`400`",
              "`unknown_field` — the submission contained a field the app doesn't declare.",
            ],
            ["`400`", "`body_too_deep` — the body nests more than 5 levels."],
            ["`401`", "Secret key missing or invalid."],
            [
              "`403`",
              "`destination_unverified` — the destination address hasn't confirmed yet.",
            ],
            [
              "`413`",
              `\`payload_too_large\` — the request body exceeded 500KB, or ${formatBytes(
                ATTACHMENT_MAX_TOTAL_BYTES
              )} for an app with attachments switched on.`,
            ],
            ["`422`", "`honeypot_filled` — the app's honeypot field arrived non-empty."],
            ["`422`", "`too_fast` — submitted faster than the app's minimum fill time."],
            ["`422`", "`timing_missing` — the timing field held nothing usable."],
            ["`422`", "`spam_rejected` — the content scored past the spam threshold."],
            [
              "`422`",
              "`attachments_not_enabled` — a file was posted but the app doesn't accept them.",
            ],
            ["`422`", "`too_many_files` — more files than the app's limit."],
            [
              "`422`",
              "`unsupported_file_type` — the file's type isn't accepted, or its contents don't match its name.",
            ],
            ["`422`", "`empty_file` — one of the files was zero bytes."],
            ["`422`", "`invalid_filename` — a file arrived with no extension."],
            [
              "`429`",
              `\`daily_limit_exceeded\` — the app has used its ${env.appDailySendLimit} sends for the day.`,
            ],
            ["`502`", "The mail server failed to send."],
          ],
        },
      ],
    },
    {
      id: "notes",
      heading: "Important notes",
      blocks: [
        {
          kind: "prose",
          markdown:
            `- **${env.appDailySendLimit} emails a day per app**, on the UTC calendar day. ` +
            "Past it, submissions are refused with `429` rather than dropped silently — ask " +
            `us at [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) if your form needs more.\n` +
            "- **Repeats are collapsed.** An identical submission within 60 seconds answers " +
            '`200` with `"duplicate": true` and sends no second email, so a double-clicked ' +
            "submit is safe. A failed send is not a repeat, so retrying after a `502` does " +
            "deliver.\n" +
            "- **Body size** is capped at 500KB, or " +
            `${formatBytes(ATTACHMENT_MAX_TOTAL_BYTES)} with attachments on, and nesting at ` +
            "5 levels.\n" +
            "- **Content is scored for spam** on every submission — link volume, anchor or " +
            "BBCode markup and mail-header probes → `422 spam_rejected`, recorded in the " +
            "app's activity with the reason. A **honeypot** field and a **minimum fill " +
            `time** are available per app on the [dashboard](${base}/dashboard); neither ` +
            "belongs in your field list, since both are stripped before the field check " +
            "runs.\n" +
            "- **A blocked submission costs nothing** from the daily allowance. Anything " +
            "that reaches the mail server counts, including a send that fails there.\n" +
            "- **`From:` is always our address** and the submitter goes in `Reply-To:`, so " +
            "replying from your inbox reaches them. Sending as their address would fail " +
            "SPF and DMARC.\n" +
            "- **An optional automatic reply** to the submitter can be switched on per app. " +
            "It is a second email and uses a second send; if the day's allowance runs out, " +
            "the submission still goes through and the reply is the part skipped.\n" +
            "- **Rotating the key invalidates the old one immediately.** Only a hash is " +
            "stored, so a lost key cannot be recovered — rotate and update your " +
            "integration.\n" +
            "- **Delivered submissions are not stored.** The activity log keeps the status, " +
            "the time and the mail server's reply, not the fields you received. Only a " +
            "blocked submission records what triggered the block.\n" +
            "- **Every attempt is logged** against the app, successes and failures alike, " +
            `so a missing email is diagnosable from the [dashboard](${base}/dashboard).`,
        },
      ],
    },
  ];
}

function blockToMarkdown(block: DocBlock): string {
  switch (block.kind) {
    case "prose":
      return block.markdown;
    case "endpoint":
      return ["```http", `${block.method} ${block.url}`, "```"].join("\n");
    case "code": {
      const fence = ["```", block.code, "```"].join("\n");
      return block.label ? `**${block.label}**\n\n${fence}` : fence;
    }
    case "table": {
      const head = `| ${block.headers.join(" | ")} |`;
      const rule = `| ${block.headers.map(() => "---").join(" | ")} |`;
      const rows = block.rows.map((r) => `| ${r.join(" | ")} |`);
      return [head, rule, ...rows].join("\n");
    }
  }
}

/** The full docs as markdown — served verbatim at /docs.md for AI agents. */
export function docsMarkdown(base: string): string {
  const parts = [`# ${DOCS_TITLE}`, DOCS_TAGLINE];

  for (const section of docSections(base)) {
    parts.push(`## ${section.heading}`);
    for (const block of section.blocks) parts.push(blockToMarkdown(block));
  }

  // The live tester is an interactive panel, so it has no markdown equivalent.
  parts.push("## Try it");
  parts.push(
    `A live tester that sends a real email using one of your app's secret keys is ` +
      `available on the HTML version of this page at ${base}/docs after signing in.`
  );

  return `${parts.join("\n\n")}\n`;
}

/**
 * /llms.txt — the convention AI clients probe for when handed a bare domain:
 * a short index that points at the full markdown rather than repeating it.
 */
export function llmsTxt(base: string): string {
  return `# ${BRAND_FULL}

> ${BRAND_TAGLINE}

A website POSTs its form submissions plus a secret key to one endpoint, and the
service emails them to the destination inbox configured for that app. Register an
app in the dashboard to get a secret key, a destination address, the list of form
fields the app accepts, and a mail design.

## Docs

- [API documentation](${base}/docs.md): the POST /api/v1/send endpoint — bearer-token
  authentication, request body shape, the per-app form-field contract,
  the ${env.appDailySendLimit}-per-day per-app sending limit, the honeypot / fill-time /
  content spam guards, the optional automatic reply to the submitter, optional
  multipart file uploads up to ${formatBytes(ATTACHMENT_MAX_TOTAL_BYTES)} on that same
  endpoint, response codes, and JSON and multipart fetch examples. Cross-origin calls
  are accepted from any origin, so a frontend can call it directly.

## Optional

- [API documentation (HTML)](${base}/docs): the same content as a web page, plus a live
  request tester for signed-in users.
`;
}
