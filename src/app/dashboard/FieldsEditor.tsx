"use client";

import { DEFAULT_FIELDS, MAX_FIELDS, type AppField } from "@/lib/fields";

// The submission contract for one app: which field names /v1/send will accept and
// which of them are mandatory. Names are validated again on the server (lib/fields)
// — `pattern` here only spares the user a round trip.
export function FieldsEditor({
  fields,
  onChange,
  idPrefix,
}: {
  fields: AppField[];
  onChange: (fields: AppField[]) => void;
  idPrefix: string;
}) {
  function update(index: number, patch: Partial<AppField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  return (
    <div className="fields-editor">
      <ul className="field-rows">
        {fields.map((field, i) => (
          <li className="field-row" key={i}>
            <div className="field-row-name">
              <label className="visually-hidden" htmlFor={`${idPrefix}-name-${i}`}>
                Field {i + 1} name
              </label>
              <input
                id={`${idPrefix}-name-${i}`}
                type="text"
                value={field.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="field_name"
                pattern="[A-Za-z][A-Za-z0-9_\-]*"
                maxLength={40}
                required
                spellCheck={false}
                autoCapitalize="none"
              />
            </div>
            <label className="field-row-required" htmlFor={`${idPrefix}-req-${i}`}>
              <input
                id={`${idPrefix}-req-${i}`}
                type="checkbox"
                checked={field.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              <span>Required</span>
            </label>
            <button
              type="button"
              className="field-remove"
              onClick={() => onChange(fields.filter((_, j) => j !== i))}
              disabled={fields.length === 1}
              aria-label={`Remove field ${field.name || i + 1}`}
              title={fields.length === 1 ? "An app needs at least one field" : "Remove this field"}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="fields-actions">
        <button
          type="button"
          className="regen-btn"
          onClick={() => onChange([...fields, { name: "", required: false }])}
          disabled={fields.length >= MAX_FIELDS}
        >
          Add field
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => onChange(DEFAULT_FIELDS.map((f) => ({ ...f })))}
        >
          Reset to defaults
        </button>
      </div>
      <p className="muted">
        Submissions may only contain these names — anything else is rejected with{" "}
        <code>400 unknown_field</code>, and a missing required one with{" "}
        <code>400 missing_field</code>. Letters, digits, <code>_</code> and{" "}
        <code>-</code> only; up to {MAX_FIELDS} fields.
      </p>
    </div>
  );
}
