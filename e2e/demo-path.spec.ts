import { expect, test } from "@playwright/test";
import { type Servers, startServers } from "./servers";

/*
 * The demo path in a browser, on synthetic pull requests: parity (same
 * answers, now recorded) → shadow (the comparison fills) → active (routed;
 * a concern goes to a reviewer) → the reviewer answers from the keyboard →
 * the run settles and the quality panel shows it. Every number here is
 * simulated and labeled so.
 */

let servers: Servers;
test.beforeAll(async () => {
  servers = await startServers();
});
test.afterAll(() => servers?.stop());

const shot = (name: string) => `test-results/screens/${name}.png`;

test("baseline → parity → shadow → active → one review answered → quality panel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByRole("radio", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(`owner-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/runs/);
  await expect(page.getByTestId("demo-badge")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();

  // Baseline: the provider PullUp calls, before any decision.
  await page.goto("/settings");
  await expect(page.getByTestId("connection")).toContainText("AskWithAI SDK");
  await expect(page.getByTestId("connection")).toContainText(servers.runtime);

  // Parity: the fast tier's own answer, now recorded.
  await page.goto("/quality");
  await page.getByTestId("serving-parity").click();
  await expect(page.getByTestId("serving-mode-control")).toContainText("Callers get the fast tier's own answer");
  await page.getByTestId("demo-play").click();
  await expect(page.getByTestId("demo-note")).toContainText('"played":10');
  await page.goto("/runs");
  await expect(page.getByTestId("runs-table")).toContainText("acme/shop");
  await expect(page.getByTestId("runs-table").getByText("SIMULATED").first()).toBeVisible();
  await page.screenshot({ path: shot("pullup-runs"), fullPage: true });
  await page.goto("/decisions");
  await expect(page.getByTestId("decisions-table")).toBeVisible();

  // Shadow: same answers; AskWithAI also records what routing would answer.
  await page.goto("/quality");
  await page.getByTestId("serving-shadow").click();
  await expect(page.getByTestId("serving-mode-control")).toContainText("records what routing would have answered");
  await page.getByTestId("demo-play").click();
  await expect(page.getByTestId("demo-note")).toContainText('"played":10');
  await page.reload();
  await expect(page.getByTestId("shadow-comparison")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: shot("pullup-quality-shadow"), fullPage: true });

  // Active: confirm, then play the hard cases; some go to a reviewer.
  await page.getByTestId("serving-active").click();
  await page.getByRole("button", { name: "Go active" }).click();
  await expect(page.getByTestId("serving-mode-control")).toContainText("Callers get routed answers");
  await page.getByTestId("demo-play-hard").click();
  await expect(page.getByTestId("demo-note")).toContainText('"played":20');

  // A reviewer answers one case from the keyboard.
  await page.goto("/reviews");
  const card = page.getByTestId("review-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Is this change risky to merge");
  await page.screenshot({ path: shot("pullup-review"), fullPage: true });
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Settled merge_risk=risky/).first()).toBeVisible();

  // PullUp picks up the answer, and the run settles.
  await page.goto("/quality");
  await page.getByTestId("demo-refresh").click();
  await expect(page.getByTestId("demo-note")).toContainText('"changed":');
  await expect(page.getByTestId("quality-panel")).toBeVisible();
  await expect(page.getByTestId("quality-panel").getByTestId("kit-simulated")).toBeVisible();
  await page.screenshot({ path: shot("pullup-quality-active"), fullPage: true });

  await page.goto("/runs");
  const failed = page.getByTestId("runs-table").getByRole("link").first();
  await failed.click();
  await expect(page.getByText("CI", { exact: true })).toBeVisible();
  await page.screenshot({ path: shot("pullup-run"), fullPage: true });

  // Persistence: a reload keeps every run.
  await page.goto("/runs");
  await page.reload();
  await expect(page.getByTestId("runs-table").getByRole("link")).toHaveCount(40);
});

test("the landing page and sign-in work without an account; the app pages need one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A CI check that knows when to ask" })).toBeVisible();
  await page.goto("/runs");
  await page.waitForURL(/\/login/);
});
