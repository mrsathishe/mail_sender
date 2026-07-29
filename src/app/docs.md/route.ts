import { headers } from "next/headers";
import { baseUrlFrom } from "@/lib/base-url";
import { docsMarkdown } from "@/lib/api-docs";

// Plain-markdown mirror of /docs. AI agents and scripts read this far more
// reliably than the HTML page, and it is generated from the same source
// (src/lib/api-docs.ts) so the two cannot drift.
export const dynamic = "force-dynamic";

export async function GET() {
  const body = docsMarkdown(baseUrlFrom(await headers()));
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
