import type { NextConfig } from "next";

// output: 'standalone' is required by the production Dockerfile — it emits
// .next/standalone/server.js which the runner stage executes.
const nextConfig: NextConfig = {
  output: "standalone",
  // TypeScript 7 is the Go-native compiler and no longer exposes the JS compiler API
  // that Next's built-in type-check step calls, so `next build` aborts with "does not
  // provide the compiler API required by Next.js" without this. The flag makes Next
  // shell out to the `tsc` binary instead. Remove it only alongside a downgrade to
  // TypeScript 6, which still ships the old API.
  experimental: { useTypeScriptCli: true },
};

export default nextConfig;
