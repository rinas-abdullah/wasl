import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Wasl@Demo2026";

async function login(page: Page, user: string) {
  await page.goto("about:blank"); // leave the app first so its 401 handler cannot race this navigation
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "wasl_locale", value: "en", domain: "localhost", path: "/" }]);
  await page.goto("/login");
  await page.fill("#email", `${user}@demo.wasl.sa`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function apiPost(page: Page, url: string, body: unknown = {}) {
  return page.evaluate(async ([u, b]) => {
    const me = await (await fetch("/api/auth/me")).json();
    const r = await fetch(u as string, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": me.csrfToken }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json() };
  }, [url, body] as const);
}

test("acceptance journey: register → schedule → twin → dock failure → optimise → simulate → sensor → quality → readiness → release → handover → events → reports", async ({ page }) => {
  await page.goto("/login");
  // 0. Reset demo data (demo organisation only)
  await login(page, "admin");
  expect((await apiPost(page, "/api/demo/reset")).status).toBe(200);

  // 1. Dashboard
  await login(page, "ops");
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Operational overview" })).toBeVisible();
  await expect(page.getByText("Scheduled today")).toBeVisible();

  // 2. Register a truck with shipment requirements
  await page.goto("/trucks");
  await page.getByRole("button", { name: "Register truck" }).first().click();
  await page.fill("#plate", "E2E 2026");
  await page.selectOption("#carrier", { index: 1 });
  await page.selectOption("#veh", "RIGID");
  await page.selectOption("#cargo", "GENERAL");
  await page.fill("#pal", "14");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.waitForURL(/\/trucks\/[0-9a-f-]{36}$/);
  const code = (await page.locator("h1").innerText()).trim();
  expect(code).toMatch(/^WSL-\d+$/);
  const truckUrl = page.url();

  // 3. Find it in the schedule and confirm a slot on D4 (server-validated)
  await page.goto("/schedule");
  await expect(page.getByText(code).first()).toBeVisible();
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const truckOption = page.locator("#s-t option", { hasText: code });
  await page.selectOption("#s-t", (await truckOption.getAttribute("value"))!);
  const d4 = page.locator("#s-d option", { hasText: "D4" });
  await page.selectOption("#s-d", (await d4.getAttribute("value"))!);
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("No conflicts — can be confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Confirm appointment" }).click();
  await expect(page.getByText(/Appointment confirmed/)).toBeVisible();

  // 4. See it in the digital twin
  await page.goto("/twin");
  await expect(page.getByRole("button", { name: code }).first()).toBeVisible();

  // 5. Disable dock D3 → affected trucks recorded
  await page.goto("/docks");
  const d3Card = page.locator("div.rounded-\\[var\\(--radius-card\\)\\]", { has: page.getByText("Dock 3 · General + Inspection bay") });
  await d3Card.getByRole("button", { name: "Disable dock" }).click();
  await page.fill("#confirm-reason", "Hydraulic leveler failure (E2E)");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(/Trucks affected by D3/)).toBeVisible();

  // 6-7. Optimisation proposal from the real solver, inspect and approve
  await page.goto("/optimization");
  await page.getByRole("button", { name: "Run optimization" }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve plan" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/ortools-.*cp-sat/)).toBeVisible();
  await page.getByRole("button", { name: "Inspect" }).first().click();
  await expect(page.getByRole("heading", { name: /Why this assignment\?/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Approve plan" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Plan approved and applied/)).toBeVisible();

  // 8. Run a small simulation comparing policies
  await page.goto("/simulation");
  await page.getByRole("button", { name: "New scenario" }).click();
  await page.fill("#sn", "E2E dock failure");
  await page.fill("#reps", "1");
  await page.fill("#nTrucks", "12");
  await page.fill("#durationMin", "300");
  for (const p of ["Fixed appointments", "Optimisation only (OR)"]) await page.getByLabel(p).uncheck();
  await page.getByRole("button", { name: /^Run 2 runs$/ }).click();
  await expect(page.getByText("Policy comparison (mean ± 95% CI)")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("cell", { name: "Avg on-site waiting (min)" })).toBeVisible();

  // 9-10. Virtual temperature excursion → quality review appears
  await login(page, "quality");
  await page.goto("/sensors");
  const pharma = page.locator("#sh option", { hasText: "WSL-1007" });
  await page.selectOption("#sh", (await pharma.getAttribute("value"))!);
  await page.getByRole("button", { name: "Generate temperature excursion" }).click();
  await expect(page.getByText(/quality review was created/)).toBeVisible();
  await page.goto("/quality");
  await page.getByRole("row", { name: /SHP-1007/ }).click();
  await expect(page.getByText("Virtual sensor events")).toBeVisible();

  // 11. Readiness shows the quality effect
  await login(page, "ops");
  await page.goto("/readiness");
  const t7 = page.locator("#r-truck option", { hasText: "WSL-1007" });
  await page.selectOption("#r-truck", (await t7.getAttribute("value"))!);
  await expect(page.getByText("Manual review required").first()).toBeVisible();

  // 12. Release the new truck when conditions are met
  const rt = page.locator("#r-truck option", { hasText: code });
  await page.selectOption("#r-truck", (await rt.getAttribute("value"))!);
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Release truck" }).click();
  await expect(page.getByText(/Released — dock window/)).toBeVisible();

  // 13. Document service and handover with authorised actions
  await login(page, "dock");
  await page.goto("/handover");
  await page.getByRole("row", { name: new RegExp(code) }).click();
  for (const a of ["Confirm arrival", "Start unloading", "Approve handover", "Close operation"]) {
    await page.getByRole("button", { name: a }).click();
    await expect(page.getByText(/Action recorded/).last()).toBeVisible();
  }
  await page.goto(truckUrl);
  await expect(page.getByText("Departed").first()).toBeVisible();

  // 14. Event log contains the operations
  await login(page, "auditor");
  await page.goto("/events");
  await page.getByPlaceholder("Search entity, actor, type").fill(code);
  await expect(page.getByRole("cell", { name: /Truck called/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /Truck departed/ }).first()).toBeVisible();

  // 15. Reports are consistent
  await login(page, "ops");
  await page.goto("/analytics");
  await expect(page.getByText("Truck turnaround report")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(code) })).toContainText("Departed");
});

test("role-based UI and server enforcement for a carrier operator (no facility-wide data)", async ({ page }) => {
  await page.goto("/login");
  await login(page, "carrier");
  await expect(page.getByRole("link", { name: "Trucks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Optimization center" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  const r = await apiPost(page, "/api/optimization/runs", {});
  expect(r.status).toBe(403);
});

test("visitors land directly in the platform (demo mode) and switch role from the top bar", async ({ page }) => {
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "wasl_locale", value: "en", domain: "localhost", path: "/" }]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Operational overview" })).toBeVisible({ timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Switch role" }).click();
  await page.getByRole("menuitem", { name: "Dock supervisor" }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Dock Supervisor (Demo)");
  // Explicit sign-out goes to the login page and does not auto sign-in again
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/overview");
  await page.waitForURL(/\/login/);
});
