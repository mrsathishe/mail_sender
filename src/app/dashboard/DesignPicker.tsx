"use client";

export type Design = { id: string; name: string; description: string };

// Radio-card list of the built-in mail designs plus a live preview of the
// selected one. Designs are fixed — this only ever picks one.
export function DesignPicker({
  designs,
  value,
  onChange,
  idPrefix,
}: {
  designs: Design[];
  value: string;
  onChange: (id: string) => void;
  idPrefix: string;
}) {
  const selected = designs.find((d) => d.id === value) ?? designs[0];

  return (
    <div className="design-picker">
      <div className="design-options" role="radiogroup" aria-label="Mail design">
        {designs.map((d) => (
          <button
            key={d.id}
            id={`${idPrefix}-${d.id}`}
            type="button"
            role="radio"
            aria-checked={d.id === value}
            className={`design-option${d.id === value ? " selected" : ""}`}
            onClick={() => onChange(d.id)}
          >
            <span className="design-name">{d.name}</span>
            <span className="design-desc">{d.description}</span>
          </button>
        ))}
      </div>

      <div className="design-preview">
        <span className="design-preview-label">Preview — {selected.name}</span>
        <iframe
          title={`Preview of the ${selected.name} mail design`}
          src={`/api/templates/${selected.id}/preview`}
          sandbox=""
        />
      </div>
    </div>
  );
}
