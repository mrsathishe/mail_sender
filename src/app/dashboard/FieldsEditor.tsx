"use client";

import { DEFAULT_FIELDS, MAX_FIELDS, MAX_LABEL_LENGTH, type AppField } from "@/lib/fields";

// The submission contract for one app: the id each field posts, and the label its row
// carries in the email. Both are validated again on the server (lib/fields) — the
// `pattern` here only spares the user a round trip.
//
// There is no "required" control: whether a visitor must fill something in is the
// website's own check, and an empty value is delivered as empty. A new app arrives here
// pre-populated with DEFAULT_FIELDS — a starting point to edit and save, not a fixed list.
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

  // One blank row at a time: a second would leave the user two empty pairs of inputs to
  // work out, and a half-filled row is an error on save rather than an unused one.
  const hasIncompleteRow = fields.some((f) => f.id.trim() === "" || f.name.trim() === "");

  return (
    <div className="fields-editor">
      <ul className="field-rows">
        <li className="field-row field-row-head" aria-hidden="true">
          <span>Field id — what your form posts</span>
          <span>Label — what the email shows</span>
        </li>
        {fields.map((field, i) => (
          <li className="field-row" key={i}>
            <div className="field-row-id">
              <label className="visually-hidden" htmlFor={`${idPrefix}-id-${i}`}>
                Field {i + 1} id
              </label>
              <input
                id={`${idPrefix}-id-${i}`}
                type="text"
                value={field.id}
                onChange={(e) => update(i, { id: e.target.value })}
                placeholder="company"
                pattern="[A-Za-z][A-Za-z0-9_\-]*"
                maxLength={40}
                required
                spellCheck={false}
                autoCapitalize="none"
              />
            </div>
            <div className="field-row-label">
              <label className="visually-hidden" htmlFor={`${idPrefix}-label-${i}`}>
                Field {i + 1} label
              </label>
              <input
                id={`${idPrefix}-label-${i}`}
                type="text"
                value={field.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Company Name"
                maxLength={MAX_LABEL_LENGTH}
                required
              />
            </div>
            <button
              type="button"
              className="field-remove"
              onClick={() => onChange(fields.filter((_, j) => j !== i))}
              disabled={fields.length === 1}
              aria-label={`Remove field ${field.id || i + 1}`}
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
          onClick={() => onChange([...fields, { id: "", name: "" }])}
          disabled={fields.length >= MAX_FIELDS || hasIncompleteRow}
          title={
            fields.length >= MAX_FIELDS
              ? `An app can have at most ${MAX_FIELDS} fields`
              : hasIncompleteRow
                ? "Fill in the empty field first"
                : "Add another field"
          }
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
        Submissions may only contain these ids — anything else is rejected with{" "}
        <code>400 unknown_field</code>. An id must start with a letter and use only
        letters, digits, <code>_</code> or <code>-</code>; a label is free text up to{" "}
        {MAX_LABEL_LENGTH} characters. Up to {MAX_FIELDS} fields. Nothing is mandatory
        here — your own form decides that, and a field that arrives empty is delivered as{" "}
        <code>—</code>.
      </p>
    </div>
  );
}
