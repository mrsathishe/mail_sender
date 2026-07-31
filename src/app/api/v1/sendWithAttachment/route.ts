import { handleSend } from "@/lib/send-endpoint";
import { corsPreflight } from "@/lib/cors";

// Same runtime pin as /api/v1/send: Nodemailer opens an SMTP socket, which the Edge
// runtime cannot do (SPEC §6).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

// Same pipeline as /api/v1/send, with file parts kept and the total body cap raised to
// ATTACHMENT_MAX_TOTAL_BYTES — but only for an app whose owner switched attachments on.
// A separate path rather than a flag on the existing one because nginx's
// client_max_body_size is per-location: this is the only route the edge lets past 1m,
// so an integration that posts JSON keeps the cheaper guard in front of it.
export function POST(req: Request) {
  return handleSend(req, { attachments: true });
}
