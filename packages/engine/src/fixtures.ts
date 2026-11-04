import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ciRunSchema, type ParsedCiRun } from "./ci";
import { configSchema, type Config, TRIGGER_IDS } from "./config";

/**
 * Recorded CI results and diffs for offline tests and `pullup check --fixture`.
 * Each file holds the repo's config, the collected run and what should happen.
 */
const fixtureSchema = z.object({
  description: z.string(),
  config: configSchema,
  run: ciRunSchema,
  expect: z.object({ hardFailure: z.boolean(), triggers: z.array(z.enum(TRIGGER_IDS)) }),
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
