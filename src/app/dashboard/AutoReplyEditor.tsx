"use client";

import {
  AUTO_MESSAGE_MAX,
  AUTO_SUBJECT_MAX,
  defaultAutoMessage,
  defaultAutoSubject,
  type AutoResponder,
} from "@/lib/auto-responder";

// The acknowledgement sent to whoever filled the form (SPEC §4e). Subject and message
// are left blank by default and fall back to the built-in wording, so improving that
// wording reaches every app that never customised it.
export function AutoReplyEditor({
  autoResponder,
  websiteName,
  onChange,
  idPrefix,
}: {
  autoResponder: AutoResponder;
  websiteName: string;
  onChange: (autoResponder: AutoResponder) => void;
  idPrefix: string;
}) {
  return (
    <div className="auto-reply-editor">
      <label className="checkbox-row" htmlFor={`${idPrefix}-enabled`}>
        <input
          id={`${idPrefix}-enabled`}
          type="checkbox"
          checked={autoResponder.enabled}
          onChange={(e) => onChange({ ...autoResponder, enabled: e.target.checked })}
        />
        <span>Send an automatic reply to whoever submitted the form</span>
      </label>

      <label htmlFor={`${idPrefix}-subject`}>Subject</label>
      <input
        id={`${idPrefix}-subject`}
        type="text"
        value={autoResponder.subject}
        onChange={(e) => onChange({ ...autoResponder, subject: e.target.value })}
        placeholder={defaultAutoSubject(websiteName)}
        maxLength={AUTO_SUBJECT_MAX}
      />

      <label htmlFor={`${idPrefix}-message`}>Message</label>
      <textarea
        id={`${idPrefix}-message`}
        value={autoResponder.message}
        onChange={(e) => onChange({ ...autoResponder, message: e.target.value })}
        placeholder={defaultAutoMessage(websiteName)}
        maxLength={AUTO_MESSAGE_MAX}
        rows={6}
        aria-describedby={`${idPrefix}-message-help`}
      />
      <p className="muted field-help" id={`${idPrefix}-message-help`}>
        Leave either blank to use the wording shown. Blank lines start a new paragraph,
        and the reply is rendered in this app&rsquo;s mail design. Up to{" "}
        {AUTO_MESSAGE_MAX} characters — {AUTO_MESSAGE_MAX - autoResponder.message.length}{" "}
        left.
      </p>
      <p className="muted field-help">
        It goes only to an email address found in the submission, and it carries your
        text only — nothing the visitor typed is quoted back, because this is the one
        email we send to an address that never confirmed it wanted mail. Each reply
        counts as a second send against the app&rsquo;s daily limit; if the day&rsquo;s
        allowance runs out, the submission still goes through and the reply is skipped.
      </p>
    </div>
  );
}
