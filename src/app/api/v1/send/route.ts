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

// The pipeline itself is in lib/send-endpoint.ts, shared with
// /api/v1/sendWithAttachment — see the note there for why it is one implementation
// rather than two. This endpoint takes no files and keeps the 500KB body cap.
export function POST(req: Request) {
  return handleSend(req, { attachments: false });
}
