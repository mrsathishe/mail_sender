"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export type NavLink = { href: string; label: string; cta?: boolean };

// Client only for the mobile disclosure — the links themselves are decided on the
// server, so the signed-in/out menu never flashes the wrong state.
export function HeaderNav({ links, signedIn }: { links: NavLink[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);

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
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={link.cta ? "nav-cta" : undefined}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </Link>
        ))}
        {signedIn && <LogoutButton />}
      </nav>
    </>
  );
}
