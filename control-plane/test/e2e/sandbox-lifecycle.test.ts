import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyMigrations } from "./setup";

describe("Sandbox Lifecycle E2E", () => {
  let nodeId: string;
  let nodeToken: string;

  beforeAll(async () => {
    await applyMigrations();
    // Register a node via management API
    const res = await SELF.fetch("http://localhost/v1/mgmt/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: "us-east-1",
        total_vcpu: 16,
        total_memory_mb: 32768,
      }),
    });
    const data = (await res.json()) as any;
    nodeId = data.node_id;
    nodeToken = data.bootstrap_token;

    // Send initial heartbeat
    await SELF.fetch(`http://localhost/v1/internal/nodes/${nodeId}/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nodeToken}`,
      },
      body: JSON.stringify({
        node_id: nodeId,
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
  });

  it("creates a sandbox", async () => {
    const res = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_image: "python:3.12-slim",
        vcpu: 2,
        memory_mb: 2048,
        timeout_seconds: 3600,
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.sandbox_id).toBeDefined();
    expect(data.status).toBe("provisioning");
    expect(data.sandbox_id).toMatch(/^sbx_/);
  });

  it("full lifecycle: create → ready → exec → destroy", async () => {
    // 1. Create sandbox
    const createRes = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_image: "python:3.12-slim" }),
    });
    expect(createRes.status).toBe(201);
    const sandbox = (await createRes.json()) as any;
    const sandboxId = sandbox.sandbox_id;

    // 2. Simulate node reporting sandbox ready
    await SELF.fetch(`http://localhost/v1/internal/nodes/${nodeId}/sandbox-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nodeToken}`,
      },
      body: JSON.stringify({
        sandbox_id: sandboxId,
        status: "ready",
        timestamp: new Date().toISOString(),
      }),
    });

    // 3. GET sandbox — should be ready
    const getRes = await SELF.fetch(`http://localhost/v1/sandboxes/${sandboxId}`);
    expect(getRes.status).toBe(200);
    const gotSandbox = (await getRes.json()) as any;
    expect(gotSandbox.status).toBe("ready");

    // 4. Execute a command
    const execRes = await SELF.fetch(`http://localhost/v1/sandboxes/${sandboxId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "command",
        command: "echo hello",
        async: true,
      }),
    });
    expect(execRes.status).toBe(202);
    const execData = (await execRes.json()) as any;
    expect(execData.exec_id).toBeDefined();

    // 5. Simulate node reporting exec completed
    await SELF.fetch(`http://localhost/v1/internal/nodes/${nodeId}/exec-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nodeToken}`,
      },
      body: JSON.stringify({
        exec_id: execData.exec_id,
        sandbox_id: sandboxId,
        status: "completed",
        exit_code: 0,
        stdout: "hello\n",
        stderr: "",
        duration_ms: 43,
      }),
    });

    // 6. GET exec result
    const execResultRes = await SELF.fetch(
      `http://localhost/v1/sandboxes/${sandboxId}/exec/${execData.exec_id}`
    );
    expect(execResultRes.status).toBe(200);
    const execResult = (await execResultRes.json()) as any;
    expect(execResult.status).toBe("completed");
    expect(execResult.exit_code).toBe(0);
    expect(execResult.stdout).toBe("hello\n");

    // 7. Destroy sandbox
    const deleteRes = await SELF.fetch(`http://localhost/v1/sandboxes/${sandboxId}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);
  });

  it("lists sandboxes", async () => {
    const res = await SELF.fetch("http://localhost/v1/sandboxes");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.sandboxes).toBeDefined();
    expect(Array.isArray(data.sandboxes)).toBe(true);
  });

  it("returns 404 for non-existent sandbox", async () => {
    const res = await SELF.fetch("http://localhost/v1/sandboxes/sbx_nonexistent00000000000");
    expect(res.status).toBe(404);
  });

  it("creates a snapshot", async () => {
    // Create and ready a sandbox first
    const createRes = await SELF.fetch("http://localhost/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_image: "python:3.12-slim" }),
    });
    const sandbox = (await createRes.json()) as any;

    const snapRes = await SELF.fetch(
      `http://localhost/v1/sandboxes/${sandbox.sandbox_id}/snapshots`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test-snapshot" }),
      }
    );
    expect(snapRes.status).toBe(201);
    const snap = (await snapRes.json()) as any;
    expect(snap.snapshot_id).toMatch(/^snap_/);
  });
});
