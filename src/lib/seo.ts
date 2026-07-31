import type { Metadata } from "next";

// Crawl policy for the pages behind the login wall, in one place (SPEC §5b).
//
// `robots.txt` already disallows these paths, but a disallow only asks a crawler not
// to fetch — a page someone links to can still be indexed from the link alone, and
// only a per-page `noindex` prevents that. Every authed and auth-flow page therefore
// carries this, so the policy never rests on one file that is easy to forget.
export function privateMetadata(title: string, description?: string): Metadata {
  return {
    title,
    ...(description ? { description } : {}),
    robots: { index: false, follow: false },
  };
}
