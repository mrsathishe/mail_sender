"use client";

import { useState } from "react";
import type { TemplateSummary } from "@/lib/templates";

export type Design = TemplateSummary;

// Radio list of the built-in mail designs plus a preview of the selected one.
// Designs are fixed — this only ever picks one.
//
// Real <input type="radio"> elements rather than buttons with role="radio": the
// browser then supplies arrow-key navigation, roving focus and the group semantics
// for free, all of which the hand-rolled version was missing.
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
  // Collapsed by default: on a phone a 600px-tall email preview pushes the rest of
  // the form off-screen, and the picker is usable without ever opening it.
  const [open, setOpen] = useState(false);
  const panelId = `${idPrefix}-preview`;

  return (
    <div className="design-picker">
      <fieldset className="design-options">
        <legend className="visually-hidden">Mail design</legend>
        {designs.map((d) => (
          <label
            key={d.id}
            className={`design-option${d.id === value ? " selected" : ""}`}
            htmlFor={`${idPrefix}-${d.id}`}
          >
            <input
              id={`${idPrefix}-${d.id}`}
              type="radio"
              name={idPrefix}
              value={d.id}
              checked={d.id === value}
              onChange={() => onChange(d.id)}
            />
            <span>
              <span className="design-name">{d.name}</span>
              <span className="design-desc">{d.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="design-preview">
        <button
          type="button"
          className="design-preview-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>Preview — {selected.name}</span>
          <span className="disclosure" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        </button>
        {open && (
          <div id={panelId} className="design-preview-body">
            <iframe
              title={`Preview of the ${selected.name} mail design`}
              src={`/api/templates/${selected.id}/preview`}
              // Per-design height (lib/templates.ts): the frame can't measure its
              // own content under sandbox="", and one shared height clipped the
              // taller designs behind an inner scrollbar.
              style={{ height: `${selected.previewHeight}px` }}
              sandbox=""
              loading="lazy"
            />
            <a
              className="design-preview-open"
              href={`/api/templates/${selected.id}/preview`}
              target="_blank"
              rel="noopener"
            >
              Open full preview in a new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
