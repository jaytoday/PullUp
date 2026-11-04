import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write agent instruction files into the repository.
  agentRules: false,
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@pullup/engine", "@pullup/github", "@withai/client"],
  serverExternalPackages: ["@libsql/client", "libsql"],
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  async headers() {
    return [{ source: "/api/:path*", headers: [{ key: "cache-control", value: "private, no-store" }] }];
  },
};

export default nextConfig;
