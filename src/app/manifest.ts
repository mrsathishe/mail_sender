import type { MetadataRoute } from "next";
import { BRAND_FULL, BRAND_NAME, BRAND_TAGLINE, BRAND_COLORS } from "@/lib/brand";

// Makes "add to home screen" on a phone produce a named, branded icon instead of
// a screenshot titled with the URL.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_FULL,
    short_name: BRAND_NAME,
    description: BRAND_TAGLINE,
    start_url: "/dashboard",
    display: "standalone",
    background_color: BRAND_COLORS.cream,
    theme_color: BRAND_COLORS.black,
    icons: [
      // The real mark on a white plate. There is no SVG of this artwork — see
      // CLAUDE.md — and its envelope fold lines are transparent holes, so the plate
      // is what stops a launcher's dark tile from swallowing them.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
