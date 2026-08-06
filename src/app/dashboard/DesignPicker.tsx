"use client";

import { useState } from "react";
import type { TemplateSummary } from "@/lib/templates";

export type Design = TemplateSummary;

// Radio list of the built-in mail designs, each row able to preview itself.
// Designs are fixed — this only ever picks one.
//
// Real <input type="radio"> elements rather than buttons with role="radio": the
// browser then supplies arrow-key navigation, roving focus and the group semantics
// for free, all of which the hand-rolled version was missing. That is also why the
// Preview button is a sibling of the <label> rather than inside it: a control
// nested in a label activates the label's radio, so previewing would silently pick
// the design being looked at.
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
  // Collapsed by default: on a phone a 600px-tall email preview pushes the rest of
  // the form off-screen, and the picker is usable without ever opening it. One id at
  // a time, so comparing two designs never leaves the page metres long.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="design-picker">
      <fieldset className="design-options">
        <legend className="visually-hidden">Mail design</legend>
        {designs.map((d) => {
          const open = openId === d.id;
          const panelId = `${idPrefix}-${d.id}-preview`;
          return (
            <div
              key={d.id}
              className={`design-option-row${d.id === value ? " selected" : ""}`}
            >
              <label className="design-option" htmlFor={`${idPrefix}-${d.id}`}>
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
              <button
                type="button"
                className="design-preview-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : d.id)}
              >
                <span>Preview</span>
                <span className="disclosure" aria-hidden="true">
                  {open ? "−" : "+"}
                </span>
              </button>
              {open && (
                <div id={panelId} className="design-preview-body">
                  <iframe
                    title={`Preview of the ${d.name} mail design`}
                    src={`/api/templates/${d.id}/preview`}
                    // Per-design height (lib/templates.ts): the frame can't measure
                    // its own content under sandbox="", and one shared height
                    // clipped the taller designs behind an inner scrollbar.
                    style={{ height: `${d.previewHeight}px` }}
                    sandbox=""
                    loading="lazy"
                  />
                  <a
                    className="design-preview-open"
                    href={`/api/templates/${d.id}/preview`}
                    target="_blank"
                    rel="noopener"
                  >
                    Open full preview in a new tab
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}
