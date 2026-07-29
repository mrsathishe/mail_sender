import { BRAND_FULL } from "@/lib/brand";

// Static asset rather than inline SVG so one copy is cached across every page. The
// designer's raster mark, not a hand-drawn SVG approximation — there is no vector
// source for this artwork (see CLAUDE.md), and a wrong-looking mark in the header is
// worse than a PNG. Plain <img> rather than next/image: it renders at one fixed size
// in the header, so an optimiser round-trip buys nothing.
// alt is empty on purpose: the wordmark next to it already names the brand, so
// announcing it twice is noise for a screen reader.
export function Logo({ height = 34, decorative = true }: { height?: number; decorative?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- fixed-size chrome asset
    <img
      src="/logo-mark.png"
      alt={decorative ? "" : BRAND_FULL}
      // Ratio comes from the file's own pixel size (512×313) — set both dimensions
      // so the header never shifts while the asset loads.
      width={Math.round((height * 512) / 313)}
      height={height}
      className="logo-mark"
    />
  );
}
