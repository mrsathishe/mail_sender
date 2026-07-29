// Request-size limit for the public send endpoint (HARDENING_ROADMAP §1.3).
//
// App Router handlers have no default body cap, so `req.json()` / `req.formData()`
// will happily buffer a 500MB POST before any of our code runs.
//
// Only the **total** byte count is capped. A per-field cap was considered and
// rejected: it bounds nothing, because N fields at the maximum simply multiply
// (4 × 2MB = 8MB). With a total cap, one field may legitimately be the whole
// submission — a long message body is exactly that.

/** The one knob. Everything else here is a crash guard, not a size limit. */
export const MAX_BODY_BYTES = 500 * 1024; // 500KB

/**
 * Nesting depth is capped for a different reason: flatten.ts walks values
 * recursively, and `JSON.parse` accepts far deeper input than that recursion
 * survives — `"[".repeat(5000)` is a 10KB body that parses fine and then throws
 * RangeError while rendering. Size limits cannot catch this, so depth is checked
 * separately.
 */
export const MAX_DEPTH = 5;

export type BodyError = "payload_too_large" | "empty_or_invalid_body" | "body_too_deep";

export type ReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: BodyError };

/**
 * True when the declared `content-length` already exceeds the cap — a shortcut so
 * an obvious flood is refused without a DB round trip. Only ever a hint: the header
 * is client-controlled and absent under chunked encoding, so `readLimitedBody`
 * counts the bytes actually received.
 */
export function declaredTooLarge(headers: Headers): boolean {
  const raw = headers.get("content-length");
  if (!raw) return false;
  const declared = Number(raw);
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

async function readBytes(req: Request): Promise<Uint8Array | "too_large" | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Abort mid-stream rather than after buffering — this is what makes the cap
      // real, since content-length cannot be trusted.
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    return null; // client aborted, or a malformed stream
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function tooDeep(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => tooDeep(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => tooDeep(v, depth + 1));
  }
  return false;
}

/**
 * Read a submission body under the cap. Accepts JSON or a form post; files are
 * still skipped (SPEC §8), and are why the multipart branch re-wraps the
 * already-counted bytes in a `Response` instead of calling `req.formData()`, which
 * would buffer without a limit.
 */
export async function readLimitedBody(req: Request): Promise<ReadResult> {
  if (declaredTooLarge(req.headers)) return { ok: false, error: "payload_too_large" };

  const bytes = await readBytes(req);
  if (bytes === "too_large") return { ok: false, error: "payload_too_large" };
  if (!bytes || bytes.byteLength === 0) return { ok: false, error: "empty_or_invalid_body" };

  const type = req.headers.get("content-type") || "";
  let data: Record<string, unknown> | null = null;
  try {
    if (type.includes("application/json")) {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      data = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } else if (type.includes("form")) {
      // Re-wrapping the counted bytes gets us undici's multipart parser without
      // req.formData()'s unbounded buffering. `.buffer` is exact here: readBytes
      // allocates the Uint8Array at the final size with no offset (TS's BodyInit
      // won't take a Uint8Array directly since its element type became generic).
      const body = bytes.buffer as ArrayBuffer;
      const form = await new Response(body, { headers: { "content-type": type } }).formData();
      const out: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") out[key] = value; // files deferred (SPEC §8)
      }
      data = out;
    }
  } catch {
    // Includes JSON.parse hitting its own recursion limit on absurd nesting.
    return { ok: false, error: "empty_or_invalid_body" };
  }

  if (!data || Object.keys(data).length === 0) {
    return { ok: false, error: "empty_or_invalid_body" };
  }
  if (tooDeep(data, 0)) return { ok: false, error: "body_too_deep" };

  return { ok: true, data };
}
