import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write agent instruction files into the repository.
  agentRules: false,
  // Browser tests use their own build folder so they can run beside a dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@pullup/engine", "@pullup/github"],
  serverExternalPackages: ["@libsql/client", "libsql", "@anthropic-ai/claude-agent-sdk"],
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*", "./data/**/*", "./src/server/agent/prompt.md"] },
  async headers() {
    return [{ source: "/api/:path*", headers: [{ key: "cache-control", value: "private, no-store" }] }];
  },
};

export default nextConfig;
