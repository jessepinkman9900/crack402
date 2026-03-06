import { VirtualClock } from "./virtual-clock";
import { DeterministicRandom } from "./deterministic-random";
import { DeterministicStorage } from "./deterministic-storage";
import { FaultInjector, type FaultProfile, CONSERVATIVE_PROFILE } from "./fault-injector";
import { EventLog } from "./event-log";
import { InvariantChecker, type InvariantViolation } from "./invariant-checker";

import { GlobalSchedulerDO, type NodeCapacity } from "../../../src/durable-objects/global-scheduler";
import { NodeManagerDO } from "../../../src/durable-objects/node-manager";
import { SandboxTrackerDO, type SandboxState } from "../../../src/durable-objects/sandbox-tracker";
import { TenantQuotaDO, type QuotaState } from "../../../src/durable-objects/tenant-quota";
import type { SandboxStatus, SandboxEvent } from "../../../src/state-machine/sandbox-states";

export interface SimNode {
  nodeId: string;
  region: string;
  totalVcpu: number;
  totalMemoryMb: number;
  isOnline: boolean;
  manager: NodeManagerDO;
  storage: DeterministicStorage;
}

export interface SimSandbox {
  sandboxId: string;
  tenantId: string;
  nodeId: string;
  tracker: SandboxTrackerDO;
  storage: DeterministicStorage;
  status: SandboxStatus;
  destroyed: boolean;
}

export interface SimTenant {
  tenantId: string;
  quota: TenantQuotaDO;
  storage: DeterministicStorage;
  sandboxIds: string[];
}

export type SimAction =
  | { type: "create_sandbox"; tenantId: string; vcpu: number; memoryMb: number }
  | { type: "destroy_sandbox"; sandboxId: string }
  | { type: "transition_sandbox"; sandboxId: string; event: SandboxEvent }
  | { type: "exec_activity"; sandboxId: string }
  | { type: "node_heartbeat"; nodeId: string }
  | { type: "node_crash"; nodeId: string }
  | { type: "advance_time"; deltaMs: number }
  | { type: "fire_alarms" };

/**
 * Orchestrates a deterministic simulation of the entire control plane.
 * All DOs use injectable storage, clock, and random for full reproducibility.
 */
export class SimulationWorld {
  readonly clock: VirtualClock;
  readonly random: DeterministicRandom;
  readonly faultInjector: FaultInjector;
  readonly eventLog: EventLog;
  readonly invariantChecker: InvariantChecker;

  private schedulerStorage: DeterministicStorage;
  readonly scheduler: GlobalSchedulerDO;

  readonly nodes: Map<string, SimNode> = new Map();
  readonly sandboxes: Map<string, SimSandbox> = new Map();
  readonly tenants: Map<string, SimTenant> = new Map();

  private seed: number;

  constructor(seed: number, faultProfile: FaultProfile = CONSERVATIVE_PROFILE) {
    this.seed = seed;
    this.random = new DeterministicRandom(seed);
    this.clock = new VirtualClock(1_000_000_000); // Start at ~2001
    this.faultInjector = new FaultInjector(this.random, faultProfile);
    this.eventLog = new EventLog();
    this.invariantChecker = new InvariantChecker();

    // Create global scheduler
    this.schedulerStorage = new DeterministicStorage(this.random);
    this.scheduler = new GlobalSchedulerDO({} as any, {});
    this.scheduler.initForTest(this.schedulerStorage, this.clock);
  }

  getSeed(): number {
    return this.seed;
  }

  // ===== Node operations =====

  async addNode(region = "us-east-1", vcpu = 16, memoryMb = 32768): Promise<string> {
    const nodeId = this.random.id("node_");
    const storage = new DeterministicStorage(this.random);
    const manager = new NodeManagerDO({} as any, {});
    manager.initForTest(storage, this.clock, this.random);

    const node: SimNode = {
      nodeId, region, totalVcpu: vcpu, totalMemoryMb: memoryMb,
      isOnline: true, manager, storage,
    };
    this.nodes.set(nodeId, node);

    // Register with scheduler
    const capacity: NodeCapacity = {
      nodeId, region,
      totalVcpu: vcpu, usedVcpu: 0,
      totalMemoryMb: memoryMb, usedMemoryMb: 0,
      sandboxCount: 0, status: "healthy",
      lastHeartbeat: this.clock.now(),
    };
    await this.scheduler.updateNode(capacity);

    // Initial heartbeat
    await manager.handleHeartbeat({ status: "healthy", sandbox_ids: [] });

    this.eventLog.log({
      timestamp: this.clock.now(),
      kind: "action",
      actor: `node_${nodeId}`,
      action: "register",
      details: { region, vcpu, memoryMb },
    });

    return nodeId;
  }

  async crashNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node || !node.isOnline) return;

    node.isOnline = false;

    // Update scheduler
    const allNodes = await this.scheduler.getAllNodes();
    const cap = allNodes.find((n) => n.nodeId === nodeId);
    if (cap) {
      cap.status = "offline";
      await this.scheduler.updateNode(cap);
    }

    this.eventLog.log({
      timestamp: this.clock.now(),
      kind: "node_event",
      actor: `node_${nodeId}`,
      action: "crash",
      details: {},
    });

    // Transition all sandboxes on this node to error
    for (const [, sbx] of this.sandboxes) {
      if (sbx.nodeId === nodeId && !sbx.destroyed) {
        try {
          const result = await sbx.tracker.handleTransition("node_failure");
          if (!("error" in result)) {
            sbx.status = result.newState;
            if (result.newState === "destroyed") sbx.destroyed = true;
          }
        } catch {
          // Fault injection may cause this to fail
        }
      }
    }
  }

  async heartbeatNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node || !node.isOnline) return;

    const sandboxIds = Array.from(this.sandboxes.values())
      .filter((s) => s.nodeId === nodeId && !s.destroyed)
      .map((s) => s.sandboxId);

    try {
      await node.manager.handleHeartbeat({ status: "healthy", sandbox_ids: sandboxIds });

      // Update scheduler with current capacity
      const allNodes = await this.scheduler.getAllNodes();
      const cap = allNodes.find((n) => n.nodeId === nodeId);
      if (cap) {
        cap.lastHeartbeat = this.clock.now();
        cap.status = "healthy";
        await this.scheduler.updateNode(cap);
      }
    } catch (e) {
      this.eventLog.log({
        timestamp: this.clock.now(),
        kind: "fault",
        actor: `node_${nodeId}`,
        action: "heartbeat_failed",
        details: {},
        error: String(e),
      });
    }
  }

  // ===== Tenant operations =====

  async addTenant(maxSandboxes = 10): Promise<string> {
    const tenantId = this.random.id("ten_");
    const storage = new DeterministicStorage(this.random);
    const quota = new TenantQuotaDO({} as any, {});
    quota.initForTest(storage);
    await quota.initQuota({ maxConcurrentSandboxes: maxSandboxes });

    this.tenants.set(tenantId, { tenantId, quota, storage, sandboxIds: [] });
    return tenantId;
  }

  // ===== Sandbox operations =====

  async createSandbox(
    tenantId: string,
    vcpu = 2,
    memoryMb = 2048
  ): Promise<{ sandboxId: string; nodeId: string } | { error: string }> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return { error: "tenant_not_found" };

    // Check quota
    try {
      const quotaResult = await tenant.quota.checkAndReserve(vcpu, memoryMb);
      if (!quotaResult.allowed) {
        this.eventLog.log({
          timestamp: this.clock.now(),
          kind: "action",
          actor: `tenant_${tenantId}`,
          action: "create_sandbox_rejected",
          details: { reason: quotaResult.reason },
        });
        return { error: quotaResult.reason || "quota_exceeded" };
      }
    } catch (e) {
      return { error: `quota_check_failed: ${e}` };
    }

    // Place sandbox
    const placement = await this.scheduler.placeSandbox({ vcpu, memoryMb });
    if (!placement) {
      // Release quota since placement failed
      await tenant.quota.release(vcpu, memoryMb);
      return { error: "capacity_exhausted" };
    }

    // Allocate resources
    await this.scheduler.allocateResources(placement.nodeId, vcpu, memoryMb);

    // Create tracker
    const sandboxId = this.random.id("sbx_");
    const storage = new DeterministicStorage(this.random);
    const tracker = new SandboxTrackerDO({} as any, {});
    tracker.initForTest(storage, this.clock);

    await tracker.initSandbox({
      sandboxId,
      tenantId,
      nodeId: placement.nodeId,
      baseImage: "python:3.12-slim",
      vcpu,
      memoryMb,
      timeoutSeconds: 3600,
      idleTimeoutSeconds: 600,
      autoPauseOnIdle: true,
      autoDestroy: true,
    });

    const sbx: SimSandbox = {
      sandboxId,
      tenantId,
      nodeId: placement.nodeId,
      tracker,
      storage,
      status: "provisioning",
      destroyed: false,
    };
    this.sandboxes.set(sandboxId, sbx);
    tenant.sandboxIds.push(sandboxId);

    this.eventLog.log({
      timestamp: this.clock.now(),
      kind: "sandbox_event",
      actor: `sandbox_${sandboxId}`,
      action: "created",
      details: { tenantId, nodeId: placement.nodeId, vcpu, memoryMb },
    });

    return { sandboxId, nodeId: placement.nodeId };
  }

  async transitionSandbox(sandboxId: string, event: SandboxEvent): Promise<SandboxStatus | { error: string }> {
    const sbx = this.sandboxes.get(sandboxId);
    if (!sbx) return { error: "sandbox_not_found" };
    if (sbx.destroyed) return { error: "sandbox_already_destroyed" };

    try {
      const result = await sbx.tracker.handleTransition(event);
      if ("error" in result) {
        this.eventLog.log({
          timestamp: this.clock.now(),
          kind: "state_change",
          actor: `sandbox_${sandboxId}`,
          action: "transition_rejected",
          details: { event, currentStatus: sbx.status },
          error: result.error,
        });
        return { error: result.error };
      }

      const prevStatus = sbx.status;
      sbx.status = result.newState;

      if (result.newState === "destroyed") {
        sbx.destroyed = true;
        // Release resources
        const state = await sbx.tracker.getState();
        if (state) {
          const tenant = this.tenants.get(sbx.tenantId);
          if (tenant) {
            try {
              await tenant.quota.release(state.vcpu, state.memoryMb);
            } catch { /* fault injection */ }
          }
          try {
            await this.scheduler.releaseResources(sbx.nodeId, state.vcpu, state.memoryMb);
          } catch { /* fault injection */ }
        }
      }

      this.eventLog.log({
        timestamp: this.clock.now(),
        kind: "state_change",
        actor: `sandbox_${sandboxId}`,
        action: "transition",
        details: { event, from: prevStatus, to: result.newState, effectCount: result.effects.length },
      });

      return result.newState;
    } catch (e) {
      this.eventLog.log({
        timestamp: this.clock.now(),
        kind: "fault",
        actor: `sandbox_${sandboxId}`,
        action: "transition_error",
        details: { event },
        error: String(e),
      });
      return { error: String(e) };
    }
  }

  async execActivity(sandboxId: string): Promise<void> {
    const sbx = this.sandboxes.get(sandboxId);
    if (!sbx || sbx.destroyed) return;

    try {
      await sbx.tracker.recordExecActivity();
    } catch {
      // fault injection
    }
  }

  // ===== Time + Alarms =====

  async fireAlarms(): Promise<number> {
    let fired = 0;
    for (const [, sbx] of this.sandboxes) {
      if (sbx.destroyed) continue;
      const alarmTime = sbx.storage.getAlarmTime();
      if (alarmTime !== null && alarmTime <= this.clock.now()) {
        if (this.faultInjector.shouldFailAlarm()) {
          this.eventLog.log({
            timestamp: this.clock.now(),
            kind: "fault",
            actor: `sandbox_${sbx.sandboxId}`,
            action: "alarm_failure",
            details: { alarmTime },
          });
          continue;
        }

        try {
          await sbx.tracker.alarm();
          // Re-read state
          const state = await sbx.tracker.getState();
          if (state) {
            const prevStatus = sbx.status;
            sbx.status = state.status;
            if (state.status === "destroyed") {
              sbx.destroyed = true;
              // Release resources
              const tenant = this.tenants.get(sbx.tenantId);
              if (tenant) {
                try { await tenant.quota.release(state.vcpu, state.memoryMb); } catch { /**/ }
              }
              try { await this.scheduler.releaseResources(sbx.nodeId, state.vcpu, state.memoryMb); } catch { /**/ }
            }

            this.eventLog.log({
              timestamp: this.clock.now(),
              kind: "timer_fired",
              actor: `sandbox_${sbx.sandboxId}`,
              action: "alarm",
              details: { from: prevStatus, to: state.status },
            });
          }
          fired++;
        } catch (e) {
          this.eventLog.log({
            timestamp: this.clock.now(),
            kind: "fault",
            actor: `sandbox_${sbx.sandboxId}`,
            action: "alarm_handler_error",
            details: {},
            error: String(e),
          });
        }
      }
    }

    // Node manager alarms
    for (const [, node] of this.nodes) {
      const alarmTime = node.storage.getAlarmTime();
      if (alarmTime !== null && alarmTime <= this.clock.now()) {
        try {
          await node.manager.alarm();
          fired++;
        } catch {
          // fault injection
        }
      }
    }

    return fired;
  }

  async advanceTime(deltaMs: number): Promise<void> {
    this.clock.setNow(this.clock.now() + deltaMs);
    await this.fireAlarms();
  }

  // ===== Query helpers =====

  getActiveSandboxes(): SimSandbox[] {
    return Array.from(this.sandboxes.values()).filter((s) => !s.destroyed);
  }

  getSandboxesByStatus(status: SandboxStatus): SimSandbox[] {
    return Array.from(this.sandboxes.values()).filter((s) => s.status === status);
  }

  getSandboxesForTenant(tenantId: string): SimSandbox[] {
    return Array.from(this.sandboxes.values()).filter((s) => s.tenantId === tenantId);
  }

  getSandboxesOnNode(nodeId: string): SimSandbox[] {
    return Array.from(this.sandboxes.values()).filter((s) => s.nodeId === nodeId && !s.destroyed);
  }

  getOnlineNodes(): SimNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.isOnline);
  }

  async getSchedulerNodes(): Promise<NodeCapacity[]> {
    return this.scheduler.getAllNodes();
  }

  async getTenantQuota(tenantId: string): Promise<QuotaState | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    return tenant.quota.getQuota();
  }

  /** Execute a single simulation action */
  async executeAction(action: SimAction): Promise<void> {
    switch (action.type) {
      case "create_sandbox":
        await this.createSandbox(action.tenantId, action.vcpu, action.memoryMb);
        break;
      case "destroy_sandbox":
        await this.transitionSandbox(action.sandboxId, "destroy");
        break;
      case "transition_sandbox":
        await this.transitionSandbox(action.sandboxId, action.event);
        break;
      case "exec_activity":
        await this.execActivity(action.sandboxId);
        break;
      case "node_heartbeat":
        await this.heartbeatNode(action.nodeId);
        break;
      case "node_crash":
        await this.crashNode(action.nodeId);
        break;
      case "advance_time":
        await this.advanceTime(action.deltaMs);
        break;
      case "fire_alarms":
        await this.fireAlarms();
        break;
    }
  }
}
