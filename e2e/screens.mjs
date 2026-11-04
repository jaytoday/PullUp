// Screenshots of every page in light and dark mode at desktop and phone widths, signed in.
//   node e2e/screens.mjs [outDir]   (server on PULLUP_E2E_URL or http://localhost:3500; run `pnpm seed` first)
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.PULLUP_E2E_URL ?? "http://localhost:3500";
const out = process.argv[2] ?? ".data/screens";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];

async function signedIn(viewport, colorScheme) {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
  await page.goto(`${base}/login`);
  await page.fill("#email", "owner@example.com");
  await page.fill("#password", "pullup-dev-password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/overview/);
  return { context, page };
}

const sizes = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };
for (const [sizeName, viewport] of Object.entries(sizes)) {
  for (const scheme of ["light", "dark"]) {
    const { context, page } = await signedIn(viewport, scheme);
    const firstRun = async () => (await page.goto(`${base}/runs`), page.locator('a[href^="/runs/"]').first().getAttribute("href"));
    const paths = ["/", "/overview", "/runs", "/questions", "/accuracy", "/settings", await firstRun()];
    for (const path of paths) {
      await page.goto(`${base}${path}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) problems.push(`${path} scrolls sideways at ${sizeName}`);
      await page.screenshot({ path: `${out}/${sizeName}-${scheme}-${path.replace(/\//g, "_") || "_"}.png`, fullPage: true });
    }
    await context.close();
  }
}
await browser.close();
console.log(problems.length ? `Problems:\n${[...new Set(problems)].join("\n")}` : "No problems found.");
process.exit(problems.length ? 1 : 0);
