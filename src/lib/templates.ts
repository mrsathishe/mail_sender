// The built-in mail designs. An app owner picks one when registering an app and
// can switch it later; designs are not editable, so everything lives in code and
// only the chosen id is stored (docs/MAIL_TEMPLATES_SPEC.md §2).
//
// Every design must: use inline styles only (no <style>/classes — Gmail strips
// them), stay table-based, cap at 600px, and render values via the shared rows
// from ./flatten so escaping is never re-implemented here.

import { escapeHtml, paragraphsHtml, toRows, type EmailRow } from "./flatten";
import { BRAND_FULL } from "./brand";

export type TemplateMeta = { websiteName: string; receivedAt?: Date };

type Renderer = (rows: EmailRow[], meta: Required<TemplateMeta>) => string;

/**
 * The handful of colours a design is recognisable by. Extracted because the
 * autoresponder (SPEC §4e) is prose, not label/value rows, so it cannot go through a
 * design's `render` — one shared acknowledgement layout reading these keeps it
 * looking like the design the owner picked without five more renderers to maintain.
 * Each design's own `render` reads `page`/`text` from here too, so the two can't drift.
 */
type Palette = {
  page: string;
  text: string;
  card: string;
  border: string;
  muted: string;
  accent: string;
};

type Template = {
  id: string;
  name: string;
  description: string;
  palette: Palette;
  /**
   * Height in px the dashboard's preview <iframe> needs to show this design's
   * PREVIEW_DATA render in full. Measured per design and stored here because the
   * preview is served with `sandbox=""` and a `default-src 'none'` CSP — nothing
   * inside it can report its own height, and a fixed height for all five left the
   * taller designs cut off with an inner scrollbar.
   */
  previewHeight: number;
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
  return `Received ${escapeHtml(receivedAt.toUTCString())} · sent by ${escapeHtml(BRAND_FULL)}`;
}

// ── card ─────────────────────────────────────────────────────────────────────
const cardPalette: Palette = {
  page: "#f3f4f6",
  text: "#111827",
  card: "#ffffff",
  border: "#e5e7eb",
  muted: "#6b7280",
  accent: "#111827",
};

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
    pageBackground: cardPalette.page,
    textColor: cardPalette.text,
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
const minimalPalette: Palette = {
  page: "#ffffff",
  text: "#111827",
  card: "#ffffff",
  border: "#e5e7eb",
  muted: "#6b7280",
  accent: "#111827",
};

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
    pageBackground: minimalPalette.page,
    textColor: minimalPalette.text,
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
const compactPalette: Palette = {
  page: "#ffffff",
  text: "#111827",
  card: "#ffffff",
  border: "#d1d5db",
  muted: "#9ca3af",
  accent: "#111827",
};

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
    pageBackground: compactPalette.page,
    textColor: compactPalette.text,
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
const darkPalette: Palette = {
  page: "#0f172a",
  text: "#e2e8f0",
  card: "#1e293b",
  border: "#334155",
  muted: "#94a3b8",
  accent: "#f8fafc",
};

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
    pageBackground: darkPalette.page,
    textColor: darkPalette.text,
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

const accentPalette: Palette = {
  page: "#eef2ff",
  text: "#0f172a",
  card: "#ffffff",
  border: "#e2e8f0",
  muted: "#94a3b8",
  accent: ACCENT,
};

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
    pageBackground: accentPalette.page,
    textColor: accentPalette.text,
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
    palette: cardPalette,
    previewHeight: 620,
    render: card,
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "No card or borders — a bold label above each value, plenty of space.",
    palette: minimalPalette,
    previewHeight: 700,
    render: minimal,
  },
  compact: {
    id: "compact",
    name: "Compact table",
    description: "Dense bordered grid in smaller type — best for forms with many fields.",
    palette: compactPalette,
    previewHeight: 420,
    render: compact,
  },
  dark: {
    id: "dark",
    name: "Dark",
    description: "Dark background with light text and subtle row dividers.",
    palette: darkPalette,
    previewHeight: 620,
    render: dark,
  },
  accent: {
    id: "accent",
    name: "Accent bar",
    description: "Blue left stripe, large site title and zebra-striped rows.",
    palette: accentPalette,
    previewHeight: 660,
    render: accent,
  },
} satisfies Record<string, Template>;

export type TemplateId = keyof typeof TEMPLATES;

export const DEFAULT_TEMPLATE_ID: TemplateId = "card";

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as [TemplateId, ...TemplateId[]];

/** What the dashboard picker needs — never the render functions. */
export type TemplateSummary = {
  id: TemplateId;
  name: string;
  description: string;
  previewHeight: number;
};

// Metadata for the dashboard picker — never includes the render functions.
export const TEMPLATE_LIST: TemplateSummary[] = TEMPLATE_IDS.map((id) => ({
  id,
  name: TEMPLATES[id].name,
  description: TEMPLATES[id].description,
  previewHeight: TEMPLATES[id].previewHeight,
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

/**
 * The autoresponder acknowledgement (SPEC §4e), in the palette of the app's chosen
 * design. Deliberately **one** layout for all five: the body is a paragraph of the
 * owner's own text rather than label/value rows, so a per-design variant would be
 * five copies of the same thing. Nothing the submitter posted appears here — only
 * `message`, which the owner wrote — because this mail goes to an address the
 * submitter chose.
 */
export function renderAutoReplyHtml(
  templateId: unknown,
  opts: { websiteName: string; message: string }
): string {
  const p = TEMPLATES[resolveTemplateId(templateId)].palette;
  const site = escapeHtml(opts.websiteName);
  const body = paragraphsHtml(
    opts.message,
    `margin:0 0 14px;color:${p.text};font-size:15px;line-height:1.6;`
  );

  return emailDocument({
    title: `Thanks for contacting ${site}`,
    pageBackground: p.page,
    textColor: p.text,
    inner: `<tr>
            <td style="padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:${p.card};border:1px solid ${p.border};border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:20px 20px 8px;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${p.accent};">Thanks for getting in touch</div>
                    <div style="margin-top:6px;font-size:20px;font-weight:700;color:${p.text};">${site}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 20px 4px;">${body}</td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;border-top:1px solid ${p.border};color:${p.muted};font-size:12px;line-height:1.5;">
                    You received this automatic reply because this address was used to
                    submit the form on ${site}; a reply to this message goes to them.
                    Sent by ${escapeHtml(BRAND_FULL)}.
                  </td>
                </tr>
              </table>
            </td>
          </tr>`,
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

// The one sample render, shared by the dashboard preview route and the landing
// page's "what lands in the inbox" frame — two copies of this drifted the moment
// either sample payload was edited.
export function renderPreviewHtml(templateId: TemplateId): string {
  return renderEmailHtml(templateId, PREVIEW_DATA, {
    websiteName: "Your website",
    // Fixed date so the sample is deterministic (and cacheable by the browser).
    receivedAt: new Date(Date.UTC(2026, 0, 15, 9, 30)),
  });
}
