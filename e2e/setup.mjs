/**
 * Walks the repo setup wizard: required fields block Continue, the backup is required for
 * "Ask a backup person", a preset adds extensions in Shadow mode, a looser setting needs "loosen"
 * typed, and the file reflects the answers.
 *
 *   node e2e/setup.mjs   (dev server on PULLUP_E2E_URL or http://localhost:3500; `pnpm seed` first)
 */
import { chromium } from "playwright";

const base = process.env.PULLUP_E2E_URL ?? "http://localhost:3500";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const check = (ok, text) => {
  if (!ok) throw new Error(`Failed: ${text}`);
  console.log(`• ${text}`);
};
const next = () => page.getByRole("button", { name: "Continue" });

await page.goto(`${base}/login`);
await page.fill("#email", "owner@example.com");
await page.fill("#password", "pullup-dev-password");
await page.click("button[type=submit]");
await page.waitForURL(/\/overview/);
await page.goto(`${base}/setup`);

await next().click();
const workflows = page.getByPlaceholder("ci, e2e");
await workflows.fill("");
check(await next().isDisabled(), "no workflows: Continue is disabled");
await workflows.fill("ci, e2e");
await next().click();

check(await next().isDisabled(), "no person: Continue is disabled");
await page.getByPlaceholder("reviewer@example.com").fill("reviewer@example.com");
await page.getByPlaceholder("octocat").fill("@reviewer");
await page.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Ask a backup person" }).click();
check(await next().isDisabled(), "escalate without a backup: Continue is disabled");
await page.getByPlaceholder("oncall@example.com").fill("oncall@example.com");
await next().click();

check((await page.getByRole("radio", { name: /^Essentials/ }).getAttribute("aria-checked")) === "true", "Essentials is the default preset");
await page.getByRole("radio", { name: /^Security/ }).click();
await next().click();

await page.getByLabel("sensitive-path council may pass").click();
check((await page.getByTestId("loosenings").textContent()).includes("The council may pass sensitive-path questions"), "a looser setting is listed");
check(await next().isDisabled(), "looser setting: Continue disabled until confirmed");
await page.getByTestId("loosenings").getByRole("textbox").fill("loosen");
await next().click();

const file = JSON.parse(await page.getByTestId("config-file").textContent());
check(JSON.stringify(file.requiredWorkflows) === '["ci","e2e"]', "file has the workflows");
check(file.ask.to === "reviewer@example.com" && file.ask.toGithub === "reviewer" && file.ask.backup === "oncall@example.com" && file.ask.onNoAnswer === "escalate", "file has the people and the no-answer option");
check(file.extensions.core.triggers["sensitive-path"].councilMayPass === true, "file has the loosened trigger");
check(["repo-rules", "threat-model", "codeowners"].every((id) => file.extensions[id].mode === "shadow"), "the Security preset adds repository rules, the threat model and code owners in Shadow mode");

await page.getByRole("button", { name: "Back" }).click();
check((await page.getByTestId("loosenings").getByRole("textbox").inputValue()) === "loosen", "going back keeps the answers");

await browser.close();
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log("Setup check passed.");
