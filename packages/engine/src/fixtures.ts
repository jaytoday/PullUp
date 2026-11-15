import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ciRunSchema, type ParsedCiRun } from "./ci";
import { CONCERNS, configSchema, type Config } from "./config";

/**
 * Recorded CI results and diffs for offline tests. Each file holds the
 * repository's config, the collected run and what should happen.
 */
const fixtureSchema = z.object({
  description: z.string(),
  config: configSchema,
  run: ciRunSchema,
  expect: z.object({ hardFailure: z.boolean(), concerns: z.array(z.enum(CONCERNS)) }),
});

export interface Fixture {
  name: string;
  description: string;
  config: Config;
  run: ParsedCiRun;
  expect: z.infer<typeof fixtureSchema>["expect"];
}

export function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f.replace(/\.json$/, ""), ...fixtureSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))) }));
}
