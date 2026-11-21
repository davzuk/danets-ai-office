import { test, expect } from "@playwright/test";

// Widget attribution → lead, end to end. Needs a running app with the seeded
// demo tenant (admin@danetstecpro.com) and the contacts_attribution migration.
test.describe("Widget attribution", () => {
  test("a utm-tagged visit becomes a paid-social lead with a bf26 first touch", async ({ page, request, baseURL }) => {
    const login = await request.post("/api/auth/login", {
      data: { email: "admin@danetstecpro.com", password: "danets123" },
    });
    expect(login.ok()).toBeTruthy();
    const { business } = await (await request.get("/api/business")).json();
    expect(business?.publicKey).toBeTruthy();

    // A "customer site" page on the app's own origin, so the widget's
    // relative /api/public/* calls reach the real server.
    await page.route(`${baseURL}/e2e-host**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body><h1>Shop</h1><script src="/widget.js?pk=${business.publicKey}"></script></body></html>`,
      })
    );
    const tracked = page.waitForResponse((r) => r.url().includes("/api/public/track"));
    await page.goto("/e2e-host?utm_source=facebook&utm_campaign=bf26");
    expect((await tracked).ok()).toBeTruthy();

    const stored = await page.evaluate(() => ({
      first: JSON.parse(localStorage.getItem("danets_ft") || "null"),
      visitorId: localStorage.getItem("danets_vid"),
    }));
    expect(stored.first).toMatchObject({ source: "facebook", campaign: "bf26" });

    // Submit the widget's lead form payload (the form itself only appears after an AI reply).
    const email = `e2e-${Date.now()}@example.com`;
    const leadRes = await page.evaluate(
      async ({ pk, email, visitorId }) => {
        const last = JSON.parse(localStorage.getItem("danets_lt") || "null")?.touch;
        const first = JSON.parse(localStorage.getItem("danets_ft") || "null");
        const r = await fetch("/api/public/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pk, name: "E2E Visitor", email, visitorId, attribution: { first, last } }),
        });
        return { status: r.status, body: await r.json() };
      },
      { pk: business.publicKey, email, visitorId: stored.visitorId }
    );
    expect(leadRes.status).toBe(200);

    const { leads } = await (await request.get(`/api/leads?q=${encodeURIComponent(email)}`)).json();
    expect(leads).toHaveLength(1);
    expect(leads[0].source).toBe("social_paid");

    const journey = await (await request.get(`/api/leads/${leads[0].id}/journey`)).json();
    const first = journey.touchpoints.find((t: { id: string }) => t.id === journey.firstTouchId);
    expect(first).toMatchObject({ kind: "visit", channel: "social_paid", campaign: "bf26" });
    expect(journey.touchpoints.map((t: { kind: string }) => t.kind)).toContain("form_submit");

    // Same person again (new browser, same email): one contact, no second lead.
    const again = await request.post("/api/public/lead", {
      data: { pk: business.publicKey, name: "E2E Visitor", email },
    });
    expect((await again.json()).alreadyExists).toBe(true);
    const journey2 = await (await request.get(`/api/leads/${leads[0].id}/journey`)).json();
    expect(journey2.touchpoints.filter((t: { kind: string }) => t.kind === "form_submit")).toHaveLength(2);
  });
});
