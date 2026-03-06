import { describe, it, expect } from "vitest";
import { CreateSandboxRequestSchema } from "../../src/schemas/sandbox";
import { ExecRequestSchema } from "../../src/schemas/exec";

describe("Zod Schemas", () => {
  describe("CreateSandboxRequestSchema", () => {
    it("parses minimal valid request", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12-slim",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.base_image).toBe("python:3.12-slim");
        expect(result.data.vcpu).toBe(2);
        expect(result.data.memory_mb).toBe(2048);
        expect(result.data.timeout_seconds).toBe(3600);
        expect(result.data.network_policy).toBe("outbound-only");
      }
    });

    it("parses fully specified request", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "ubuntu:22.04",
        vcpu: 4,
        memory_mb: 8192,
        timeout_seconds: 7200,
        gpu: "A100-40",
        env_vars: { API_KEY: "test" },
        network_policy: "full",
        metadata: { agent_id: "agent-123" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vcpu).toBe(4);
        expect(result.data.gpu).toBe("A100-40");
      }
    });

    it("rejects missing base_image", () => {
      const result = CreateSandboxRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid vcpu range (too low)", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12",
        vcpu: 0.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid vcpu range (too high)", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12",
        vcpu: 64,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid memory_mb", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12",
        memory_mb: 100,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid GPU type", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12",
        gpu: "RTX4090",
      });
      expect(result.success).toBe(false);
    });

    it("accepts null GPU", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12",
        gpu: null,
      });
      expect(result.success).toBe(true);
    });

    it("applies default values", () => {
      const result = CreateSandboxRequestSchema.safeParse({
        base_image: "python:3.12",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auto_destroy).toBe(true);
        expect(result.data.auto_pause_on_idle).toBe(false);
        expect(result.data.idle_timeout_seconds).toBe(600);
      }
    });
  });

  describe("ExecRequestSchema", () => {
    it("parses code execution request", () => {
      const result = ExecRequestSchema.safeParse({
        type: "code",
        code: "print('hello')",
        language: "python",
      });
      expect(result.success).toBe(true);
    });

    it("parses command execution request", () => {
      const result = ExecRequestSchema.safeParse({
        type: "command",
        command: "ls -la",
      });
      expect(result.success).toBe(true);
    });

    it("parses array command", () => {
      const result = ExecRequestSchema.safeParse({
        type: "command",
        command: ["pip", "install", "requests"],
      });
      expect(result.success).toBe(true);
    });

    it("parses file execution request", () => {
      const result = ExecRequestSchema.safeParse({
        type: "file",
        file_path: "/workspace/main.py",
        args: ["--input", "data.csv"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing type", () => {
      const result = ExecRequestSchema.safeParse({
        code: "print('hello')",
      });
      expect(result.success).toBe(false);
    });

    it("applies default timeout", () => {
      const result = ExecRequestSchema.safeParse({
        type: "command",
        command: "echo hi",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timeout_seconds).toBe(300);
        expect(result.data.working_dir).toBe("/workspace");
        expect(result.data.async).toBe(false);
      }
    });
  });
});
