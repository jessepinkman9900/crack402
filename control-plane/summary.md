# Control Plane API — Implementation Summary

## Overview

Implemented the Universal Agent Sandbox API for provisioning and managing isolated sandbox environments (Firecracker microVMs) for AI agents. Built on Cloudflare Workers with Durable Objects, D1, R2, and KV.

---

## Phase 1: Foundation

### Zod Schemas (`src/schemas/`)
- `common.ts` — ID patterns (`^sbx_`, `^exec_`, etc.), pagination, metadata
- `sandbox.ts` — CreateSandboxRequest, SandboxSchema (all fields from OpenAPI spec)
- `exec.ts` — ExecRequest (code/command/file), ExecResult, Artifact
- `files.ts` — WriteFile, FileResponse, FileEntry, FileList
- `snapshot.ts` — CreateSnapshot, Snapshot, FromSnapshot
- `payment.ts` — PaymentOption, PaymentRequired, `paymentRequired()` helper
- `node.ts` — Heartbeat, Command, CommandResult, SandboxStateEvent, ExecEvent, RegisterNode
- `error.ts` — ErrorCode enum, ErrorSchema, `apiError()` helper

### Pure State Machine (`src/state-machine/`)
- **8 states**: provisioning, ready, running, paused, stopping, stopped, error, destroyed
- **13 events**: provision_complete, start, exec_started, pause, resume, stop_requested, stop_complete, destroy, error_occurred, timeout, idle_timeout, node_failure, recover
- `transition(state, event, context) → {newState, effects[]}` — pure function, no I/O
- **12 side effect types**: enqueue_command, start/stop_billing_meter, arm_ttl/idle_timer, cancel_timer, emit_webhook, write_d1, update_scheduler, update_quota, release_resources, update_status

### Injectable Interfaces (`src/lib/`)
- `clock.ts` — Clock interface + realClock
- `random.ts` — Random interface + realRandom (nanoid-based)
- `id.ts` — ID generators for all entity types
- `base.ts` — DOStorage interface abstracting DurableObjectStorage

---

## Phase 2: Database & Durable Objects

### D1 Tables (`src/db/schema.ts`)
Added 8 tables: sandboxes, executions, snapshots, nodes, tenants, tenant_api_keys, billing_records, audit_logs, webhook_registrations

### Durable Objects (`src/durable-objects/`)

| DO | Key | Responsibilities |
|----|-----|-----------------|
| `GlobalSchedulerDO` | `"global"` (singleton) | Fleet capacity index, bin-pack/spread placement, node management |
| `NodeManagerDO` | per `node_id` | Command queue (enqueue/ack/complete), heartbeat alarm (offline after 60s) |
| `SandboxTrackerDO` | per `sandbox_id` | State machine execution, TTL/idle timers via alarms, billing meter |
| `TenantQuotaDO` | per `tenant_id` | Concurrent sandbox limit, vCPU/memory quota check-and-reserve |

Each DO uses internal Hono router, injectable Clock/Random/DOStorage via `initForTest()`.

### Configuration (`wrangler.toml`, `src/types.ts`)
- DO bindings: GLOBAL_SCHEDULER, NODE_MANAGER, SANDBOX_TRACKER, TENANT_QUOTA
- R2 bucket: SNAPSHOTS
- KV namespaces: TENANT_KEYS, NODE_TOKENS
- Bindings type extended with all new namespaces

---

## Phase 3: Middleware & API Routes

### Middleware (`src/middleware/`)
- `request-id.ts` — X-Request-Id header
- `sandbox-auth.ts` — Tenant auth via X-API-Key or Bearer token (KV lookup)
- `node-auth.ts` — Node agent auth via Bearer token
- `operator-auth.ts` — Operator auth for management API
- `payment.ts` — x402 payment protocol (402 with payment options)

### Routes (70+ endpoints)

**Workload API** (`/v1/sandboxes/*`, `/v1/webhooks/*`):
- Sandbox CRUD, lifecycle (wait/start/stop/pause), exec, files, snapshots, ports, webhooks

**Node API** (`/v1/internal/nodes/*`):
- Heartbeat, sandbox-events, exec-events, commands (poll/ack/result)

**Management API** (`/v1/mgmt/*`):
- Node CRUD, drain/undrain/cordon, fleet status, scheduler config, tenant CRUD, API keys

**Observability API** (`/v1/obs/*`):
- Events, billing usage/invoices, audit log, fleet metrics

---

## Phase 4–5: Tests

### Unit Tests — 106 passing

| Test File | Tests | What it covers |
|-----------|-------|---------------|
| `state-machine.test.ts` | 55 | All valid/invalid transitions, idle_timeout override, side effects, terminal state |
| `schemas.test.ts` | 15 | Zod validation: valid/invalid inputs, defaults, edge cases |
| `global-scheduler.test.ts` | 11 | Bin-pack placement, capacity, draining/offline skip, region affinity |
| `tenant-quota.test.ts` | 9 | Quota enforcement, release, auto-init, limits update |
| `sandbox-tracker.test.ts` | 9 | Init, transitions, billing start/stop, idle timer reset, destroy effects |
| `node-manager.test.ts` | 7 | Command queue, ack, complete, heartbeat, alarm offline detection |

### E2E Tests — 18 passing

| Test File | Tests | What it covers |
|-----------|-------|---------------|
| `sandbox-lifecycle.test.ts` | 5 | Full create → ready → exec → destroy lifecycle |
| `node-lifecycle.test.ts` | 5 | Node register, list, fleet status, drain, delete |
| `error-flows.test.ts` | 5 | Invalid requests (400), 404s, double-destroy (409), invalid exec |
| `webhook-flow.test.ts` | 3 | Webhook register, list, delete |

### Test Infrastructure
- `vitest.config.ts` — Unit tests with plain vitest (no workers pool)
- `vitest.e2e.config.ts` — E2E tests with `@cloudflare/vitest-pool-workers` + miniflare
- `test/helpers/in-memory-storage.ts` — InMemoryDOStorage for unit tests
- `test/e2e/setup.ts` — D1 migration runner for E2E environment

---

## Phase 6: Deterministic Simulation Testing (DST)

### Framework (`test/dst/framework/`)

| File | Purpose |
|------|---------|
| `virtual-clock.ts` | Controllable time with timer priority queue, `advanceTo()` fires timers in order |
| `deterministic-random.ts` | xoshiro256** PRNG seeded by integer. `id()`, `float()`, `int()`, `pick()`, `chance()`, `shuffle()` |
| `deterministic-storage.ts` | In-memory DOStorage with configurable fault injection on reads/writes. Snapshot-able. |
| `fault-injector.ts` | Conservative profile: storage 1%, alarms 2%, node crash 1%, message reorder 1% |
| `event-log.ts` | Records every action, state change, fault for replay on failure |
| `invariant-checker.ts` | Runs all invariants after every simulation step |
| `simulation-world.ts` | Orchestrates simulated nodes, tenants, DOs. Executes random actions. |
| `scenario-runner.ts` | Runs N seeds, reports first failure with seed + event trace |

### Invariants (`test/dst/invariants/`)

| Invariant | What it checks |
|-----------|---------------|
| `single-state` | No sandbox in two states simultaneously |
| `no-resurrection` | Destroyed sandboxes never come back |
| `quota-consistency` | Tenant quota matches actual sandbox count |
| `billing-meter` | Billing only active during `running` state |
| `node-failure` | Crashed node's sandboxes move to error/destroyed |
| `no-double-booking` | Scheduler never over-allocates node resources |

### Scenarios (`test/dst/scenarios/`)

| Scenario | Steps | Description |
|----------|-------|-------------|
| `happy-path` | 500 | Normal create → exec → snapshot → destroy cycles |
| `node-crash` | 300 | Random node crashes, sandbox error handling |
| `concurrent-creates` | 400 | 5 tenants competing for resources, quota enforcement |
| `rapid-transitions` | 500 | Create-and-immediately-destroy, rapid start/stop cycles |
| `alarm-failure` | 300 | TTL/idle timers with alarm failures |
| `storage-error` | 200 | Storage write failures mid-transaction |

### Results
- **6,000 seeds pass** (6 scenarios × 1,000 seeds) with conservative fault injection
- Runtime: ~30 seconds total

### CLI
```bash
npx tsx test/dst/run-dst.ts --seeds=1000              # Full run
npx tsx test/dst/run-dst.ts --seeds=10 --no-faults     # Without fault injection
npx tsx test/dst/run-dst.ts --scenario=node-crash       # Single scenario
npx tsx test/dst/run-dst.ts --verbose                   # Show event traces on failure
```

---

## Bug Found by DST

The state machine was missing `node_failure` transitions from `provisioning`, `ready`, `stopping`, and `stopped` states. When a node crashed, sandboxes in these states would remain in their current state instead of transitioning to `error`.

**Discovery**: DST node-crash scenario, seed 4, step 14. A sandbox in `provisioning` on a crashed node stayed in `provisioning`, violating the `node-failure` invariant.

**Fix**: Added `node_failure → error` to provisioning, ready, stopping, and stopped states in `src/state-machine/sandbox-states.ts`.

---

## File Count

| Category | Files Created/Modified |
|----------|----------------------|
| Schemas | 8 |
| State machine | 3 |
| Lib (interfaces) | 3 |
| Durable Objects | 5 |
| Middleware | 5 |
| Routes | 15 |
| DB schema | 1 (modified) |
| Config | 4 (wrangler.toml, types.ts, vitest configs) |
| Unit tests | 6 |
| E2E tests | 5 |
| DST framework | 7 |
| DST invariants | 6 |
| DST scenarios | 6 |
| DST runner | 1 |
| **Total** | **~75 files** |

## Commands

```bash
# Unit tests
bun run test:unit

# E2E tests
bun run test:e2e

# DST
bun run test:dst

# All tests
bun run test

# Type check
./node_modules/.bin/tsc --noEmit
```
