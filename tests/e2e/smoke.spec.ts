import { test, expect } from "@playwright/test";

test.describe("Tenant smoke", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/sign in/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("health endpoint responds", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
  });

  test("platform status endpoint responds", async ({ request }) => {
    const res = await request.get("/api/platform/status");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("platformName");
  });
});

test.describe("Auth API smoke", () => {
  test("login rejects bad credentials", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { email: "bad@example.com", password: "wrongpass" },
    });
    expect(res.status()).toBe(401);
  });

  test("login accepts demo tenant", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { email: "admin@danetstecpro.com", password: "danets123" },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.user?.email).toBe("admin@danetstecpro.com");
  });
});

test.describe("Widget smoke", () => {
  test("widget script is served", async ({ request }) => {
    const res = await request.get("/widget.js?pk=test");
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text.length).toBeGreaterThan(100);
  });
});
