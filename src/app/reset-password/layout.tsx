import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/seo";

// The page itself is a client component, and `"use client"` cannot export metadata —
// a route layout is where it belongs instead.
export const metadata = privateMetadata(
  "Choose a new password",
  "Set a new password for your Mailer by satz account."
);

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
