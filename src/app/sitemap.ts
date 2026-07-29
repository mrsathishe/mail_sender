import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

// Only the two pages that are meant to be indexed. Everything else is either
// behind the login wall or a redirect target, and robots.ts disallows it.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.appUrl.replace(/\/$/, "");
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
