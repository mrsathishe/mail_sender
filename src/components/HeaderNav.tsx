"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./LogoutButton";
import { DonateDialog } from "./DonateDialog";

export type NavLink = { href: string; label: string; cta?: boolean };
/** The donate control, as a nav entry. A sentinel rather than a link, so the server keeps
 *  deciding the nav *order* — a button appended after the list would land past the CTA. */
export type NavItem = NavLink | "donate";

/**
 * Whether a nav link points at the page being viewed.
 *
 * `/` matches only itself, because every path starts with it. Everything else also
 * matches its own subtree, so `/admin/users` still marks **Admin** as current. The `/`
 * appended to the prefix is the point: a bare `startsWith("/docs")` would also light up
 * **API docs** on `/docs.md`, which is a markdown file rather than a page.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Client only for the mobile disclosure and the current-page check — the links
// themselves are decided on the server, so the signed-in/out menu never flashes the
// wrong state.
export function HeaderNav({ items, signedIn }: { items: NavItem[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="site-nav"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="nav-toggle-bars" aria-hidden="true" />
        {open ? "Close" : "Menu"}
      </button>

      <nav id="site-nav" className={`site-nav${open ? " open" : ""}`} aria-label="Main">
        {items.map((item) =>
          item === "donate" ? (
            // Deliberately does not collapse the mobile menu the way a link does: this
            // nav is `display: none` while collapsed, and an element under a display:none
            // ancestor generates no box at all — closing the menu would open the dialog
            // into nothing.
            <DonateDialog key="donate" />
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className={item.cta ? "nav-cta" : undefined}
              // The styling hangs off this attribute rather than a class, so a link that
              // looks current is announced as current too — the two cannot drift.
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ),
        )}
        {signedIn && <LogoutButton />}
      </nav>
    </>
  );
}
