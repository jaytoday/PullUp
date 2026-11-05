/**
 * Extensions in the dashboard: Settings → Extensions (modes, generated settings form, the
 * "loosen" confirmation, a saved draft that survives a reload, discarding it), the run page's
 * extension groups and "would ask" list, and the accuracy page's Shadow table. Then the
 * settings page in dark mode and at phone width with no sideways scrolling.
 *
 *   node e2e/extensions.mjs   (dev server on PULLUP_E2E_URL or http://localhost:3500; `pnpm seed` first)
 */
import { chromium } from "playwright";

const base = process.env.PULLUP_E2E_URL ?? "http://localhost:3500";
const errors = [];
const browser = await chromium.launch();
const check = (ok, text) => {
  if (!ok) throw new Error(`Failed: ${text}`);
  console.log(`• ${text}`);
};

async function signedIn(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/login`);
  await page.fill("#email", "owner@example.com");
  await page.fill("#password", "pullup-dev-password");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/overview/);
  return page;
}

const page = await signedIn();
await page.goto(`${base}/settings`);
const repo = page.getByTestId("extensions-acme/payments");
const ext = (id) => repo.getByTestId(`extension-${id}`);
const mode = async (id) => (await ext(id).locator('[role="radio"][aria-checked="true"]').textContent()).trim();
const save = repo.getByRole("button", { name: "Save draft" });

// The latest seeded run of acme/payments has threat-model in Shadow.
check((await mode("core")) === "Active" && (await mode("threat-model")) === "Shadow" && (await mode("doc-links")) === "Off", "modes start from the committed config (the latest run's)");
check(await save.isDisabled(), "nothing changed: Save draft is disabled");

await ext("doc-links").getByRole("radio", { name: "Shadow" }).click();
check((await mode("doc-links")) === "Shadow", "doc-links switched to Shadow");
check(!(await save.isDisabled()), "a change that does not loosen can be saved at once");
await save.click();
await page.getByText("Draft saved.").waitFor();
await page.reload();
check((await mode("doc-links")) === "Shadow", "after a reload, the saved draft is still there");
check(await repo.getByTestId("draft-not-committed").isVisible(), "the draft is marked as not committed yet");
await repo.getByText("The file to commit as .pullup/config.json").click();
const file = JSON.parse(await repo.getByTestId("extensions-file").textContent());
check(file.extensions["doc-links"].mode === "shadow" && file.requiredWorkflows[0] === "ci", "the file to commit has the change and the rest of the config");

await ext("core").getByRole("radio", { name: "Shadow" }).click();
const loose = repo.getByTestId("extension-loosenings");
check((await loose.textContent()).includes("Core checks (core) is in Shadow mode."), "core in Shadow is listed as a loosening");
check(await save.isDisabled(), "a loosening cannot be saved before \"loosen\" is typed");
await loose.getByRole("textbox").fill("loosen");
await save.click();
await page.getByText("Draft saved.").waitFor();
await page.reload();
check((await mode("core")) === "Shadow", "after a reload, core is still in Shadow in the draft");

await ext("threat-model").getByRole("button", { name: "Threat model settings" }).click();
const dialog = page.getByRole("dialog");
check(await dialog.getByText("loosens").isVisible(), "the settings form marks the loosening field");
await dialog.getByRole("switch", { name: "The council may pass changes to a control alone" }).click();
await dialog.getByRole("button", { name: "Done" }).click();
check((await loose.textContent()).includes('"The council may pass changes to a control alone" is changed'), "turning on a loosening field in the form is listed too");
await ext("core").getByRole("radio", { name: "Active" }).click();
check(!(await loose.textContent()).includes("Core checks (core) is in Shadow mode."), "switching core back to Active removes that loosening");

await repo.getByRole("button", { name: "Discard draft" }).click();
await page.getByText("Draft discarded").waitFor();
await page.reload();
check((await mode("core")) === "Active" && (await mode("doc-links")) === "Off", "after discarding and a reload, the committed modes are back");

// Run pages: a threat model question in its own group, and a Shadow extension's "would ask" list.
await page.goto(`${base}/runs`);
const runHref = async (text) => page.locator('a[href^="/runs/"]', { hasText: text }).first().getAttribute("href");
const touched = await runHref("acme/payments #3");
const shadowRun = await runHref("acme/payments #4");
await page.goto(`${base}${touched}`);
check(await page.getByTestId("extension-group-threat-model").isVisible(), "the run page groups the threat model question under its extension");
check(await page.getByTestId("question-threat-model:T1").getByText("Does this change weaken the control for T1").isVisible(), "the question card shows the threat");
check((await page.getByTestId("extension-notes").textContent()).includes("src/webhook.ts:10"), "the annotation is listed for the reviewer");
await page.goto(`${base}${shadowRun}`);
check((await page.getByTestId("would-ask").textContent()).includes("threat-model:entry-point"), "a Shadow extension's question is in the would-ask list");

await page.goto(`${base}/accuracy`);
check((await page.getByTestId("shadow-outcomes").textContent()).includes("threat-model"), "the accuracy page shows the Shadow extension's council outcomes");

// Dark mode at phone width: the settings list fits with no sideways scrolling.
const phone = await signedIn({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await phone.goto(`${base}/settings`);
await phone.getByTestId("extensions-acme/payments").waitFor();
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, `phone width in dark mode: no sideways scrolling (overflow ${overflow}px)`);
await phone.screenshot({ path: ".data/extensions-settings-phone-dark.png", fullPage: true });
await page.screenshot({ path: ".data/extensions-accuracy.png", fullPage: true });

await browser.close();
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("Extensions check passed.");
