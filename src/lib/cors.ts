// Cross-origin access for the public send endpoint.
//
// Customers are frontend projects with no backend of their own: their React form
// calls /api/v1/send straight from the visitor's browser. That makes the request
// cross-origin, so the browser asks permission first (a preflight) and refuses to
// hand the response to the page unless the allowance is repeated on the reply.
//
// Origins are unrestricted on purpose. CORS only ever restrained browsers — curl
// and any script ignore it entirely — so an allowlist would buy no protection
// while breaking every customer who adds a staging domain. The controls that do
// something are the key, the field contract (fields.ts), destination verification
// and the volume guard (HARDENING_ROADMAP §1.2).

import { NextResponse } from "next/server";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  // These two are *why* a browser preflights at all: `authorization` is never
  // safelisted, and `application/json` is not a safelisted content type either.
  "access-control-allow-headers": "authorization, content-type",
  // Cache the preflight for a day, so a form that submits repeatedly costs one
  // extra round trip rather than one per submission.
  "access-control-max-age": "86400",
};

/**
 * JSON reply carrying the CORS headers. Every return path of a browser-callable
 * route must use this, including the failures: a response without the header is
 * unreadable to the page, which turns `{ error: "missing_field", field: "email" }`
 * into an opaque "CORS error" precisely when the developer needs the field name.
 */
export function corsJson(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: CORS_HEADERS });
}

/** Preflight answer — 204 with no body, since the headers are the whole reply. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
