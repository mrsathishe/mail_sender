"use client";

import { MAX_MIN_SUBMIT_SECONDS, type SpamGuard } from "@/lib/bot-guard";

// The two bot signals for one app (SPEC §4d). Both are off until the owner names the
// fields their form actually posts — switching a guard on for a form that doesn't send
// the field would reject every real submission, so there is no sensible default here.
export function SpamGuardEditor({
  guard,
  onChange,
  idPrefix,
}: {
  guard: SpamGuard;
  onChange: (guard: SpamGuard) => void;
  idPrefix: string;
}) {
  return (
    <div className="guard-editor">
      <label htmlFor={`${idPrefix}-honeypot`}>Honeypot field name</label>
      <input
        id={`${idPrefix}-honeypot`}
        type="text"
        value={guard.honeypotField ?? ""}
        onChange={(e) => onChange({ ...guard, honeypotField: e.target.value || null })}
        placeholder="e.g. company_url"
        pattern="[A-Za-z][A-Za-z0-9_\-]*"
        maxLength={40}
        spellCheck={false}
        autoCapitalize="none"
        aria-describedby={`${idPrefix}-honeypot-help`}
      />
      <p className="muted field-help" id={`${idPrefix}-honeypot-help`}>
        Add a hidden input with this name to your form and leave it empty. A person
        never sees it, so any submission that fills it is refused with{" "}
        <code>422 honeypot_filled</code>. Pick a plausible name of your own — a
        name every site shared would be one every bot could learn to skip. Leave blank
        to switch the honeypot off.
      </p>

      <label htmlFor={`${idPrefix}-timing`}>Timing field name</label>
      <input
        id={`${idPrefix}-timing`}
        type="text"
        value={guard.timingField ?? ""}
        onChange={(e) => onChange({ ...guard, timingField: e.target.value || null })}
        placeholder="e.g. form_elapsed"
        pattern="[A-Za-z][A-Za-z0-9_\-]*"
        maxLength={40}
        spellCheck={false}
        autoCapitalize="none"
        aria-describedby={`${idPrefix}-timing-help`}
      />

      <label htmlFor={`${idPrefix}-seconds`}>Minimum seconds before submitting</label>
      <input
        id={`${idPrefix}-seconds`}
        type="number"
        min={0}
        max={MAX_MIN_SUBMIT_SECONDS}
        value={guard.minSubmitSeconds}
        onChange={(e) =>
          onChange({ ...guard, minSubmitSeconds: Math.max(0, Number(e.target.value) || 0) })
        }
        aria-describedby={`${idPrefix}-timing-help`}
      />
      <p className="muted field-help" id={`${idPrefix}-timing-help`}>
        Post the milliseconds the form was on screen in that field (or the time it was
        rendered — an epoch stamp or an ISO date both work). Anything faster than this
        is refused with <code>422 too_fast</code>, and a missing value with{" "}
        <code>422 timing_missing</code>. <code>0</code> switches the check off; a
        field name is required whenever it is above zero. Up to{" "}
        {MAX_MIN_SUBMIT_SECONDS} seconds.
      </p>

      <p className="muted field-help">
        Neither field belongs in your form-field list — they are removed from the
        submission before it is checked, so they never appear in the email.
      </p>
    </div>
  );
}
