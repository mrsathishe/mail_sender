// File attachments for the send endpoint (SPEC §4a, §8).
//
// Opt-in per app and off by default, for the same reason the sender is always ours:
// an app that never asked for uploads must not become a 5MB relay just because its
// key leaked. The total request is bounded by ATTACHMENT_MAX_TOTAL_BYTES rather than
// by a per-file cap — N files at a per-file maximum simply multiply, which is the same
// argument body-limit.ts makes for MAX_BODY_BYTES.
//
// Type checking is driven by the **declared extension** and then confirmed by the
// bytes: the extension says what the file claims to be, and the leading bytes decide
// whether that claim is true. Doing it in that order is what removes the ambiguity a
// pure sniffer has — `.docx`, `.xlsx` and `.pptx` are the same zip magic, and `.txt`
// and `.csv` have no magic at all — while still refusing a `.zip` renamed `.pdf`,
// because the rule the extension selected is the one the bytes have to satisfy. The
// content type handed to the mailer is the rule's, never the client's `content-type`
// part header, which is as attacker-controlled as the name.
//
// This module stays free of Node built-ins so the dashboard's client editor can read
// its constants, exactly as bot-guard.ts does.

import type { UploadedFile } from "./body-limit";

/**
 * The whole request, not one file — text fields and every file part together. Ten
 * times MAX_BODY_BYTES, and applied only to an app whose owner switched uploads on:
 * send-endpoint.ts picks between the two caps from `enabled`, so the allowance follows
 * the app rather than the URL. nginx's client_max_body_size on the send location is the
 * outer bound above it and must stay above this number (deploy/nginx.conf).
 */
export const ATTACHMENT_MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB

/** Nothing an owner sets may exceed this — the cap on the cap. */
export const MAX_ATTACHMENTS_CEILING = 5;

export const DEFAULT_MAX_ATTACHMENTS = 3;

export type AttachmentConfig = {
  enabled: boolean;
  /** How many file parts one submission may carry, 1..MAX_ATTACHMENTS_CEILING. */
  maxFiles: number;
};

export const ATTACHMENTS_OFF: AttachmentConfig = {
  enabled: false,
  maxFiles: DEFAULT_MAX_ATTACHMENTS,
};

/** What the mailer needs. `content` stays a Uint8Array so this module needs no Buffer. */
export type MailAttachment = {
  filename: string;
  content: Uint8Array;
  contentType: string;
};

type TypeRule = {
  contentType: string;
  /** Do the leading bytes agree with the extension that selected this rule? */
  matches: (bytes: Uint8Array) => boolean;
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

/** Does `text` appear as ASCII anywhere in the first `limit` bytes? */
function containsAscii(bytes: Uint8Array, text: string, limit: number): boolean {
  const signature = ascii(text);
  const end = Math.min(bytes.byteLength, limit) - signature.length;
  for (let i = 0; i <= end; i++) {
    if (startsWith(bytes, signature, i)) return true;
  }
  return false;
}

/**
 * Text has no magic number, so the check is the absence of anything binary: valid
 * UTF-8, no NUL, and no C0 control characters other than tab/CR/LF. That is enough to
 * refuse an executable or an image renamed `.txt`, which is all this needs to do.
 */
function isPlainText(bytes: Uint8Array): boolean {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Escaped rather than literal: a control character typed into the source would be
  // invisible to anyone reading this line.
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded);
}

/**
 * An Open XML document is a zip whose first entry is `[Content_Types].xml`, and the
 * format is told apart by the directory its parts live under. Both markers are entry
 * *names*, which zip stores uncompressed in the local file headers, so they can be
 * found by scanning bytes without unpacking anything. A plain zip renamed `.docx`
 * carries neither.
 */
function isOoxml(bytes: Uint8Array, partPrefix: string): boolean {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false; // PK\x03\x04
  // First entry in every writer's output, at roughly offset 30.
  if (!containsAscii(bytes, "[Content_Types].xml", 4096)) return false;
  // The part directory's own local header comes after two small entries, but a large
  // document can push it well past 4KB, so this one is not offset-bounded.
  return containsAscii(bytes, partPrefix, bytes.byteLength);
}

/**
 * The accepted types, keyed by lowercase extension. Deliberate omissions, each for its
 * own reason rather than by oversight:
 *
 * - legacy `.doc` / `.xls`: the OLE2 magic `D0 CF 11 E0` is shared by every Office 97
 *   container, so a document cannot be told from a macro-bearing workbook by its bytes;
 * - `.zip` and every other archive: indistinguishable from Open XML by magic, and it
 *   hides its contents from all of the above;
 * - `.svg`: XML that runs script when the recipient opens it in a browser;
 * - executables and scripts, for the obvious reason.
 */
const TYPES: Record<string, TypeRule> = {
  png: {
    contentType: "image/png",
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  jpg: { contentType: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { contentType: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  gif: { contentType: "image/gif", matches: (b) => startsWith(b, ascii("GIF8")) },
  webp: {
    contentType: "image/webp",
    // A RIFF container whose form type is WEBP — the second marker is what stops a
    // .wav from passing, since both open with RIFF.
    matches: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
  },
  pdf: { contentType: "application/pdf", matches: (b) => startsWith(b, ascii("%PDF-")) },
  txt: { contentType: "text/plain; charset=utf-8", matches: isPlainText },
  csv: { contentType: "text/csv; charset=utf-8", matches: isPlainText },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (b) => isOoxml(b, "word/"),
  },
  xlsx: {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    matches: (b) => isOoxml(b, "xl/"),
  },
  pptx: {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    matches: (b) => isOoxml(b, "ppt/"),
  },
};

/** For the docs, the dashboard's help text and the file input's `accept`. */
export const ACCEPTED_EXTENSIONS: string[] = Object.keys(TYPES);

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export type AttachmentConfigError = "invalid_attachments" | "invalid_max_files";

export type ParseAttachmentResult =
  | { ok: true; attachments: AttachmentConfig }
  | { ok: false; error: AttachmentConfigError };

/** Validate an owner-supplied config. Blank means the default, as an emptied input posts. */
export function parseAttachmentConfig(input: unknown): ParseAttachmentResult {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_attachments" };
  const { enabled, maxFiles } = input as Record<string, unknown>;

  const raw =
    maxFiles === undefined || maxFiles === null || maxFiles === ""
      ? DEFAULT_MAX_ATTACHMENTS
      : Number(maxFiles);
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_ATTACHMENTS_CEILING) {
    return { ok: false, error: "invalid_max_files" };
  }

  return { ok: true, attachments: { enabled: Boolean(enabled), maxFiles: raw } };
}

/** Apps stored before attachments existed, or a `.lean()` read that skipped defaults. */
export function resolveAttachmentConfig(value: unknown): AttachmentConfig {
  if (!value || typeof value !== "object") return ATTACHMENTS_OFF;
  const raw = value as Record<string, unknown>;
  const maxFiles = Number(raw.maxFiles);
  return {
    enabled: Boolean(raw.enabled),
    maxFiles:
      Number.isInteger(maxFiles) && maxFiles >= 1
        ? Math.min(maxFiles, MAX_ATTACHMENTS_CEILING)
        : DEFAULT_MAX_ATTACHMENTS,
  };
}

export type AttachmentError =
  | "attachments_not_enabled"
  | "too_many_files"
  | "unsupported_file_type"
  | "empty_file"
  | "invalid_filename";

export type AttachmentCheck =
  | { ok: true; attachments: MailAttachment[]; summary: string[] }
  | { ok: false; error: AttachmentError; file?: string; detail: string };

/**
 * Judge the posted file parts against the app's config. Pure, like the other guards:
 * the caller decides what a refusal costs and what gets logged.
 *
 * `summary` is one human line per accepted file, for the row the email renders — the
 * recipient should be able to see what was attached in a client that hides
 * attachments. `file` on a refusal is the *sanitised* name, so it is safe both to log
 * and to echo back; naming the offending file is what makes the 422 actionable, the
 * same reason the field contract echoes `field`.
 */
export function checkAttachments(
  config: AttachmentConfig,
  files: UploadedFile[]
): AttachmentCheck {
  if (files.length === 0) return { ok: true, attachments: [], summary: [] };

  if (!config.enabled) {
    return {
      ok: false,
      error: "attachments_not_enabled",
      detail: `${files.length} file part(s) posted, attachments are off for this app`,
    };
  }
  if (files.length > config.maxFiles) {
    return {
      ok: false,
      error: "too_many_files",
      detail: `${files.length} files posted, limit is ${config.maxFiles}`,
    };
  }

  const attachments: MailAttachment[] = [];
  const summary: string[] = [];

  for (const file of files) {
    const filename = safeFilename(file.filename);
    const extension = extensionOf(filename);
    if (!extension) {
      return {
        ok: false,
        error: "invalid_filename",
        file: filename,
        detail: `${filename} has no file extension, so its type cannot be established`,
      };
    }

    const rule = TYPES[extension];
    if (!rule) {
      return {
        ok: false,
        error: "unsupported_file_type",
        file: filename,
        detail: `.${extension} is not an accepted type`,
      };
    }

    // A zero-byte part is a slip on the sending side (an empty file input that still
    // posted), and an empty attachment is never what anyone meant to send.
    if (file.bytes.byteLength === 0) {
      return { ok: false, error: "empty_file", file: filename, detail: `${filename} is empty` };
    }

    if (!rule.matches(file.bytes)) {
      return {
        ok: false,
        error: "unsupported_file_type",
        file: filename,
        detail: `${filename} is not really a .${extension}`,
      };
    }

    attachments.push({ filename, content: file.bytes, contentType: rule.contentType });
    summary.push(`${filename} (${formatBytes(file.bytes.byteLength)})`);
  }

  return { ok: true, attachments, summary };
}

const MAX_FILENAME_LENGTH = 100;

/**
 * A name safe to put in a MIME header and then on the recipient's disk. The submitted
 * one is attacker-controlled twice over: a path would escape the folder the recipient
 * saves into, and a CR/LF would end the header early. Anything outside a narrow set
 * becomes `_` rather than being dropped, so two different names cannot silently
 * collapse into one. Never returns an empty string.
 */
export function safeFilename(name: string): string {
  // Basename only: browsers send a bare name, but a scripted client can send anything.
  const base = name.split(/[/\\]/).pop() ?? "";
  const extension = extensionOf(base);
  const stem = extension ? base.slice(0, -(extension.length + 1)) : base;

  const cleanStem = stem
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, MAX_FILENAME_LENGTH);

  const safeStem = cleanStem === "" ? "attachment" : cleanStem;
  return extension ? `${safeStem}.${extension}` : safeStem;
}

/** Lowercased extension after the last dot, or null when there isn't one. */
export function extensionOf(name: string): string | null {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match ? match[1].toLowerCase() : null;
}

/** Sizes as a person reads them, for the summary row and the dashboard's help text. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
