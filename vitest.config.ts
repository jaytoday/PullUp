import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    include: ["cli/**/*.test.ts", "src/**/*.test.ts"],
    // One database file per test process.
    env: { PULLUP_DB_FILE: `.data/test-${process.pid}.db`, PULLUP_PERMIT_KEY: "test-permit-key" },
    fileParallelism: false,
  },
});
