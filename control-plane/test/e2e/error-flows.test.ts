import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { applyMigrations } from "./setup";

describe("Error Flows E2E", () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  it("returns 400 for invalid create sandbox request", async () => {
    const res = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Missing base_image
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid vcpu value", async () => {
    const res = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_image: "python:3.12", vcpu: 0.1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent sandbox operations", async () => {
    // Try to delete
    const deleteRes = await SELF.fetch("http://localhost/v1/sandboxes/sbx_nonexistent00000000000", {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(404);

    // Try to exec
    const execRes = await SELF.fetch("http://localhost/v1/sandboxes/sbx_nonexistent00000000000/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "command", command: "echo hi" }),
    });
    expect(execRes.status).toBe(404);
  });

  it("returns 409 for destroying an already destroyed sandbox", async () => {
    // Create sandbox
    const createRes = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_image: "python:3.12-slim" }),
    });

    // Need a node for this to work
    const nodeRes = await SELF.fetch("http://localhost/v1/mgmt/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: "us-east-1", total_vcpu: 16, total_memory_mb: 32768 }),
    });
    const nodeData = (await nodeRes.json()) as any;
    // Heartbeat
    await SELF.fetch(`http://localhost/v1/internal/nodes/${nodeData.node_id}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node_id: nodeData.node_id,
        timestamp: new Date().toISOString(),
        total_vcpu: 16,
        used_vcpu: 0,
        total_memory_mb: 32768,
        used_memory_mb: 0,
        sandbox_count: 0,
        sandbox_ids: [],
        status: "healthy",
      }),
    });

    const createRes2 = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_image: "python:3.12-slim" }),
    });
    const sandbox = (await createRes2.json()) as any;

    // Destroy once
    await SELF.fetch(`http://localhost/v1/sandboxes/${sandbox.sandbox_id}`, { method: "DELETE" });

    // Try to destroy again
    const secondDelete = await SELF.fetch(`http://localhost/v1/sandboxes/${sandbox.sandbox_id}`, {
      method: "DELETE",
    });
    expect(secondDelete.status).toBe(409);
  });

  it("returns 400 for invalid exec request", async () => {
    // Create sandbox first
    const nodeRes = await SELF.fetch("http://localhost/v1/mgmt/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: "us-east-1", total_vcpu: 16, total_memory_mb: 32768 }),
    });
    const nodeData = (await nodeRes.json()) as any;
    await SELF.fetch(`http://localhost/v1/internal/nodes/${nodeData.node_id}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node_id: nodeData.node_id,
        timestamp: new Date().toISOString(),
        total_vcpu: 16, used_vcpu: 0, total_memory_mb: 32768, used_memory_mb: 0,
        sandbox_count: 0, sandbox_ids: [], status: "healthy",
      }),
    });

    const createRes = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_image: "python:3.12-slim" }),
    });
    const sandbox = (await createRes.json()) as any;

    // Invalid exec (missing type)
    const execRes = await SELF.fetch(`http://localhost/v1/sandboxes/${sandbox.sandbox_id}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "print('hi')" }),
    });
    expect(execRes.status).toBe(400);
  });
});
