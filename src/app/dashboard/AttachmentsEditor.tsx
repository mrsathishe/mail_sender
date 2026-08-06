"use client";

import {
  ACCEPTED_EXTENSIONS,
  ATTACHMENT_MAX_TOTAL_BYTES,
  MAX_ATTACHMENTS_CEILING,
  formatBytes,
  type AttachmentConfig,
} from "@/lib/attachments";

// File attachments for one app. Off until the owner asks for them: switching it on raises
// the request cap ten-fold, and an app whose form has no file input has nothing to gain
// from being able to accept one. The endpoint does not change — the setting is what the
// send pipeline reads to decide the cap and whether file parts are kept.
//
// The rules (size, types, how files reach the email) sit behind the (i) beside the input
// rather than under it: four paragraphs of caveats read as the main content of the panel
// when the panel is really one checkbox and one number.
export function AttachmentsEditor({
  attachments,
  onChange,
  idPrefix,
}: {
  attachments: AttachmentConfig;
  onChange: (attachments: AttachmentConfig) => void;
  idPrefix: string;
}) {
  const tipId = `${idPrefix}-tip`;
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
      <div className="input-with-tip">
        <input
          id={`${idPrefix}-max-files`}
          type="number"
          min={1}
          max={MAX_ATTACHMENTS_CEILING}
          value={attachments.maxFiles}
          onChange={(e) =>
            onChange({ ...attachments, maxFiles: Math.max(1, Number(e.target.value) || 1) })
          }
          aria-describedby={tipId}
        />
        {/* A button, not a bare icon: it has to be reachable by keyboard, and
            `:focus-within` on the wrapper is what opens the tip without JS. */}
        <span className="info-tip">
          <button
            type="button"
            className="info-tip-btn"
            aria-label="How attachments work"
            aria-describedby={tipId}
          >
            i
          </button>
          <span className="info-tip-body" role="tooltip" id={tipId}>
            <span>
              Up to {MAX_ATTACHMENTS_CEILING} files. More than the number set here is refused
              with <code>422 too_many_files</code>.
            </span>
            <span>
              Add a file input to your form and post it as <code>multipart/form-data</code> to
              the same <code>/api/v1/send</code> — same secret key, same fields, same
              responses, no URL to change. With this switched on the whole request may total{" "}
              <strong>{formatBytes(ATTACHMENT_MAX_TOTAL_BYTES)}</strong>, text fields and files
              together, and anything larger is refused with{" "}
              <code>413 payload_too_large</code>. Switched off, a posted file is refused with{" "}
              <code>422 attachments_not_enabled</code> and no email is sent.
            </span>
            <span>
              Accepted types: {ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(", ")}. The
              contents are checked, not just the name, so a file renamed to get past the list
              is refused with <code>422 unsupported_file_type</code>. Archives and programs are
              not accepted — a zip hides whatever is inside it from that check.
            </span>
            <span>
              A file input does not belong in your form-field list. Files arrive as their own
              parts, are listed in the email as an <em>Attached files</em> row and are attached
              to it — the submission still counts as one send against the daily limit.
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
