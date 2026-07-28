import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isTemplateId, renderEmailHtml, PREVIEW_DATA } from "@/lib/templates";

export const runtime = "nodejs";

// GET /api/templates/[id]/preview — the given design rendered with fixed sample
// data, as raw HTML for the dashboard picker's <iframe>. Signed-in users only;
// nothing here is user-specific, so there is no per-app authorisation to do.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!isTemplateId(id)) {
    return NextResponse.json({ error: "unknown_template" }, { status: 404 });
  }

  const html = renderEmailHtml(id, PREVIEW_DATA, {
    websiteName: "Your website",
    // Fixed date so the preview is deterministic (and cacheable by the browser).
    receivedAt: new Date(Date.UTC(2026, 0, 15, 9, 30)),
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The preview is a self-contained email document: no scripts, no network.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
