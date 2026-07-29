import { headers } from "next/headers";
import { baseUrlFrom } from "@/lib/base-url";
import { llmsTxt } from "@/lib/api-docs";

// The /llms.txt convention: a short index AI clients look for when given the
// bare domain, pointing at the full markdown at /docs.md.
export const dynamic = "force-dynamic";

export async function GET() {
  const body = llmsTxt(baseUrlFrom(await headers()));
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
