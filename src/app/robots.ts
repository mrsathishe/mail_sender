import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

// Without this file there is no crawl policy at all. The landing page and docs are
// meant to be read (including by AI fetchers, which check robots.txt even for
// user-initiated fetches); the authed areas and the API are not worth crawling.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs", "/docs.md", "/llms.txt"],
        disallow: [
          "/api/",
          "/dashboard",
          "/admin",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
        ],
      },
    ],
    sitemap: `${env.appUrl.replace(/\/$/, "")}/sitemap.xml`,
  };
}
