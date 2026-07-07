import type { NextConfig } from "next";

// output: 'standalone' is required by the production Dockerfile — it emits
// .next/standalone/server.js which the runner stage executes.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
