# Control Plane

Cloudflare Worker that manages isolated sandbox environments (Firecracker microVMs) for AI agents. Built with Hono, Drizzle ORM, Durable Objects, D1, R2, and KV.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (Hono)                                   │
│                                                             │
│  /v1/sandboxes/*  ← tenant auth (X-API-Key / Bearer)       │
│  /v1/webhooks/*   ← tenant auth                            │
│  /v1/internal/*   ← node auth (per-node Bearer token)      │
│  /v1/mgmt/*       ← operator auth (OPERATOR_API_KEY)       │
│  /v1/obs/*        ← tenant auth                            │
├─────────────────────────────────────────────────────────────┤
│  Durable Objects                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐     │
│  │ GlobalSched- │ │ NodeManager  │ │ SandboxTracker   │     │
│  │ ulerDO       │ │ DO           │ │ DO               │     │
│  │ (singleton)  │ │ (per node)   │ │ (per sandbox)    │     │
│  └──────────────┘ └──────────────┘ └─────────────────┘     │
│  ┌──────────────┐                                           │
│  │ TenantQuota  │                                           │
│  │ DO           │                                           │
│  │ (per tenant) │                                           │
│  └──────────────┘                                           │
├─────────────────────────────────────────────────────────────┤
│  D1 (SQLite)  │  KV            │  R2                        │
│  9 tables     │  TENANT_KEYS   │  SNAPSHOTS bucket          │
│               │  NODE_TOKENS   │                             │
└─────────────────────────────────────────────────────────────┘
```

### Durable Objects

| DO | Key | Purpose |
|----|-----|---------|
| `GlobalSchedulerDO` | `"global"` | Singleton. Tracks all node capacity. Bin-pack or spread placement. |
| `NodeManagerDO` | `node_id` | One per node. Command queue (create/destroy/exec). Heartbeat alarm (marks offline after 60s). |
| `SandboxTrackerDO` | `sandbox_id` | One per sandbox. Runs the pure state machine. Manages TTL/idle timers via DO alarms. Tracks billing. |
| `TenantQuotaDO` | `tenant_id` | One per tenant. Atomic check-and-reserve for concurrent sandbox/vCPU/memory limits. |

### State Machine

Pure function at `src/state-machine/sandbox-machine.ts`. No I/O. Returns `{newState, effects[]}`.

```
provisioning ──provision_complete──▸ ready
provisioning ──error_occurred─────▸ error
provisioning ──destroy────────────▸ destroyed
provisioning ──node_failure───────▸ error

ready ──start / exec_started──▸ running
ready ──destroy───────────────▸ destroyed
ready ──node_failure──────────▸ error

running ──pause──────────▸ paused
running ──stop_requested─▸ stopping
running ──destroy────────▸ destroyed
running ──timeout────────▸ destroyed
running ──idle_timeout───▸ paused (or destroyed if auto_pause_on_idle=false)
running ──node_failure───▸ error

paused ──resume──────────▸ running
paused ──destroy─────────▸ destroyed
paused ──node_failure────▸ error

stopping ──stop_complete──▸ stopped
stopping ──destroy────────▸ destroyed
stopping ──node_failure───▸ error

stopped ──start────▸ running
stopped ──destroy──▸ destroyed

error ──destroy──▸ destroyed
error ──recover──▸ ready

destroyed ──(terminal, no exits)
```

Side effects are data: `enqueue_command`, `start_billing_meter`, `stop_billing_meter`, `arm_ttl_timer`, `arm_idle_timer`, `cancel_timer`, `emit_webhook`, `write_d1`, `update_scheduler`, `update_quota`.

## Data Flow

### 1. Node Registration (operator → mgmt API)

```
POST /v1/mgmt/nodes {region, total_vcpu, total_memory_mb}
  → generates node_id + bootstrap_token
  → inserts into D1 `nodes` table
  → stores bootstrap_token → node_id in KV `NODE_TOKENS`
  → registers capacity in GlobalSchedulerDO
  → returns {node_id, bootstrap_token}
```

### 2. Node Heartbeat (node agent → internal API)

```
POST /v1/internal/nodes/:nodeId/heartbeat {total_vcpu, used_vcpu, ...}
  → NodeManagerDO: resets 60s offline alarm
  → GlobalSchedulerDO: updates capacity snapshot
```

### 3. Create Sandbox (tenant → workload API)

```
POST /v1/sandboxes {base_image, vcpu, memory_mb, ...}
  1. TenantQuotaDO.checkAndReserve(vcpu, memoryMb)     → 429 if over limit
  2. GlobalSchedulerDO.placeSandbox({vcpu, memoryMb})   → 503 if no capacity
  3. GlobalSchedulerDO.allocateResources(nodeId, ...)
  4. SandboxTrackerDO.initSandbox(config)               → status=provisioning
  5. NodeManagerDO.enqueueCommand("create_sandbox")     → queued for node agent
  6. D1 insert into `sandboxes`
  → returns {sandbox_id, status: "provisioning"}
```

### 4. Node Agent Polls & Executes

```
GET  /v1/internal/nodes/:nodeId/commands            → returns pending commands
POST /v1/internal/nodes/:nodeId/commands/:cmdId/ack  → marks command acknowledged
  (node agent creates the microVM)
POST /v1/internal/nodes/:nodeId/sandbox-events {sandbox_id, status: "ready"}
  → SandboxTrackerDO.transition("provision_complete") → status=ready
  → D1 update sandboxes.status
```

### 5. Execute Code (tenant → workload API)

```
POST /v1/sandboxes/:id/exec {type: "command", command: "echo hi", async: true}
  1. Verify sandbox is ready/running
  2. SandboxTrackerDO.execActivity() → resets idle timer
  3. If ready → SandboxTrackerDO.transition("exec_started") → status=running
  4. D1 insert into `executions`
  5. NodeManagerDO.enqueueCommand("exec")
  → returns {exec_id, poll_url}

  (node agent executes, then reports back:)
POST /v1/internal/nodes/:nodeId/exec-events {exec_id, status: "completed", stdout, exit_code}
  → D1 update executions

GET /v1/sandboxes/:id/exec/:execId → returns result
```

### 6. Destroy Sandbox (tenant → workload API)

```
DELETE /v1/sandboxes/:id
  1. SandboxTrackerDO.transition("destroy") → status=destroyed
  2. Side effects: stop_billing_meter, cancel_timer, update_scheduler(release),
     update_quota(delta=-1), enqueue_command("destroy_sandbox")
  3. D1 update sandboxes.status = destroyed
  → returns 204
```

### 7. Timeouts (automatic via DO alarms)

```
TTL timeout:  SandboxTrackerDO alarm fires → transition("timeout") → destroyed
Idle timeout: SandboxTrackerDO alarm fires → transition("idle_timeout") → paused or destroyed
Node offline: NodeManagerDO alarm fires after 60s with no heartbeat → marks node offline
```

## API Call Sequence

For a complete sandbox lifecycle, calls must happen in this order:

```
# 1. Register a node (operator)
POST /v1/mgmt/nodes

# 2. Node agent starts heartbeating (node agent)
POST /v1/internal/nodes/:nodeId/heartbeat  (every 30s)

# 3. Create a sandbox (tenant)
POST /v1/sandboxes

# 4. Node agent polls, creates VM, reports ready (node agent)
GET  /v1/internal/nodes/:nodeId/commands
POST /v1/internal/nodes/:nodeId/commands/:cmdId/ack
POST /v1/internal/nodes/:nodeId/sandbox-events  {status: "ready"}

# 5. Execute code (tenant)
POST /v1/sandboxes/:id/exec

# 6. Node agent executes, reports result (node agent)
POST /v1/internal/nodes/:nodeId/exec-events

# 7. Tenant reads result
GET  /v1/sandboxes/:id/exec/:execId

# 8. Destroy (tenant)
DELETE /v1/sandboxes/:id
```

## Key Files

```
src/
├── index.ts                          # Hono app, route mounting, DO exports
├── types.ts                          # Bindings (D1, DOs, R2, KV)
├── db/schema.ts                      # Drizzle ORM tables (9 tables)
├── schemas/                          # Zod request/response schemas
│   ├── sandbox.ts, exec.ts, files.ts, snapshot.ts, payment.ts, node.ts
│   ├── error.ts, common.ts
├── state-machine/
│   ├── sandbox-states.ts             # Status enum, event enum, transition map
│   ├── sandbox-machine.ts            # transition() pure function
│   └── effects.ts                    # SideEffect union type
├── lib/
│   ├── clock.ts, random.ts, id.ts    # Injectable interfaces
├── durable-objects/
│   ├── base.ts                       # DOStorage interface
│   ├── global-scheduler.ts           # Bin-pack placement
│   ├── node-manager.ts               # Command queue + heartbeat
│   ├── sandbox-tracker.ts            # State machine + billing + timers
│   └── tenant-quota.ts               # Quota check-and-reserve
├── middleware/
│   ├── sandbox-auth.ts               # Tenant auth (X-API-Key / Bearer → KV)
│   ├── node-auth.ts                  # Node auth (Bearer → KV)
│   ├── operator-auth.ts              # Operator auth (OPERATOR_API_KEY)
│   ├── payment.ts                    # x402 payment protocol
│   └── request-id.ts                 # X-Request-Id header
├── routes/
│   ├── sandboxes/                    # CRUD, lifecycle, exec, files, snapshots, ports, webhooks
│   ├── nodes/internal.ts             # Heartbeat, sandbox-events, exec-events, commands
│   ├── mgmt/                         # Node CRUD, drain, fleet status, tenants
│   └── obs/                          # Events, billing, audit, metrics
```

## Running Tests

All commands run from `control-plane/`.

```bash
# Install dependencies
bun install

# Unit tests (106 tests — state machine, schemas, DOs)
bun run test:unit

# E2E tests (18 tests — full API flows via miniflare)
bun run test:e2e

# All tests
bun run test

# DST — deterministic simulation testing (6 scenarios × N seeds)
bun run test:dst

# DST with custom seeds
npx tsx test/dst/run-dst.ts --seeds=1000

# DST without fault injection
npx tsx test/dst/run-dst.ts --seeds=100 --no-faults

# DST single scenario with verbose trace
npx tsx test/dst/run-dst.ts --scenario=node-crash --seeds=50 --verbose

# Type check
./node_modules/.bin/tsc --noEmit

# Local dev server
npx wrangler dev

# Generate DB migration after schema changes
bun run db:generate

# Apply migrations locally
bun run db:migrate
```

### Test Structure

```
test/
├── unit/                              # Pure logic, no Workers runtime
│   ├── state-machine.test.ts          # 55 tests: all transitions, effects, edge cases
│   ├── schemas.test.ts                # 15 tests: Zod validation
│   ├── global-scheduler.test.ts       # 11 tests: placement, capacity
│   ├── tenant-quota.test.ts           #  9 tests: quota enforcement
│   ├── sandbox-tracker.test.ts        #  9 tests: lifecycle, billing, timers
│   └── node-manager.test.ts           #  7 tests: command queue, heartbeat
├── e2e/                               # Full API via @cloudflare/vitest-pool-workers
│   ├── setup.ts                       # D1 migration runner
│   ├── sandbox-lifecycle.test.ts      # Create → ready → exec → destroy
│   ├── node-lifecycle.test.ts         # Register, list, drain, delete
│   ├── error-flows.test.ts            # 400s, 404s, 409s
│   └── webhook-flow.test.ts           # Webhook CRUD
├── dst/                               # Deterministic simulation testing
│   ├── framework/
│   │   ├── virtual-clock.ts           # Controllable time + timer queue
│   │   ├── deterministic-random.ts    # xoshiro256** PRNG
│   │   ├── deterministic-storage.ts   # In-memory DOStorage + fault injection
│   │   ├── fault-injector.ts          # 1-2% failure rates
│   │   ├── event-log.ts              # Action/fault recording for replay
│   │   ├── invariant-checker.ts       # Post-step invariant validation
│   │   ├── simulation-world.ts        # Orchestrates all DOs
│   │   └── scenario-runner.ts         # Multi-seed runner
│   ├── invariants/                    # 6 invariants checked every step
│   │   ├── single-state.ts            # No sandbox in two states
│   │   ├── no-resurrection.ts         # Destroyed is terminal
│   │   ├── quota-consistency.ts       # Quota matches reality
│   │   ├── billing-meter.ts           # Billing only when running
│   │   ├── node-failure.ts            # Crashed node → sandboxes error
│   │   └── no-double-booking.ts       # No resource over-allocation
│   ├── scenarios/                     # 6 scenarios
│   │   ├── happy-path.ts, node-crash.ts, concurrent-creates.ts
│   │   ├── rapid-transitions.ts, alarm-failure.ts, storage-error.ts
│   └── run-dst.ts                     # CLI entry point
└── helpers/
    └── in-memory-storage.ts           # DOStorage impl for unit tests
```

## Design Decisions

- **Pure state machine**: `transition()` has no I/O. Returns effects as data. This makes it trivially testable and enables DST.
- **Injectable interfaces**: All DOs accept Clock, Random, DOStorage via `initForTest()`. Tests swap in deterministic implementations.
- **Dual D1 + DO storage**: D1 for queries/listing, DO storage for real-time state. DO is source of truth for status; D1 is eventually consistent.
- **Command queue pattern**: API doesn't talk to nodes directly. It enqueues commands in NodeManagerDO. Node agents poll `GET /commands`, ack, execute, report results. Decouples control plane from node availability.
- **Auth bypass**: Set `DISABLE_AUTH=true` in wrangler.toml vars to skip tenant/node/operator auth (for local dev and E2E tests).
