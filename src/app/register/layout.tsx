import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/seo";

// The page itself is a client component, and `"use client"` cannot export metadata —
// a route layout is where it belongs instead.
export const metadata = privateMetadata(
  "Create an account",
  "Register a free account to send your website's form submissions to any inbox."
);

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
