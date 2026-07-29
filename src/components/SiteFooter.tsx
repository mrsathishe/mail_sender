import Link from "next/link";
import { BRAND_FULL, CONTACT_EMAIL } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="site-footer-copy">
          © {new Date().getFullYear()} {BRAND_FULL}. All rights reserved.
        </p>
        <p className="site-footer-links">
          <Link href="/docs">API docs</Link>
          <span aria-hidden="true">·</span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </footer>
  );
}
