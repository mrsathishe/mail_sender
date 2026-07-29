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

import { BRAND_FULL, BRAND_TAGLINE, CONTACT_EMAIL } from "./brand";
import { DEFAULT_FIELDS, MAX_FIELDS } from "./fields";
import { env } from "./env";

export type DocBlock =
  | { kind: "prose"; markdown: string }
  | { kind: "code"; label?: string; code: string }
  | { kind: "endpoint"; method: string; url: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

export type DocSection = { id: string; heading: string; blocks: DocBlock[] };

export const DOCS_TITLE = `${BRAND_FULL} — API documentation`;
export const DOCS_TAGLINE = BRAND_TAGLINE;

export function docSections(base: string): DocSection[] {
  const endpoint = `${base}/api/v1/send`;

  return [
    {
      id: "overview",
      heading: "Overview",
      blocks: [
        {
          kind: "prose",
          markdown:
            `Send your website's form submissions to any email inbox — Gmail, Zoho, ` +
            `Outlook or your own domain — with a single HTTP request. First register an ` +
            `app on the [dashboard](${base}/dashboard) to get a **secret key**, set the ` +
            `destination address, declare the fields your form sends, and pick a mail ` +
            `design. Then call the endpoint below with that key.`,
        },
        { kind: "endpoint", method: "POST", url: endpoint },
      ],
    },
    {
      id: "destination-confirmation",
      heading: "Destination confirmation",
      blocks: [
        {
          kind: "prose",
          markdown:
            "A destination address has to be confirmed before anything is delivered " +
            "to it — otherwise the service could be pointed at an inbox that never " +
            "asked for the mail.\n\n" +
            "- **Your own address.** Tick *“send to my account address”* when " +
            "registering the app (or just type the address you signed up with) and " +
            "the app is confirmed straight away — verifying your email at signup " +
            "already proved it. The secret key is shown immediately.\n" +
            "- **Any other address.** We email that address an 8-character code. The " +
            "app is created with **no secret key at all**; entering the code on the " +
            `[dashboard](${base}/dashboard) confirms the address and issues the key.\n\n` +
            "Until an address is confirmed, `/api/v1/send` rejects every submission " +
            "with `403 destination_unverified`. Codes last 15 minutes and allow 5 " +
            "attempts; the dashboard can send a fresh one, which replaces the old.",
        },
      ],
    },
    {
      id: "authentication",
      heading: "Authentication",
      blocks: [
        {
          kind: "prose",
          markdown:
            "Pass your secret key as a Bearer token in the `Authorization` header. A " +
            "missing or wrong key returns `401`.\n\n" +
            "**This is a server-side key.** Call the endpoint from your backend and keep " +
            "the key in an environment variable — anything shipped to a browser is " +
            "readable by anyone. A browser cannot make this call in any case: the key " +
            "travels in a request header, which a plain HTML form cannot set. " +
            "If your site has no backend, see the last example under **Examples**: the " +
            "form posts to a small route you own, which forwards it with the key.",
        },
        { kind: "code", code: "Authorization: Bearer YOUR_SECRET_KEY" },
      ],
    },
    {
      id: "request-body",
      heading: "Request body",
      blocks: [
        {
          kind: "prose",
          markdown:
            "Send a JSON object (or a form post). Every top-level field becomes one row " +
            "in a formatted HTML email (with a `Key: value` plain-text fallback). Nested " +
            "objects and arrays are rendered as sub-lists, and values are escaped — so " +
            '`{ "name": "Jane", "message": "Hi" }` arrives as:',
        },
        { kind: "code", code: "Name: Jane\nMessage: Hi" },
        {
          kind: "prose",
          markdown:
            "Which field names are accepted is up to you — see **Form fields** below. " +
            "The email is rendered with the **mail design** selected for that app. Pick " +
            `one when you register the app, or change it any time from the ` +
            `[dashboard](${base}/dashboard).`,
        },
        {
          kind: "prose",
          markdown:
            "**Limits.** The whole request body must stay under **500KB** — larger " +
            "posts are refused with `413` before being read. There is no separate " +
            "per-field limit, so a single long message field may use that budget. " +
            "Nesting deeper than 5 levels is rejected with `400 body_too_deep`. File " +
            "uploads are not supported yet: file parts in a form post are ignored. " +
            "How many emails an app may send is covered under **Sending limits**.",
        },
      ],
    },
    {
      id: "form-fields",
      heading: "Form fields",
      blocks: [
        {
          kind: "prose",
          markdown:
            "Each app declares the fields its form sends, and submissions are checked " +
            "against that list. A new app starts with the four a contact form usually " +
            "has:",
        },
        {
          kind: "table",
          headers: ["Field", "Required"],
          rows: DEFAULT_FIELDS.map((f) => [`\`${f.name}\``, f.required ? "Yes" : "No"]),
        },
        {
          kind: "prose",
          markdown:
            `Edit the list on the [dashboard](${base}/dashboard) — add your own names, ` +
            "mark them required or optional, up to " +
            `${MAX_FIELDS} of them. Names must start with a letter and contain only ` +
            "letters, digits, `_` or `-`; they are matched case-insensitively, so " +
            "posting `Email` satisfies a declared `email`.\n\n" +
            "The check is strict, which is what stops a leaked key being used to mail " +
            "arbitrary content to your inbox:\n\n" +
            "- a field you didn't declare → `400 unknown_field`, and no email is sent;\n" +
            "- a required field missing or empty → `400 missing_field`;\n" +
            "- an optional field may be absent, and still appears in the email as `—`.\n\n" +
            "Both errors name the offending field, and rows always arrive in the order " +
            "you declared them — not the order the request happened to serialise.",
        },
        {
          kind: "code",
          label: "Rejected: `subject` was never declared",
          code: '{ "error": "unknown_field", "field": "subject" }',
        },
      ],
    },
    {
      id: "sending-limits",
      heading: "Sending limits",
      blocks: [
        {
          kind: "prose",
          markdown:
            `Each app may send **${env.appDailySendLimit} emails a day**, counted per ` +
            "app on the UTC calendar day and reset at midnight UTC. A contact form " +
            "never comes close; the limit is there so one runaway script can't spend " +
            "the shared sending allowance every other app depends on.\n\n" +
            "Past it, further submissions that day are refused with " +
            "`429 daily_limit_exceeded` and the response names the limit. Nothing is " +
            "silently dropped, and the cap is a setting rather than a hard ceiling — " +
            `if your form legitimately needs more, ask us at [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) ` +
            "and we will raise it.",
        },
        {
          kind: "prose",
          markdown:
            "**Repeats are collapsed.** An identical submission from the same app " +
            "within 60 seconds is treated as the request you already made: it answers " +
            "`202` with `\"duplicate\": true` and sends no second email. That makes a " +
            "double-clicked submit button, or a retry after a slow response, safe to " +
            "send — you never need to build your own idempotency key. A failed send is " +
            "not counted as a repeat, so retrying after a `502` does deliver.",
        },
        {
          kind: "prose",
          markdown:
            "**What counts.** Every submission that reaches the mail server counts, " +
            "including one that fails there — it still cost a send. A submission " +
            "refused earlier (a `400`, a `422` from the spam guards, or a collapsed " +
            "duplicate) does not. With the **automatic reply** switched on, the " +
            "confirmation to the submitter is a second email and counts as a second " +
            "send.",
        },
      ],
    },
    {
      id: "spam-protection",
      heading: "Spam protection",
      blocks: [
        {
          kind: "prose",
          markdown:
            "Two guards sit in front of the email, and both refuse a submission with " +
            "`422` before anything is sent — so a blocked one costs you nothing from " +
            "your daily allowance.\n\n" +
            "**Bot signals (optional, per app).** Configure them on the " +
            `[dashboard](${base}/dashboard); both are off until you do.\n\n` +
            "- **Honeypot.** Name a field of your own, add it to the form as a hidden " +
            "input, and leave it empty. A person never sees it, so anything that " +
            "fills it is a bot → `422 honeypot_filled`. The name is yours rather " +
            "than one we publish, because a shared name is one every bot could learn " +
            "to skip.\n" +
            "- **Minimum fill time.** Name a field that carries how long the form was " +
            "on screen — milliseconds elapsed, or the time it was rendered as an " +
            "epoch stamp or ISO date — and a minimum in seconds. Faster than that → " +
            "`422 too_fast`; nothing usable in the field → `422 timing_missing`. A " +
            "client clock running ahead of ours is never treated as a bot.\n\n" +
            "Neither field belongs in your **Form fields** list: both are removed from " +
            "the submission before it is checked, so they never appear in the email.",
        },
        {
          kind: "code",
          label: "The two hidden inputs, in your own form",
          code: `<!-- Honeypot: hidden, and left empty by anything human. -->
<input type="text" name="company_url" value="" tabindex="-1"
       autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />

<!-- Timing: how long the form has been on screen, in milliseconds. -->
<input type="hidden" name="form_elapsed" value="0" id="form_elapsed" />
<script>
  const shown = Date.now();
  document.querySelector("form").addEventListener("submit", () => {
    document.getElementById("form_elapsed").value = Date.now() - shown;
  });
</script>`,
        },
        {
          kind: "prose",
          markdown:
            "**Content filtering (always on).** Every submission is scored on what it " +
            "contains — how many links it carries, whether it holds anchor or BBCode " +
            "markup, whether a value opens with a mail header such as `bcc:`, and a " +
            "small set of spam phrases. Past the threshold it is refused with " +
            "`422 spam_rejected` and recorded in the app's activity with the reason, " +
            "so you can see what was stopped.\n\n" +
            "The weighting leans on **structure, not vocabulary**: phrases alone can " +
            "never reach the threshold, because a real enquiry may legitimately talk " +
            "about SEO or backlinks. A normal contact form submission — even one with " +
            "a link or two — does not come close. If something of yours is being " +
            `refused, send it to us at [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) and ` +
            "we will retune it.",
        },
      ],
    },
    {
      id: "auto-reply",
      heading: "Automatic reply to the submitter",
      blocks: [
        {
          kind: "prose",
          markdown:
            "An app can send a *“we got your message”* confirmation back to whoever " +
            `filled the form. Switch it on per app on the [dashboard](${base}/dashboard), ` +
            "where you can also set the subject and message; leave either blank to use " +
            "the built-in wording. It is rendered in the same mail design as the " +
            "submission itself.\n\n" +
            "- It is sent **only** to an email address found in the submission — the " +
            "same one used for `Reply-To:`. No address in the body means no reply, and " +
            "no submission may name a recipient of its own.\n" +
            "- It carries **your** text only. Nothing the visitor typed is quoted back, " +
            "because this is the one email that goes to an address which never " +
            "confirmed it wanted mail from us.\n" +
            "- A reply to it reaches your destination inbox, not us.\n" +
            "- It is a **second email**, so it uses a second send from the app's daily " +
            "allowance. If the day's allowance runs out, the submission still goes " +
            "through and the confirmation is the part that is skipped — never the " +
            "other way round.\n\n" +
            `Both emails appear in the app's activity on the [dashboard](${base}/dashboard), ` +
            "labelled so you can tell them apart.",
        },
      ],
    },
    {
      id: "responses",
      heading: "Responses",
      blocks: [
        {
          kind: "table",
          headers: ["Status", "Meaning"],
          rows: [
            ["`202`", "Accepted — the email was sent to the configured address."],
            [
              "`202`",
              "`duplicate: true` — an identical submission within 60s; no second email sent.",
            ],
            ["`400`", "Empty or invalid body."],
            [
              "`400`",
              "`unknown_field` — the submission contained a field the app doesn't declare.",
            ],
            ["`400`", "`missing_field` — a required field was absent or empty."],
            ["`400`", "`body_too_deep` — the body nests more than 5 levels."],
            ["`401`", "Secret key missing or invalid."],
            [
              "`403`",
              "`destination_unverified` — the destination address hasn't confirmed yet.",
            ],
            ["`413`", "`payload_too_large` — the request body exceeded 500KB."],
            ["`422`", "`honeypot_filled` — the app's honeypot field arrived non-empty."],
            [
              "`422`",
              "`too_fast` — submitted faster than the app's minimum fill time.",
            ],
            [
              "`422`",
              "`timing_missing` — the timing field held nothing usable.",
            ],
            ["`422`", "`spam_rejected` — the content scored past the spam threshold."],
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
      id: "examples",
      heading: "Examples",
      blocks: [
        {
          kind: "prose",
          markdown:
            "Every call to this endpoint is made **from your server**. A browser " +
            "cannot make it: the key would be visible in the page, and a plain form " +
            "cannot send the `Authorization` header it needs. The pattern for a static " +
            "or client-rendered site is the last pair below — the form posts to a small " +
            "route you own, and that route forwards the fields with the key.",
        },
        {
          kind: "code",
          label: "cURL",
          code: `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer YOUR_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Hello!"}'`,
        },
        {
          kind: "code",
          label: "Node.js (fetch)",
          code: `// Server-side only — keep YOUR_SECRET_KEY in an environment variable.
await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.MAIL_SENDER_KEY}\`,
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
          kind: "code",
          label: "HTML form → your own route",
          code: `<!-- The form posts to your site, not to us. No key in the browser. -->
<form method="POST" action="/api/contact">
  <input name="name" placeholder="Your name" required />
  <input name="email" type="email" placeholder="Your email" required />
  <input name="phone" placeholder="Phone (optional)" />
  <textarea name="message" placeholder="Message" required></textarea>
  <button type="submit">Send</button>
</form>`,
        },
        {
          kind: "code",
          label: "…and the route that forwards it (Next.js)",
          code: `// app/api/contact/route.js — runs on your server, where the key is safe.
export async function POST(request) {
  const form = await request.formData();

  const res = await fetch("${endpoint}", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${process.env.MAIL_SENDER_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(Object.fromEntries(form)),
  });

  // 303 so the browser follows with GET and a refresh doesn't re-submit.
  const next = res.ok ? "/thanks" : "/contact?error=1";
  return Response.redirect(new URL(next, request.url), 303);
}`,
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

> ${DOCS_TAGLINE}

A website POSTs its form submissions plus a secret key to one endpoint, and the
service emails them to the destination inbox configured for that app. Register an
app in the dashboard to get a secret key, a destination address, the list of form
fields the app accepts, and a mail design.

## Docs

- [API documentation](${base}/docs.md): the POST /api/v1/send endpoint — bearer-token
  authentication (server-side key), request body shape, the per-app form-field contract,
  the ${env.appDailySendLimit}-per-day per-app sending limit, the honeypot / fill-time /
  content spam guards, the optional automatic reply to the submitter, response codes,
  and cURL / Node.js / HTML-form-via-your-own-route examples.

## Optional

- [API documentation (HTML)](${base}/docs): the same content as a web page, plus a live
  request tester for signed-in users.
`;
}
