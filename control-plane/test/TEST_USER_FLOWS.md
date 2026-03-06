# Test User Flows

## State Machine Definition

### States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `provisioning` | Sandbox creation requested, waiting for node to report VM ready | No |
| `ready` | VM is provisioned and idle, awaiting exec or start | No |
| `running` | VM is actively executing code; billing meter is on | No |
| `paused` | VM is suspended; billing meter is off | No |
| `stopping` | Graceful stop requested, waiting for node to confirm | No |
| `stopped` | VM gracefully stopped; can be restarted | No |
| `error` | Something went wrong (node crash, provisioning failure, etc.) | No |
| `destroyed` | Terminal. Resources released, quota decremented, no further transitions | Yes |

### Transitions

```
provisioning ──provision_complete──> ready
provisioning ──error_occurred──────> error
provisioning ──destroy─────────────> destroyed
provisioning ──node_failure────────> error

ready ──start──────────> running
ready ──exec_started───> running
ready ──destroy────────> destroyed
ready ──error_occurred─> error
ready ──node_failure───> error

running ──pause──────────> paused
running ──stop_requested─> stopping
running ──destroy────────> destroyed
running ──error_occurred─> error
running ──timeout────────> destroyed
running ──idle_timeout───> paused   (autoPauseOnIdle=true)
running ──idle_timeout───> destroyed (autoPauseOnIdle=false)
running ──node_failure───> error

paused ──resume─────────> running
paused ──stop_requested─> stopping
paused ──destroy────────> destroyed
paused ──error_occurred─> error
paused ──node_failure───> error

stopping ──stop_complete──> stopped
stopping ──error_occurred─> error
stopping ──destroy────────> destroyed
stopping ──node_failure───> error

stopped ──start──────────> running
stopped ──destroy────────> destroyed
stopped ──error_occurred─> error
stopped ──node_failure───> error

error ──destroy──> destroyed
error ──recover──> ready

destroyed ── (no exits, terminal)
```

### Side Effects (emitted as data by the pure `transition()` function)

| Effect | When |
|--------|------|
| `update_status` | Every transition |
| `write_d1` | Every transition (persists status to D1) |
| `start_billing_meter` | Entering `running` from any non-running state |
| `stop_billing_meter` | Leaving `running` to any non-running state |
| `arm_ttl_timer` | `provisioning -> ready` (arms overall sandbox TTL) |
| `arm_idle_timer` | Entering `running` when `idleTimeoutSeconds > 0` |
| `cancel_timer(idle)` | Entering `destroyed`, `error`, `stopped`, or `paused` |
| `cancel_timer(ttl)` | Entering `destroyed` |
| `update_scheduler(release)` | Entering `destroyed` (free node resources) |
| `update_quota(-1)` | Entering `destroyed` (decrement tenant count) |
| `enqueue_command(destroy_sandbox)` | Entering `destroyed` from non-provisioning/non-error states |
| `enqueue_command(pause_sandbox)` | On `pause` event |
| `enqueue_command(resume_sandbox)` | On `resume` event |
| `enqueue_command(destroy_sandbox, graceful)` | On `stop_requested` event |
| `emit_webhook` | Most transitions (sandbox.ready, sandbox.started, sandbox.stopped, sandbox.paused, sandbox.destroyed, sandbox.timeout, sandbox.error) |

---

## User Flows Tested

### 1. Unit Tests (`test/unit/`)

#### 1.1 State Machine (`state-machine.test.ts` -- 55 tests)

**Valid transitions (24 tests)**
Every legal `(from, event) -> to` triple is tested individually:
- provisioning: `provision_complete`, `error_occurred`, `destroy`
- ready: `start`, `exec_started`, `destroy`, `error_occurred`
- running: `pause`, `stop_requested`, `destroy`, `error_occurred`, `timeout`, `node_failure`
- paused: `resume`, `stop_requested`, `destroy`, `error_occurred`, `node_failure`
- stopping: `stop_complete`, `error_occurred`, `destroy`
- stopped: `start`, `destroy`, `error_occurred`
- error: `destroy`, `recover`

**idle_timeout behavior (2 tests)**
- `running + idle_timeout -> paused` when `autoPauseOnIdle=true`
- `running + idle_timeout -> destroyed` when `autoPauseOnIdle=false`

**Invalid transitions (15+ tests)**
- All 13 events on `destroyed` state return errors (terminal)
- 14 specific invalid combos tested (e.g., `provisioning + start`, `ready + resume`, `error + start`)

**Side effect correctness (9 tests)**
- `ready -> running` emits `start_billing_meter`
- `running -> paused` emits `stop_billing_meter`
- `running -> destroyed` emits `stop_billing_meter` + `update_scheduler(release)` + `update_quota(-1)`
- `provisioning -> ready` arms TTL timer with correct duration
- `ready -> running` arms idle timer when `idleTimeoutSeconds > 0`
- `running -> destroyed` via `destroy` emits `sandbox.destroyed` webhook
- `running -> destroyed` via `timeout` emits `sandbox.timeout` webhook
- Every transition emits `update_status`
- Every transition emits `write_d1`

**Terminal state (2 tests)**
- `destroyed` is terminal
- All other states are not terminal

#### 1.2 Schemas (`schemas.test.ts` -- 15 tests)

**CreateSandboxRequest validation:**
- Minimal valid request (just `base_image`) gets correct defaults (vcpu=2, memory=2048, timeout=3600, network_policy=outbound-only)
- Fully specified request with GPU, env vars, metadata
- Rejects: missing `base_image`, invalid vcpu (too low/high), invalid memory, invalid GPU type
- Accepts null GPU
- Default values: `auto_destroy=true`, `auto_pause_on_idle=false`, `idle_timeout_seconds=600`

**ExecRequest validation:**
- Code execution (`type: "code"` + `code` + `language`)
- Command execution (`type: "command"` + string command)
- Array command (`["pip", "install", "requests"]`)
- File execution (`type: "file"` + `file_path` + `args`)
- Rejects missing `type`
- Defaults: `timeout_seconds=300`, `working_dir=/workspace`, `async=false`

#### 1.3 GlobalSchedulerDO (`global-scheduler.test.ts` -- 11 tests)

**Placement flow:**
- Places sandbox on healthy node with capacity
- Returns null when no nodes exist
- Returns null when all nodes at capacity
- Skips draining, cordoned, and offline nodes
- Bin-pack strategy: prefers node with less free resources (higher utilization)
- Region affinity: prefers same-region node when region is specified

**Resource management flow:**
- `allocateResources` increments usedVcpu, usedMemoryMb, sandboxCount
- `releaseResources` decrements usedVcpu, usedMemoryMb, sandboxCount
- `removeNode` removes from placement pool

#### 1.4 TenantQuotaDO (`tenant-quota.test.ts` -- 9 tests)

**Quota enforcement flow:**
- Allows creation within limits
- Rejects when concurrent sandbox limit reached
- Rejects when vCPU limit exceeded
- Rejects when memory limit exceeded
- Release decrements counters, allowing new sandboxes after release
- Auto-initializes with permissive defaults when not explicitly initialized
- `getQuota` returns current usage state
- Release never goes below zero (safety floor)
- `updateLimits` changes max values without resetting usage

#### 1.5 SandboxTrackerDO (`sandbox-tracker.test.ts` -- 9 tests)

**Sandbox lifecycle flow:**
- `initSandbox` sets status to `provisioning`
- `provision_complete` transitions to `ready`
- `start` transitions `ready -> running` and sets `billingStartedAt`
- `pause` stops billing and accumulates billed time
- `getBillingTotal` calculates running cost in real-time
- `recordExecActivity` resets idle timer alarm to later time
- Invalid transition (`provisioning + start`) returns error
- Uninitialized tracker returns error on transition
- `destroy` from running: stops billing, records billed time, emits release/quota effects

#### 1.6 NodeManagerDO (`node-manager.test.ts` -- 7 tests)

**Command queue flow:**
- `enqueueCommand` stores command with pending status
- `getPendingCommands` returns commands in FIFO order
- `ackCommand` removes from pending list
- `completeCommand` removes from pending list

**Heartbeat/offline detection flow:**
- `handleHeartbeat` sets status to healthy and arms alarm
- Alarm fires after 70s without heartbeat -> marks node `offline`
- Alarm with recent heartbeat (30s ago) -> stays `healthy`

---

### 2. E2E Tests (`test/e2e/`)

All E2E tests run against the full Cloudflare Worker via `@cloudflare/vitest-pool-workers` (miniflare). Auth is disabled (`DISABLE_AUTH=true`).

#### 2.1 Sandbox Lifecycle (`sandbox-lifecycle.test.ts` -- 5 tests)

**Create sandbox flow:**
1. `POST /v1/sandboxes` with `base_image` -> 201, returns `sandbox_id` (prefixed `sbx_`), `status: "provisioning"`

**Full lifecycle flow (create -> ready -> exec -> destroy):**
1. `POST /v1/sandboxes` -> creates sandbox in `provisioning`
2. `POST /v1/internal/nodes/:nodeId/sandbox-events` (node reports `status: "ready"`) -> transitions to `ready`
3. `GET /v1/sandboxes/:id` -> confirms `status: "ready"`
4. `POST /v1/sandboxes/:id/exec` with `{type: "command", command: "echo hello", async: true}` -> 202, returns `exec_id`
5. `POST /v1/internal/nodes/:nodeId/exec-events` (node reports exec completed with stdout/exit_code)
6. `GET /v1/sandboxes/:id/exec/:execId` -> returns completed result with stdout and exit_code
7. `DELETE /v1/sandboxes/:id` -> 204

**List sandboxes:** `GET /v1/sandboxes` -> 200, returns `{sandboxes: [...]}`

**Not found:** `GET /v1/sandboxes/sbx_nonexistent...` -> 404

**Snapshot creation:**
1. Create sandbox
2. `POST /v1/sandboxes/:id/snapshots` with `{name: "test-snapshot"}` -> 201, returns `snapshot_id` (prefixed `snap_`)

#### 2.2 Node Lifecycle (`node-lifecycle.test.ts` -- 5 tests)

**Register node:** `POST /v1/mgmt/nodes` with region/vcpu/memory -> 201, returns `node_id` (prefixed `node_`), `bootstrap_token`, `status: "healthy"`

**List nodes:** `GET /v1/mgmt/nodes` -> 200, returns `{nodes: [...]}`

**Fleet status:** `GET /v1/mgmt/fleet/status` -> 200, returns `{node_count, total_vcpu, ...}`

**Drain node:** Register -> `POST /v1/mgmt/nodes/:id/drain` -> 200, `status: "draining"`

**Delete node:** Register -> `DELETE /v1/mgmt/nodes/:id` -> 204

#### 2.3 Error Flows (`error-flows.test.ts` -- 5 tests)

- `POST /v1/sandboxes` with empty body -> 400 `{error: "invalid_request"}`
- `POST /v1/sandboxes` with `vcpu: 0.1` -> 400
- `DELETE /v1/sandboxes/sbx_nonexistent...` -> 404; `POST .../exec` on nonexistent -> 404
- Double destroy: create sandbox -> destroy -> destroy again -> 409
- Invalid exec (missing `type` field) -> 400

#### 2.4 Webhook Flow (`webhook-flow.test.ts` -- 3 tests)

**Register webhook:** `POST /v1/webhooks` with `{url, events, secret}` -> 201, returns `webhook_id` (prefixed `wh_`)

**List webhooks:** `GET /v1/webhooks` -> 200, returns `{webhooks: [...]}`

**Delete webhook:** Register -> `DELETE /v1/webhooks/:id` -> 204

---

### 3. Deterministic Simulation Tests (`test/dst/`)

DST runs scenarios with seeded PRNG, virtual clock, in-memory storage with fault injection, and checks invariants after every step. Each scenario runs across multiple seeds to explore different random paths.

#### 3.1 Invariants (checked every step across all scenarios)

| Invariant | Rule |
|-----------|------|
| **single-state** | No sandbox tracked in two statuses simultaneously; no duplicate sandbox IDs |
| **no-resurrection** | Once `destroyed`, a sandbox never transitions to another state |
| **quota-consistency** | Active sandbox count per tenant is non-negative and within limits |
| **billing-meter** | `billingStartedAt != null` only when status is `running`; `billingStartedAt == null` when not running |
| **node-failure** | When a node is offline, none of its sandboxes remain in healthy states (`provisioning`, `ready`, `running`, `paused`, `stopping`) |
| **no-double-booking** | Sum of allocated vCPU/memory on a node never exceeds that node's total capacity |

#### 3.2 Scenarios

**happy-path (500 steps)**
Normal lifecycle without faults. 2 nodes, 1 tenant (quota=10).
- 25% chance: create sandbox
- 25% chance: progress sandbox through lifecycle (provisioning->ready->running->paused->running, stopping->stopped->running, error->ready)
- 20% chance: exec activity on a running sandbox (resets idle timer)
- 20% chance: destroy a sandbox
- 10% chance: advance time significantly
- Heartbeats every 10 steps

**node-crash (300 steps)**
Random node crashes mid-operation. 3 nodes, 1 tenant (quota=20).
- 30% chance: create sandbox
- 20% chance: progress lifecycle
- 15% chance: crash a random node (keeps at least one online)
- 15% chance: destroy sandbox
- 20% chance: advance time past heartbeat timeout (30-120s)
- Validates that sandboxes on crashed nodes move to error/destroyed

**concurrent-creates (400 steps)**
5 tenants with small quotas (5 each) creating simultaneously. 2 large nodes.
- 50% chance: random tenant creates sandbox with random resource sizes
- 20% chance: progress lifecycle
- 20% chance: destroy to free quota
- 10% chance: advance time
- Validates quota enforcement under concurrent pressure

**rapid-transitions (500 steps)**
Fast state changes with minimal time between operations. 1 large node, 1 tenant (quota=50).
- 30% chance: create and immediately destroy
- 20% chance: create then run through full lifecycle (provision->exec->stop->stopped->destroy) in one step
- 20% chance: random valid event on random active sandbox
- 30% chance: mass destroy (1-5 sandboxes)
- Validates state machine handles rapid-fire transitions without corruption

**alarm-failure (300 steps)**
DO alarms fail to fire. 1 node, 1 tenant (quota=20). Fault injector active.
- 30% chance: create sandbox
- 20% chance: progress to running (arms idle timers)
- 20% chance: advance time past timeout thresholds (300-700s)
- 15% chance: exec activity to reset idle timers
- Validates graceful degradation when timer alarms are unreliable

**storage-error (200 steps)**
Storage writes fail mid-transaction. 1 node, 1 tenant (quota=15). Fault injector active (1-2% failure rate).
- 35% chance: create sandbox (may fail)
- 25% chance: transition (may fail)
- 20% chance: destroy (may fail)
- 20% chance: advance time
- All mutation operations wrapped in try/catch for expected storage faults
- Validates no state corruption after partial write failures
