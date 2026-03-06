import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { applyMigrations } from "./setup";

describe("Node Lifecycle E2E", () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  it("registers a node", async () => {
    const res = await SELF.fetch("http://localhost/v1/mgmt/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: "us-east-1",
        total_vcpu: 8,
        total_memory_mb: 16384,
        firecracker_version: "v1.14.2",
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.node_id).toMatch(/^node_/);
    expect(data.bootstrap_token).toBeDefined();
    expect(data.status).toBe("healthy");
  });

  it("lists nodes", async () => {
    const res = await SELF.fetch("http://localhost/v1/mgmt/nodes");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.nodes).toBeDefined();
    expect(Array.isArray(data.nodes)).toBe(true);
  });

  it("gets fleet status", async () => {
    const res = await SELF.fetch("http://localhost/v1/mgmt/fleet/status");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.node_count).toBeDefined();
    expect(data.total_vcpu).toBeDefined();
  });

  it("drains a node", async () => {
    // Register
    const regRes = await SELF.fetch("http://localhost/v1/mgmt/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: "us-east-1", total_vcpu: 8, total_memory_mb: 16384 }),
    });
    const { node_id } = (await regRes.json()) as any;

    // Drain
    const drainRes = await SELF.fetch(`http://localhost/v1/mgmt/nodes/${node_id}/drain`, {
      method: "POST",
    });
    expect(drainRes.status).toBe(200);
    const data = (await drainRes.json()) as any;
    expect(data.status).toBe("draining");
  });

  it("deletes a node", async () => {
    const regRes = await SELF.fetch("http://localhost/v1/mgmt/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: "eu-west-1", total_vcpu: 4, total_memory_mb: 8192 }),
    });
    const { node_id } = (await regRes.json()) as any;

    const deleteRes = await SELF.fetch(`http://localhost/v1/mgmt/nodes/${node_id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);
  });
});
