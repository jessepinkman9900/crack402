import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { applyMigrations } from "./setup";

describe("Webhook Flow E2E", () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  it("registers a webhook", async () => {
    const res = await SELF.fetch("http://localhost/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/webhook",
        events: ["sandbox.created", "sandbox.destroyed"],
        secret: "whsec_test123",
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.webhook_id).toMatch(/^wh_/);
    expect(data.url).toBe("https://example.com/webhook");
    expect(data.events).toHaveLength(2);
  });

  it("lists webhooks", async () => {
    // Register one first
    await SELF.fetch("http://localhost/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/hook2",
        events: ["sandbox.ready"],
      }),
    });

    const res = await SELF.fetch("http://localhost/v1/webhooks");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.webhooks).toBeDefined();
    expect(data.webhooks.length).toBeGreaterThan(0);
  });

  it("deletes a webhook", async () => {
    const createRes = await SELF.fetch("http://localhost/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/delete-me",
        events: ["sandbox.error"],
      }),
    });
    const { webhook_id } = (await createRes.json()) as any;

    const deleteRes = await SELF.fetch(`http://localhost/v1/webhooks/${webhook_id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);
  });
});
