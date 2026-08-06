// The form fields an app declares, and strict validation of a submission against
// them (SPEC §4a).
//
// Declaring fields is what turns `/v1/send` from "email me whatever you post" into
// a contract: a leaked key can no longer be used to mail arbitrary content to the
// destination, and the recipient sees the same rows in the same order every time.
// An app that never configures anything gets DEFAULT_FIELDS — the four fields a
// contact form almost always has.
//
// A field is a **pair**: the `id` its form posts and the `name` the email row is
// labelled with. Two values rather than one derived from the other, because a label
// guessed from a key can only ever approximate it — `order-id` reads as "Order id",
// never "Order ID", and no rule turns `company` into "Company name". The owner writes
// the label and it is used verbatim.
//
// There is deliberately **no required flag**. Whether a visitor must fill something in
// is the website's business — its own form does that check, with its own wording, next
// to the input — and an empty value is delivered as empty rather than refused. This
// service's job is to reject fields nobody declared, not to re-litigate a form's UX.

import { titleize } from "./flatten";

export type AppField = {
  /** What the form posts: an HTML `name` / JSON key. */
  id: string;
  /** What the email row is labelled with, and the generated form's `<label>`. */
  name: string;
};

export const DEFAULT_FIELDS: AppField[] = [
  { id: "name", name: "Name" },
  { id: "email", name: "Email" },
  { id: "phone", name: "Phone" },
  { id: "message", name: "Message" },
];

export const MAX_FIELDS = 25;

/**
 * Ids double as HTML `name` attributes and JSON keys, so anything with spaces or
 * punctuation would make the posted body awkward to write by hand. The set is
 * deliberately narrow — the label is where human wording goes.
 */
export const FIELD_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

/** Long enough for a real question ("Where did you hear about us?"), short enough for a row. */
export const MAX_LABEL_LENGTH = 60;

export type FieldsError =
  | "too_many_fields"
  | "no_fields"
  | "invalid_field_id"
  | "invalid_field_label"
  | "duplicate_field"
  | "duplicate_label";

export type ParseFieldsResult =
  | { ok: true; fields: AppField[] }
  | { ok: false; error: FieldsError };

/**
 * Validate a caller-supplied field list. Ids keep the case they were given —
 * `firstName` must stay `firstName` for a JS client — but duplicates are rejected
 * case-insensitively, because two ids differing only in case would be
 * indistinguishable in the email.
 *
 * Labels are rejected for being duplicated too: the email is keyed by label, so two
 * fields sharing one would silently collapse into a single row.
 */
export function parseFields(input: unknown): ParseFieldsResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "no_fields" };
  if (input.length > MAX_FIELDS) return { ok: false, error: "too_many_fields" };

  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const fields: AppField[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_field_id" };
    const { id, name } = raw as { id?: unknown; name?: unknown };

    if (typeof id !== "string") return { ok: false, error: "invalid_field_id" };
    const fieldId = id.trim();
    if (!FIELD_ID_RE.test(fieldId)) return { ok: false, error: "invalid_field_id" };
    const idKey = fieldId.toLowerCase();
    if (seenIds.has(idKey)) return { ok: false, error: "duplicate_field" };

    if (typeof name !== "string") return { ok: false, error: "invalid_field_label" };
    const label = name.trim();
    // A CR/LF would split the plain-text part into a fake row, and a control character
    // has no business in a label at all.
    if (label === "" || label.length > MAX_LABEL_LENGTH || /[\r\n\t]|\p{Cc}/u.test(label)) {
      return { ok: false, error: "invalid_field_label" };
    }
    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) return { ok: false, error: "duplicate_label" };

    seenIds.add(idKey);
    seenLabels.add(labelKey);
    fields.push({ id: fieldId, name: label });
  }
  return { ok: true, fields };
}

/**
 * Drop rows left wholly blank. The editor hands out one empty row at a time, so an
 * untouched one is unused rather than a mistake; a half-filled row survives this and is
 * reported by `firstFieldProblem`.
 */
export function withoutBlankFields(fields: AppField[]): AppField[] {
  return fields.filter((f) => f.id.trim() !== "" || f.name.trim() !== "");
}

/**
 * The client-side pre-flight, expressed as `parseFields` itself rather than as a second
 * copy of its rules: a mirror written out by hand is one that drifts, and drift here reads
 * as our bug — the dashboard would accept a list the API then refuses. Callers map the
 * returned code through their own wording.
 */
export function firstFieldProblem(fields: AppField[]): FieldsError | null {
  const result = parseFields(fields);
  return result.ok ? null : result.error;
}

/**
 * Apps stored before fields existed, or a `.lean()` read that skipped defaults.
 *
 * Also the read side of the id/label split: a document written when a field was
 * `{ name, required }` reads back as `{ id: <that name>, name: titleize(<that name>) }`,
 * which is exactly what scripts/migrate-app-field-ids.mjs writes — so an app whose
 * migration hasn't run yet keeps working instead of losing its contract.
 */
export function resolveFields(value: unknown): AppField[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_FIELDS;
  const fields = value
    .filter((f): f is { id?: unknown; name?: unknown } => Boolean(f) && typeof f === "object")
    .map((f) => {
      const id = typeof f.id === "string" && f.id.trim() !== "" ? f.id : null;
      const name = typeof f.name === "string" && f.name.trim() !== "" ? f.name : null;
      // Legacy row: the old `name` was the posted key, and the label was derived from it.
      if (!id) return name ? { id: name, name: titleize(name) } : null;
      return { id, name: name ?? titleize(id) };
    })
    .filter((f): f is AppField => f !== null);
  return fields.length > 0 ? fields : DEFAULT_FIELDS;
}

export type SubmissionError = { error: "unknown_field"; field: string };

export type ValidateResult = { ok: true } | ({ ok: false } & SubmissionError);

// Matched case-insensitively so a client that posts `Email` still lands on the
// declared `email` — the alternative is a 400 that reads like a bug to whoever
// wired the form up.
function declaredIds(fields: AppField[]): Set<string> {
  return new Set(fields.map((f) => f.id.toLowerCase()));
}

/**
 * Strict check of a submission against the app's declared fields: any field that
 * wasn't declared is refused. Nothing is mandatory — an absent or empty value is a
 * legitimate submission and renders as `—`, because the form that collected it is the
 * only thing that knows whether it mattered.
 */
export function validateSubmission(
  fields: AppField[],
  data: Record<string, unknown>
): ValidateResult {
  const declared = declaredIds(fields);
  for (const key of Object.keys(data)) {
    if (!declared.has(key.toLowerCase())) return { ok: false, error: "unknown_field", field: key };
  }
  return { ok: true };
}

/**
 * Rebuild the submission in the app's declared order, **keyed by each field's label** —
 * which is what makes an email row read as the owner wrote it, with nothing guessing at
 * wording. Only reached after `validateSubmission`, so every posted key is declared.
 * Fields the client omitted are still emitted (as an empty value, which renders as
 * "—"), so the destination inbox gets the same rows in the same order on every mail —
 * a field that only sometimes appeared would otherwise shift the whole layout.
 */
export function orderSubmission(
  fields: AppField[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const present = new Map(Object.keys(data).map((k) => [k.toLowerCase(), k]));
  const ordered: Record<string, unknown> = {};
  for (const field of fields) {
    const key = present.get(field.id.toLowerCase());
    ordered[field.name] = key === undefined ? "" : data[key];
  }
  return ordered;
}
