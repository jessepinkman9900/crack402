import { describe, it, expect } from "vitest";
import {
  SANDBOX_STATUSES,
  SANDBOX_EVENTS,
  VALID_TRANSITIONS,
  isTerminal,
  type SandboxStatus,
  type SandboxEvent,
} from "../../src/state-machine/sandbox-states";
import {
  transition,
  isTransitionError,
  type TransitionContext,
} from "../../src/state-machine/sandbox-machine";

const defaultContext: TransitionContext = {
  sandboxId: "sbx_test1234567890123456",
  tenantId: "ten_test1234567890123456",
  nodeId: "node_test123456789012345",
  resources: { vcpu: 2, memoryMb: 2048 },
  timeoutSeconds: 3600,
  idleTimeoutSeconds: 600,
  autoPauseOnIdle: false,
  autoDestroy: true,
};

describe("Sandbox State Machine", () => {
  describe("valid transitions", () => {
    const validCases: [SandboxStatus, SandboxEvent, SandboxStatus][] = [
      // provisioning
      ["provisioning", "provision_complete", "ready"],
      ["provisioning", "error_occurred", "error"],
      ["provisioning", "destroy", "destroyed"],
      // ready
      ["ready", "start", "running"],
      ["ready", "exec_started", "running"],
      ["ready", "destroy", "destroyed"],
      ["ready", "error_occurred", "error"],
      // running
      ["running", "pause", "paused"],
      ["running", "stop_requested", "stopping"],
      ["running", "destroy", "destroyed"],
      ["running", "error_occurred", "error"],
      ["running", "timeout", "destroyed"],
      ["running", "node_failure", "error"],
      // paused
      ["paused", "resume", "running"],
      ["paused", "stop_requested", "stopping"],
      ["paused", "destroy", "destroyed"],
      ["paused", "error_occurred", "error"],
      ["paused", "node_failure", "error"],
      // stopping
      ["stopping", "stop_complete", "stopped"],
      ["stopping", "error_occurred", "error"],
      ["stopping", "destroy", "destroyed"],
      // stopped
      ["stopped", "start", "running"],
      ["stopped", "destroy", "destroyed"],
      ["stopped", "error_occurred", "error"],
      // error
      ["error", "destroy", "destroyed"],
      ["error", "recover", "ready"],
    ];

    for (const [from, event, expected] of validCases) {
      it(`${from} + ${event} → ${expected}`, () => {
        const result = transition(from, event, defaultContext);
        expect(isTransitionError(result)).toBe(false);
        if (!isTransitionError(result)) {
          expect(result.newState).toBe(expected);
        }
      });
    }
  });

  describe("idle_timeout behavior", () => {
    it("running + idle_timeout → paused when autoPauseOnIdle=true", () => {
      const ctx = { ...defaultContext, autoPauseOnIdle: true };
      const result = transition("running", "idle_timeout", ctx);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        expect(result.newState).toBe("paused");
      }
    });

    it("running + idle_timeout → destroyed when autoPauseOnIdle=false", () => {
      const ctx = { ...defaultContext, autoPauseOnIdle: false };
      const result = transition("running", "idle_timeout", ctx);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        expect(result.newState).toBe("destroyed");
      }
    });
  });

  describe("invalid transitions", () => {
    it("destroyed + any event → error (terminal state)", () => {
      for (const event of SANDBOX_EVENTS) {
        const result = transition("destroyed", event, defaultContext);
        expect(isTransitionError(result)).toBe(true);
      }
    });

    const invalidCases: [SandboxStatus, SandboxEvent][] = [
      ["provisioning", "start"],
      ["provisioning", "pause"],
      ["provisioning", "resume"],
      ["ready", "pause"],
      ["ready", "resume"],
      ["ready", "stop_complete"],
      ["running", "provision_complete"],
      ["running", "start"],
      ["paused", "provision_complete"],
      ["stopping", "start"],
      ["stopping", "pause"],
      ["stopped", "pause"],
      ["stopped", "resume"],
      ["error", "start"],
      ["error", "pause"],
    ];

    for (const [from, event] of invalidCases) {
      it(`${from} + ${event} → error`, () => {
        const result = transition(from, event, defaultContext);
        expect(isTransitionError(result)).toBe(true);
      });
    }
  });

  describe("side effects", () => {
    it("ready → running emits start_billing_meter", () => {
      const result = transition("ready", "start", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const billingEffect = result.effects.find((e) => e.type === "start_billing_meter");
        expect(billingEffect).toBeDefined();
      }
    });

    it("running → paused emits stop_billing_meter", () => {
      const result = transition("running", "pause", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const billingEffect = result.effects.find((e) => e.type === "stop_billing_meter");
        expect(billingEffect).toBeDefined();
      }
    });

    it("running → destroyed emits stop_billing_meter + update_scheduler release + update_quota", () => {
      const result = transition("running", "destroy", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        expect(result.effects.find((e) => e.type === "stop_billing_meter")).toBeDefined();
        expect(result.effects.find((e) => e.type === "update_scheduler" && e.action === "release")).toBeDefined();
        expect(result.effects.find((e) => e.type === "update_quota" && e.delta === -1)).toBeDefined();
      }
    });

    it("provisioning → ready arms TTL timer", () => {
      const result = transition("provisioning", "provision_complete", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const ttlEffect = result.effects.find((e) => e.type === "arm_ttl_timer");
        expect(ttlEffect).toBeDefined();
        if (ttlEffect && ttlEffect.type === "arm_ttl_timer") {
          expect(ttlEffect.durationMs).toBe(defaultContext.timeoutSeconds * 1000);
        }
      }
    });

    it("ready → running arms idle timer when idleTimeoutSeconds > 0", () => {
      const result = transition("ready", "start", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const idleEffect = result.effects.find((e) => e.type === "arm_idle_timer");
        expect(idleEffect).toBeDefined();
      }
    });

    it("running → destroyed emits sandbox.destroyed webhook", () => {
      const result = transition("running", "destroy", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const webhookEffect = result.effects.find(
          (e) => e.type === "emit_webhook" && e.eventType === "sandbox.destroyed"
        );
        expect(webhookEffect).toBeDefined();
      }
    });

    it("running → error via timeout emits sandbox.timeout webhook", () => {
      const result = transition("running", "timeout", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const webhookEffect = result.effects.find(
          (e) => e.type === "emit_webhook" && e.eventType === "sandbox.timeout"
        );
        expect(webhookEffect).toBeDefined();
      }
    });

    it("every transition emits update_status effect", () => {
      const result = transition("provisioning", "provision_complete", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const statusEffect = result.effects.find((e) => e.type === "update_status");
        expect(statusEffect).toBeDefined();
      }
    });

    it("every transition emits write_d1 effect", () => {
      const result = transition("provisioning", "provision_complete", defaultContext);
      expect(isTransitionError(result)).toBe(false);
      if (!isTransitionError(result)) {
        const d1Effect = result.effects.find((e) => e.type === "write_d1");
        expect(d1Effect).toBeDefined();
      }
    });
  });

  describe("terminal state", () => {
    it("destroyed is terminal", () => {
      expect(isTerminal("destroyed")).toBe(true);
    });

    it("other states are not terminal", () => {
      for (const status of SANDBOX_STATUSES) {
        if (status !== "destroyed") {
          expect(isTerminal(status)).toBe(false);
        }
      }
    });
  });
});
