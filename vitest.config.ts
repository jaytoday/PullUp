import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    // One database file per test process, demo mode off, and no model keys from the shell.
    env: { PULLUP_DB_FILE: `.data/test-${process.pid}.db`, PULLUP_PERMIT_KEY: "test-permit-key", ANTHROPIC_API_KEY: "" },
    fileParallelism: false,
  },
});
