"use client";

import {
  ACCEPTED_EXTENSIONS,
  ATTACHMENT_MAX_TOTAL_BYTES,
  MAX_ATTACHMENTS_CEILING,
  formatBytes,
  type AttachmentConfig,
} from "@/lib/attachments";

// File attachments for one app. Off until the owner asks for them: uploads
// go to a different endpoint with a ten-times-larger body cap, and an app whose form
// has no file input has nothing to gain from being able to accept one.
export function AttachmentsEditor({
  attachments,
  onChange,
  idPrefix,
}: {
  attachments: AttachmentConfig;
  onChange: (attachments: AttachmentConfig) => void;
  idPrefix: string;
}) {
  return (
    <div className="guard-editor">
      <label className="checkbox-row" htmlFor={`${idPrefix}-enabled`}>
        <input
          id={`${idPrefix}-enabled`}
          type="checkbox"
          checked={attachments.enabled}
          onChange={(e) => onChange({ ...attachments, enabled: e.target.checked })}
        />
        <span>Accept file uploads from this form</span>
      </label>

      <label htmlFor={`${idPrefix}-max-files`}>Maximum files per submission</label>
      <input
        id={`${idPrefix}-max-files`}
        type="number"
        min={1}
        max={MAX_ATTACHMENTS_CEILING}
        value={attachments.maxFiles}
        onChange={(e) =>
          onChange({ ...attachments, maxFiles: Math.max(1, Number(e.target.value) || 1) })
        }
        aria-describedby={`${idPrefix}-max-files-help`}
      />
      <p className="muted field-help" id={`${idPrefix}-max-files-help`}>
        Up to {MAX_ATTACHMENTS_CEILING}. More than this in one submission is refused with{" "}
        <code>422 too_many_files</code>.
      </p>

      <p className="muted field-help">
        Post the form as <code>multipart/form-data</code> to{" "}
        <code>/api/v1/sendWithAttachment</code> instead of <code>/api/v1/send</code> — same
        secret key, same fields, same responses. The whole request may total{" "}
        <strong>{formatBytes(ATTACHMENT_MAX_TOTAL_BYTES)}</strong>, text fields and files
        together, and anything larger is refused with <code>413 payload_too_large</code>.
      </p>
      <p className="muted field-help">
        Accepted types: {ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(", ")}. The
        contents are checked, not just the name, so a file renamed to get past the list is
        refused with <code>422 unsupported_file_type</code>. Archives and programs are not
        accepted — a zip hides whatever is inside it from that check.
      </p>
      <p className="muted field-help">
        A file input does not belong in your form-field list. Files arrive as their own
        parts, are listed in the email as an <em>Attached files</em> row and are attached
        to it — the submission still counts as one send against the daily limit.
      </p>
    </div>
  );
}
