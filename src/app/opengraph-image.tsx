import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_NAME, BRAND_SUFFIX, BRAND_TAGLINE, BRAND_COLORS } from "@/lib/brand";

// The card link previews show. Still generated rather than a static 1200×630 file so
// the tagline comes from brand.ts and cannot drift, but the logo is now the real
// lockup PNG instead of a palette stand-in.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${BRAND_NAME} ${BRAND_SUFFIX} — ${BRAND_TAGLINE}`;

// Read off disk, not fetched: satori needs the bytes, and both deploy paths have
// `public/` beside the server (the VPS runs from the clone, and the Dockerfile copies
// it into the standalone image).
async function lockupDataUri() {
  const png = await readFile(join(process.cwd(), "public", "logo-lockup.png"));
  return `data:image/png;base64,${png.toString("base64")}`;
}

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: "64px",
          padding: "72px 80px",
          background: BRAND_COLORS.black,
          borderTop: `16px solid ${BRAND_COLORS.gold}`,
          borderBottom: `16px solid ${BRAND_COLORS.red}`,
        }}
      >
        {/* White plate behind the lockup, not the card's black directly: the
            envelope's fold lines are transparent holes in the artwork, so on a dark
            background they paint dark and the envelope stops reading as an envelope. */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            padding: "26px",
            borderRadius: "28px",
            background: "#ffffff",
          }}
        >
          {/* 1035×950 source; satori requires both dimensions and will not infer them. */}
          <img src={await lockupDataUri()} width={318} height={292} alt="" />
        </div>
        {/* `flexBasis: 0` + `flexGrow: 1` is what makes the tagline wrap instead of
            running off the card: sized from the space left over (1040 content − 370 plate
            − 64 gap), not from the text's own unwrapped width. Without it satori measures
            the string at full width and clips at the right edge — `minWidth: 0` is the
            other half, since a flex item otherwise refuses to shrink below its
            min-content. */}
        <div
          style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: "20px" }}>
            <div style={{ fontSize: 96, fontWeight: 700, color: BRAND_COLORS.goldLight }}>
              {BRAND_NAME}
            </div>
            <div
              style={{ fontSize: 40, fontWeight: 600, color: BRAND_COLORS.red, paddingBottom: 18 }}
            >
              {BRAND_SUFFIX}
            </div>
          </div>
          <div style={{ marginTop: 24, fontSize: 34, lineHeight: 1.35, color: "#f4f4f4" }}>
            {BRAND_TAGLINE}
          </div>
        </div>
      </div>
    ),
    size
  );
}
