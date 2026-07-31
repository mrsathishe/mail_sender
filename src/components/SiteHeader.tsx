import Link from "next/link";
import { getSession } from "@/lib/auth";
import { BRAND_NAME, BRAND_SUFFIX, BRAND_FULL } from "@/lib/brand";
import { Logo } from "./Logo";
import { HeaderNav, type NavLink } from "./HeaderNav";

// One header for every page, so nav lives in a single place instead of being
// re-declared by each area's own `.topbar`. Reading the session here makes every
// route render dynamically, which they effectively already did — the whole app is
// per-request behind `next start`.
export async function SiteHeader() {
  const session = await getSession();

  const links: NavLink[] = session
    ? [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/docs", label: "API docs" },
        { href: "/contact", label: "Contact" },
        ...(session.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [
        // Home only for signed-out visitors: `/` redirects a session straight to
        // `/dashboard`, so the link would be a dead end for anyone signed in.
        { href: "/", label: "Home" },
        { href: "/docs", label: "API docs" },
        { href: "/contact", label: "Contact" },
        { href: "/login", label: "Sign in" },
        { href: "/register", label: "Get started", cta: true },
      ];

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href={session ? "/dashboard" : "/"} className="brand" aria-label={`${BRAND_FULL} — home`}>
          <Logo height={34} />
          <span className="brand-text">
            <span className="brand-name">{BRAND_NAME}</span>
            <span className="brand-suffix">{BRAND_SUFFIX}</span>
          </span>
        </Link>
        <HeaderNav links={links} signedIn={Boolean(session)} />
      </div>
    </header>
  );
}
