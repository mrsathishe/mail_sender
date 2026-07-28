// The built-in mail designs. An app owner picks one when registering an app and
// can switch it later; designs are not editable, so everything lives in code and
// only the chosen id is stored (docs/MAIL_TEMPLATES_SPEC.md §2).
//
// Every design must: use inline styles only (no <style>/classes — Gmail strips
// them), stay table-based, cap at 600px, and render values via the shared rows
// from ./flatten so escaping is never re-implemented here.

import { escapeHtml, toRows, type EmailRow } from "./flatten";

export type TemplateMeta = { websiteName: string; receivedAt?: Date };

type Renderer = (rows: EmailRow[], meta: Required<TemplateMeta>) => string;

type Template = {
  id: string;
  name: string;
  description: string;
  render: Renderer;
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Shared outer shell: doctype, head, and a centering wrapper table.
function emailDocument(opts: {
  title: string;
  pageBackground: string;
  textColor: string;
  inner: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:24px 12px;background:${opts.pageBackground};color:${opts.textColor};font-family:${FONT};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;border-collapse:collapse;color:${opts.textColor};">
          ${opts.inner}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(title: string, subtitle: string): string {
  return `<div style="font-size:18px;font-weight:700;">${title}</div>
              <div style="margin-top:4px;font-size:13px;opacity:0.75;">${subtitle}</div>`;
}

function footerText(receivedAt: Date): string {
  return `Received ${escapeHtml(receivedAt.toUTCString())} · sent by Mail Sender`;
}

// ── card ─────────────────────────────────────────────────────────────────────
const card: Renderer = (rows, meta) => {
  const site = escapeHtml(meta.websiteName);
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;font-weight:600;vertical-align:top;width:180px;">${r.label}</td>` +
        `<td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;line-height:1.5;word-break:break-word;">${r.valueHtml}</td>` +
        `</tr>`
    )
    .join("");

  return emailDocument({
    title: `New submission from ${site}`,
    pageBackground: "#f3f4f6",
    textColor: "#111827",
    inner: `<tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:20px 16px;background:#111827;color:#ffffff;">
                    ${heading("New form submission", site)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${body}</table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;color:#6b7280;font-size:12px;">${footerText(
                    meta.receivedAt
                  )}</td>
                </tr>
              </table>
            </td>
          </tr>`,
  });
};

// ── minimal ──────────────────────────────────────────────────────────────────
const minimal: Renderer = (rows, meta) => {
  const site = escapeHtml(meta.websiteName);
  const body = rows
    .map(
      (r) =>
        `<tr><td style="padding:0 0 22px;">` +
        `<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${r.label}</div>` +
        `<div style="margin-top:6px;font-size:16px;line-height:1.6;color:#111827;word-break:break-word;">${r.valueHtml}</div>` +
        `</td></tr>`
    )
    .join("");

  return emailDocument({
    title: `New submission from ${site}`,
    pageBackground: "#ffffff",
    textColor: "#111827",
    inner: `<tr>
            <td style="padding:8px 4px 28px;">
              <div style="font-size:22px;font-weight:700;">New form submission</div>
              <div style="margin-top:6px;font-size:14px;color:#6b7280;">${site}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${body}</table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 4px 0;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">${footerText(
              meta.receivedAt
            )}</td>
          </tr>`,
  });
};

// ── compact ──────────────────────────────────────────────────────────────────
const compact: Renderer = (rows, meta) => {
  const site = escapeHtml(meta.websiteName);
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:6px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;font-size:12px;font-weight:600;vertical-align:top;width:150px;">${r.label}</td>` +
        `<td style="padding:6px 10px;border:1px solid #d1d5db;color:#111827;font-size:12px;line-height:1.45;word-break:break-word;">${r.valueHtml}</td>` +
        `</tr>`
    )
    .join("");

  return emailDocument({
    title: `New submission from ${site}`,
    pageBackground: "#ffffff",
    textColor: "#111827",
    inner: `<tr>
            <td style="padding:0 0 10px;font-size:14px;font-weight:700;">
              New form submission — <span style="font-weight:400;color:#6b7280;">${site}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${body}</table>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0 0;color:#9ca3af;font-size:11px;">${footerText(
              meta.receivedAt
            )}</td>
          </tr>`,
  });
};

// ── dark ─────────────────────────────────────────────────────────────────────
const dark: Renderer = (rows, meta) => {
  const site = escapeHtml(meta.websiteName);
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:12px 16px;border-bottom:1px solid #334155;color:#94a3b8;font-size:13px;font-weight:600;vertical-align:top;width:170px;">${r.label}</td>` +
        `<td style="padding:12px 16px;border-bottom:1px solid #334155;color:#e2e8f0;font-size:14px;line-height:1.5;word-break:break-word;">${r.valueHtml}</td>` +
        `</tr>`
    )
    .join("");

  return emailDocument({
    title: `New submission from ${site}`,
    pageBackground: "#0f172a",
    textColor: "#e2e8f0",
    inner: `<tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="padding:20px 16px;border-bottom:1px solid #334155;color:#f8fafc;">
                    ${heading("New form submission", site)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${body}</table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;color:#94a3b8;font-size:12px;">${footerText(
                    meta.receivedAt
                  )}</td>
                </tr>
              </table>
            </td>
          </tr>`,
  });
};

// ── accent ───────────────────────────────────────────────────────────────────
const ACCENT = "#2563eb";

const accent: Renderer = (rows, meta) => {
  const site = escapeHtml(meta.websiteName);
  const body = rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">` +
        `<td style="padding:12px 18px;color:#475569;font-size:13px;font-weight:600;vertical-align:top;width:170px;">${r.label}</td>` +
        `<td style="padding:12px 18px;color:#0f172a;font-size:14px;line-height:1.55;word-break:break-word;">${r.valueHtml}</td>` +
        `</tr>`
    )
    .join("");

  return emailDocument({
    title: `New submission from ${site}`,
    pageBackground: "#eef2ff",
    textColor: "#0f172a",
    // The stripe is a real 5px cell, not a border-left: with
    // border-collapse:collapse a table-level border is dropped by most clients.
    inner: `<tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border-radius:6px;overflow:hidden;">
                <tr>
                  <td width="5" style="width:5px;background:${ACCENT};"></td>
                  <td style="padding:0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:22px 18px 16px;">
                          <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${ACCENT};">New form submission</div>
                          <div style="margin-top:6px;font-size:22px;font-weight:700;color:#0f172a;">${site}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border-top:1px solid #e2e8f0;">${body}</table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:14px 18px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">${footerText(
                          meta.receivedAt
                        )}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`,
  });
};

export const TEMPLATES = {
  card: {
    id: "card",
    name: "Card",
    description: "Dark header bar over a white card with two-column rows.",
    render: card,
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "No card or borders — a bold label above each value, plenty of space.",
    render: minimal,
  },
  compact: {
    id: "compact",
    name: "Compact table",
    description: "Dense bordered grid in smaller type — best for forms with many fields.",
    render: compact,
  },
  dark: {
    id: "dark",
    name: "Dark",
    description: "Dark background with light text and subtle row dividers.",
    render: dark,
  },
  accent: {
    id: "accent",
    name: "Accent bar",
    description: "Blue left stripe, large site title and zebra-striped rows.",
    render: accent,
  },
} satisfies Record<string, Template>;

export type TemplateId = keyof typeof TEMPLATES;

export const DEFAULT_TEMPLATE_ID: TemplateId = "card";

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as [TemplateId, ...TemplateId[]];

// Metadata for the dashboard picker — never includes the render functions.
export const TEMPLATE_LIST: { id: TemplateId; name: string; description: string }[] =
  TEMPLATE_IDS.map((id) => ({
    id,
    name: TEMPLATES[id].name,
    description: TEMPLATES[id].description,
  }));

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && value in TEMPLATES;
}

// Apps registered before templates existed have no id at all — fall back to the
// default rather than failing the send.
export function resolveTemplateId(value: unknown): TemplateId {
  return isTemplateId(value) ? value : DEFAULT_TEMPLATE_ID;
}

export function templateName(value: unknown): string {
  return TEMPLATES[resolveTemplateId(value)].name;
}

export function renderEmailHtml(
  templateId: unknown,
  data: Record<string, unknown>,
  meta: TemplateMeta
): string {
  return TEMPLATES[resolveTemplateId(templateId)].render(toRows(data), {
    websiteName: meta.websiteName,
    receivedAt: meta.receivedAt ?? new Date(),
  });
}

// Fixed payload behind /api/templates/[id]/preview so the dashboard preview
// exercises a plain value, a long value, a nested object and an empty field.
export const PREVIEW_DATA: Record<string, unknown> = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "+1 555 0134",
  message:
    "Hi — I'd like a quote for the contact form integration.\nCould you call me this week?",
  company: { name: "Acme Inc.", size: "25 people" },
  interests: ["Pricing", "Support plan"],
  budget: "",
};
