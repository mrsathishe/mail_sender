// The form fields an app declares, and strict validation of a submission against
// them (SPEC §4a).
//
// Declaring fields is what turns `/v1/send` from "email me whatever you post" into
// a contract: a leaked key can no longer be used to mail arbitrary content to the
// destination, and the recipient sees the same rows in the same order every time.
// An app that never configures anything gets DEFAULT_FIELDS — the four fields a
// contact form almost always has.

export type AppField = { name: string; required: boolean };

export const DEFAULT_FIELDS: AppField[] = [
  { name: "name", required: true },
  { name: "email", required: true },
  { name: "phone", required: false },
  { name: "message", required: true },
];

export const MAX_FIELDS = 25;

/**
 * Field names double as HTML `name` attributes and as email row labels (via
 * flatten's titleize, so `phone_number` reads as "Phone number"). Anything with
 * spaces or punctuation would make the posted JSON awkward to write by hand, so
 * the set is deliberately narrow.
 */
export const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export type FieldsError =
  | "too_many_fields"
  | "no_fields"
  | "invalid_field_name"
  | "duplicate_field";

export type ParseFieldsResult =
  | { ok: true; fields: AppField[] }
  | { ok: false; error: FieldsError };

/**
 * Validate a caller-supplied field list. Names keep the case they were given —
 * `firstName` must stay `firstName` for a JS client — but duplicates are rejected
 * case-insensitively, because two fields differing only in case would be
 * indistinguishable in the email.
 */
export function parseFields(input: unknown): ParseFieldsResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "no_fields" };
  if (input.length > MAX_FIELDS) return { ok: false, error: "too_many_fields" };

  const seen = new Set<string>();
  const fields: AppField[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_field_name" };
    const { name, required } = raw as { name?: unknown; required?: unknown };
    if (typeof name !== "string") return { ok: false, error: "invalid_field_name" };
    const trimmed = name.trim();
    if (!FIELD_NAME_RE.test(trimmed)) return { ok: false, error: "invalid_field_name" };
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return { ok: false, error: "duplicate_field" };
    seen.add(key);
    fields.push({ name: trimmed, required: Boolean(required) });
  }
  return { ok: true, fields };
}

/** Apps stored before fields existed, or a `.lean()` read that skipped defaults. */
export function resolveFields(value: unknown): AppField[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_FIELDS;
  const fields = value
    .filter((f): f is { name: unknown; required?: unknown } => Boolean(f) && typeof f === "object")
    .filter((f) => typeof f.name === "string" && f.name.length > 0)
    .map((f) => ({ name: f.name as string, required: Boolean(f.required) }));
  return fields.length > 0 ? fields : DEFAULT_FIELDS;
}

export type SubmissionError =
  | { error: "unknown_field"; field: string }
  | { error: "missing_field"; field: string };

export type ValidateResult = { ok: true } | ({ ok: false } & SubmissionError);

// Matched case-insensitively so a client that posts `Email` still lands on the
// declared `email` — the alternative is a 400 that reads like a bug to whoever
// wired the form up.
function indexByLowerName(fields: AppField[]): Map<string, AppField> {
  return new Map(fields.map((f) => [f.name.toLowerCase(), f]));
}

/**
 * Strict check of a submission against the app's declared fields: any field that
 * wasn't declared is refused, and every required one must arrive with a non-empty
 * value. An optional field may be absent or empty.
 */
export function validateSubmission(
  fields: AppField[],
  data: Record<string, unknown>
): ValidateResult {
  const declared = indexByLowerName(fields);

  for (const key of Object.keys(data)) {
    if (!declared.has(key.toLowerCase())) return { ok: false, error: "unknown_field", field: key };
  }

  const present = new Map(Object.keys(data).map((k) => [k.toLowerCase(), k]));
  for (const field of fields) {
    if (!field.required) continue;
    const key = present.get(field.name.toLowerCase());
    if (key === undefined || isEmpty(data[key])) {
      return { ok: false, error: "missing_field", field: field.name };
    }
  }
  return { ok: true };
}

// "Provided but blank" is the same failure as "absent" for a required field —
// an empty string is what an unfilled input actually posts.
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Rebuild the submission in the app's declared order, under the declared spelling
 * of each name. Only reached after `validateSubmission`, so every posted key is
 * declared. Fields the client omitted are still emitted (as an empty value, which
 * renders as "—"), so the destination inbox gets the same rows in the same order
 * on every mail — an optional field that only sometimes appears would otherwise
 * shift the whole layout.
 */
export function orderSubmission(
  fields: AppField[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const present = new Map(Object.keys(data).map((k) => [k.toLowerCase(), k]));
  const ordered: Record<string, unknown> = {};
  for (const field of fields) {
    const key = present.get(field.name.toLowerCase());
    ordered[field.name] = key === undefined ? "" : data[key];
  }
  return ordered;
}
