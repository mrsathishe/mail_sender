import type { Metadata, Viewport } from "next";
import "./globals.css";
import { env } from "@/lib/env";
import { BRAND_FULL, BRAND_TAGLINE, BRAND_COLORS } from "@/lib/brand";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

// metadataBase turns every relative `openGraph.url` / canonical below into an
// absolute one. `env.appUrl` is a lazy getter with a localhost default, so this
// stays safe to evaluate during the build.
export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: `${BRAND_FULL} — form-to-email API for any website`,
    template: `%s · ${BRAND_FULL}`,
  },
  description: BRAND_TAGLINE,
  applicationName: BRAND_FULL,
  keywords: [
    "contact form to email",
    "form submission API",
    "form backend",
    "static site contact form",
    "email API",
    "form to email service",
    "HTML form email",
  ],
  authors: [{ name: "satz" }],
  creator: "satz",
  openGraph: {
    type: "website",
    siteName: BRAND_FULL,
    title: `${BRAND_FULL} — form-to-email API for any website`,
    description: BRAND_TAGLINE,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_FULL} — form-to-email API for any website`,
    description: BRAND_TAGLINE,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_COLORS.cream },
    { media: "(prefers-color-scheme: dark)", color: BRAND_COLORS.black },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* First focusable element on every page: keyboard users can jump past the
            header instead of tabbing the whole nav on each navigation. */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
