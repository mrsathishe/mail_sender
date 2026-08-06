import { handleSend } from "@/lib/send-endpoint";
import { corsPreflight } from "@/lib/cors";

// Must run on the Node.js runtime — Nodemailer opens an SMTP socket, which the
// Edge runtime cannot do (SPEC §6).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customers' forms post from the browser, so the endpoint has to answer the
// preflight before any POST is even attempted (cors.ts).
export function OPTIONS() {
  return corsPreflight();
}

// The one public send endpoint, for JSON and multipart alike. The pipeline is in
// lib/send-endpoint.ts — see the note there for why the 5MB upload allowance is keyed off
// the app's own `attachments.enabled` rather than off a second route.
export function POST(req: Request) {
  return handleSend(req);
}
