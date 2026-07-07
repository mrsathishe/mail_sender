import { NextResponse } from "next/server";

// Liveness probe for Docker / Kubernetes.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
