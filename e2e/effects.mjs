/**
 * Checks the animated effects on /dev/effects and where they are used, with motion allowed and with
 * reduced motion (the operating system setting). Fails on any page or console error.
 *
 *   node e2e/effects.mjs   (dev server on PULLUP_E2E_URL or http://localhost:3500; `pnpm seed` first)
 */
import { chromium } from "playwright";

const base = process.env.PULLUP_E2E_URL ?? "http://localhost:3500";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
const check = (ok, text) => {
  if (!ok) throw new Error(`Failed: ${text}`);
  console.log(`• ${text}`);
};
const text = (id) => page.getByTestId(id).textContent();

await page.goto(`${base}/login`);
await page.fill("#email", "owner@example.com");
await page.fill("#password", "pullup-dev-password");
await page.click("button[type=submit]");
await page.waitForURL(/\/overview/);

// Motion allowed.
await page.goto(`${base}/dev/effects`);
await page.waitForFunction(() => document.querySelector('[data-testid="ticker-value"]')?.textContent === "12");
check(true, "number ticker counts to its value");
check((await page.locator('[data-effect="border-beam"]').count()) === 1, "border beam runs");
await page.waitForFunction(() => document.querySelector('[data-effect="dot-grid"] canvas'), null, { timeout: 10_000 });
check(true, "the hero's dot grid (WebGL) draws");
check((await page.locator('[data-effect="spotlight"]').count()) === 1, "spotlight shows");
await page.getByRole("button", { name: "Add a run" }).click();
check((await page.getByTestId("animated-list").getByRole("listitem").count()) === 3, "animated list adds a run");
await page.waitForFunction(() => document.querySelector('[data-testid="decrypted"]')?.textContent?.includes("CI that knows when to ask"), null, { timeout: 8000 });
check(true, "decrypted text settles on the headline");
await page.getByTestId("count-up-value").scrollIntoViewIfNeeded();
await page.waitForFunction(() => document.querySelector('[data-testid="count-up-value"]')?.textContent?.includes("87"), null, { timeout: 8000 });
check(true, "count-up reaches 87");
await page.getByRole("button", { name: "Answer pass" }).click();
check((await page.locator('[data-effect="status-mark"][data-outcome="pass"]').count()) === 1, "status mark turns to done");

// Reduced motion.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(`${base}/dev/effects`);
await page.getByTestId("count-up-value").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
check((await text("ticker-value")) === "12", "reduced motion: number shows its final value at once");
check((await text("count-up-value"))?.includes("87"), "reduced motion: count-up shows 87 at once");
check((await text("decrypted"))?.includes("CI that knows when to ask"), "reduced motion: headline is plain text at once");
check((await page.locator('[data-effect="border-beam"]').count()) === 0, "reduced motion: no border beam");
check((await page.locator('[data-effect="dot-grid"]').count()) === 0, "reduced motion: still dot pattern instead of WebGL");
check((await page.locator('[data-effect="spotlight"]').count()) === 0, "reduced motion: no moving spotlight");
check((await page.locator('[data-effect="animated-beam"] [stroke^="url"]').count()) === 0, "reduced motion: beam path without the moving light");

// Where they are used.
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.goto(`${base}/`);
check((await page.getByTestId("flow-beams").count()) === 1, "landing page shows the flow");
await page.goto(`${base}/setup`);
check((await page.getByTestId("setup-wizard").count()) === 1, "setup wizard renders");

await browser.close();
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("Effects check passed.");
