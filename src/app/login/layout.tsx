import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/seo";

// The page itself is a client component, and `"use client"` cannot export metadata —
// a route layout is where it belongs instead.
export const metadata = privateMetadata(
  "Sign in",
  "Sign in to manage the websites sending form submissions through Mailer by satz."
);

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
