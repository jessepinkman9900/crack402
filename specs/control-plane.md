# Control Plane — Architecture & API Design

> Serverless Control Plane + Bare Metal Data Plane for AI Agent Sandboxes

---

## 1. Overview

Two-tier architecture: a fully serverless control plane on Cloudflare (Workers + Durable Objects) orchestrating Firecracker microVMs on bare-metal nodes at Latitude.sh. All traffic is north-south only — nodes connect outbound via Cloudflare Tunnel, no inbound ports anywhere.

| Component | Role |
|---|---|
| API Gateway Worker | Authenticates requests, rate-limits, routes to Durable Objects |
| GlobalSchedulerDO | Fleet-wide capacity view, sandbox placement decisions |
| NodeManagerDO (1 per node) | Command queue + relay for a single bare-metal node |
| SandboxTrackerDO (1 per sandbox) | State machine, TTL timers, billing meter |
| TenantQuotaDO (1 per tenant) | Concurrent sandbox + resource quota enforcement |
| Bare-Metal Node | Latitude.sh AMD SEV — runs node-agent + cloudflared + Firecracker VMs |
| Node Agent | Rust process — receives commands via tunnel, drives Firecracker |
| R2 / KV / D1 | Snapshot storage / fast token lookup / billing records |

---

## 2. API Domains

Four domains. One addition beyond what you listed: **Observability** — billing metering and audit trail are first-class concerns for a payment-native product.

| Domain | Base Path | Audience |
|---|---|---|
| Workload API | `/v1/sandboxes` | AI agents, developers |
| Node API | `/v1/internal/nodes` | Node agent (machine-to-machine) |
| Management API | `/v1/mgmt` | Terraform, Ansible, operators |
| Observability API | `/v1/obs` | Dashboards, billing pipeline |

---

## 3. Workload API

### 3.1 Sandbox Lifecycle

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/sandboxes` | Create sandbox (returns 402 if payment required) |
| `GET` | `/v1/sandboxes` | List sandboxes — filter by status, metadata, agent_id |
| `GET` | `/v1/sandboxes/{id}` | Get sandbox status and resource detail |
| `DELETE` | `/v1/sandboxes/{id}` | Destroy sandbox, release VM |
| `GET` | `/v1/sandboxes/{id}/wait` | Long-poll until sandbox reaches a target state |
| `POST` | `/v1/sandboxes/{id}/start` | Start a stopped or paused sandbox |
| `POST` | `/v1/sandboxes/{id}/stop` | Graceful stop (SIGTERM/SIGKILL + grace period) |
| `POST` | `/v1/sandboxes/{id}/pause` | Freeze VM in memory (Firecracker snapshot-based) |

**State machine:**
```
provisioning → ready → running ↔ paused
                          ↓          ↓
                       stopping → stopped → destroyed

Any state → error | destroyed
```

**Key create fields:**

| Field | Notes |
|---|---|
| `base_image` | OCI image ref or template ID |
| `vcpu` / `memory_mb` | Maps directly to Firecracker VM config |
| `timeout_seconds` | Hard TTL — SandboxTrackerDO fires destroy after this |
| `idle_timeout_seconds` | Auto-pause or destroy after N seconds of no exec activity |
| `network_policy` | `none` \| `outbound-only` \| `full` |
| `payment` | x402 proof, api_key billing, or prepaid credits |
| `metadata` | `agent_id`, `session_id`, `purpose` — filtering + billing attribution |
| `github_repo` | Clone a repo into `/workspace` on boot |
| `code` + `language` | Execute inline code immediately after boot |

---

### 3.2 Execution

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/sandboxes/{id}/exec` | Execute code or command (sync, async, or SSE streaming) |
| `GET` | `/v1/sandboxes/{id}/exec/{exec_id}` | Poll result of async execution |
| `POST` | `/v1/sandboxes/{id}/exec/{exec_id}/cancel` | Cancel a running async execution |

**Modes:**

| Mode | Behaviour |
|---|---|
| Sync (default) | Blocks until exit. Returns stdout, stderr, exit_code, duration_ms |
| Async (`async: true`) | Returns 202 + exec_id immediately. Client polls GET |
| Streaming (`Accept: text/event-stream`) | SSE events: `stdout` \| `stderr` \| `exit` \| `artifact` |

**Exec types:** `code` (inline + language), `command` (shell string or argv array), `file` (path in sandbox + args)

---

### 3.3 File Operations

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/sandboxes/{id}/files` | Write a file |
| `GET` | `/v1/sandboxes/{id}/files/{path}` | Read a file (base64 for binary) |
| `DELETE` | `/v1/sandboxes/{id}/files/{path}` | Delete a file |
| `GET` | `/v1/sandboxes/{id}/files/list` | List directory (recursive option) |
| `POST` | `/v1/sandboxes/{id}/files/upload` | Multipart upload for large/binary files |
| `GET` | `/v1/sandboxes/{id}/files/download` | R2 pre-signed download URL |

Large files bypass the Worker: node agent gets an R2 pre-signed URL, client uploads/downloads directly to object storage, node mounts into VM.

---

### 3.4 Snapshots

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/sandboxes/{id}/snapshots` | Full Firecracker snapshot (memory + disk) |
| `GET` | `/v1/snapshots` | List all snapshots for the tenant |
| `GET` | `/v1/snapshots/{snapshot_id}` | Snapshot metadata |
| `DELETE` | `/v1/snapshots/{snapshot_id}` | Delete snapshot, free R2 storage |
| `POST` | `/v1/sandboxes/from-snapshot` | Fork a new sandbox from a snapshot |

Snapshots are node-independent — stored in R2. Scheduler prefers the last-known node for restores (rootfs cache locality), falls back to any node.

---

### 3.5 Networking & Ports

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/sandboxes/{id}/ports` | List exposed ports and their Cloudflare Tunnel URLs |
| `POST` | `/v1/sandboxes/{id}/ports/{port}/expose` | Expose an additional port at runtime |

Port exposure works by instructing cloudflared on the node to open an ingress route. No bare-metal firewall rules or public IPs needed.

---

### 3.6 Webhooks

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/webhooks` | Register a webhook |
| `GET` | `/v1/webhooks` | List registered webhooks |
| `DELETE` | `/v1/webhooks/{id}` | Unregister a webhook |

Events: `sandbox.created` `sandbox.ready` `sandbox.started` `sandbox.stopped` `sandbox.paused` `sandbox.destroyed` `sandbox.error` `sandbox.timeout` `exec.started` `exec.completed` `exec.failed`

Delivered via Cloudflare Queues → Workers. HMAC-signed payload.

---

### 3.7 x402 Payment Flow

```
1. Agent → POST /v1/sandboxes  (no payment header)
2. Control plane → 402  with X-Payment-Amount, X-Payment-Asset (USDC),
                         X-Payment-Network (base), X-Payment-Recipient
3. Agent signs + submits on-chain transaction, gets payment proof
4. Agent retries POST with X-Payment-Signature: <proof>
5. x402 verifier Worker validates proof against chain
6. Sandbox provisioned, billing meter starts in SandboxTrackerDO
```

All three methods supported: `x402` | `api_key_billing` | `prepaid_credits`

---

## 4. Node API (Internal — Machine-to-Machine)

Called exclusively by the node agent. Auth via per-node mTLS cert provisioned at Ansible bootstrap. Separate Worker route `/v1/internal/nodes`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/internal/nodes/{id}/heartbeat` | Periodic health ping with capacity snapshot |
| `POST` | `/v1/internal/nodes/{id}/sandbox-events` | Report sandbox state transitions |
| `POST` | `/v1/internal/nodes/{id}/exec-events` | Stream exec stdout/stderr/exit to control plane |
| `GET` | `/v1/internal/nodes/{id}/commands` | Long-poll for pending commands |
| `POST` | `/v1/internal/nodes/{id}/commands/{cmd_id}/ack` | Acknowledge command receipt |
| `POST` | `/v1/internal/nodes/{id}/commands/{cmd_id}/result` | Report command completion/failure |

**Heartbeat payload:** `node_id`, `timestamp`, `total_vcpu`, `used_vcpu`, `total_memory_mb`, `used_memory_mb`, `sandbox_count`, `sandbox_ids[]`, `firecracker_version`, `disk_free_gb`, `status` (`healthy` | `degraded` | `draining` | `offline`)

**Command dispatch is pull-based.** Node agents long-poll `GET /commands`. NodeManagerDO enqueues; agent fetches, acks, executes, posts result. Avoids inbound connections while still getting low-latency delivery via the persistent tunnel.

**Command types:** `create_sandbox` `destroy_sandbox` `pause_sandbox` `resume_sandbox` `snapshot_sandbox` `restore_snapshot` `exec` `update_tunnel` `drain`

---

## 5. Management API (Operator — IaC Driven)

Consumed by Terraform and Ansible, not humans. Operator-scoped API keys, separate from tenant keys.

### Node Lifecycle

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/mgmt/nodes` | Register a new node (Terraform calls this on provision) |
| `GET` | `/v1/mgmt/nodes` | List all nodes with health status |
| `GET` | `/v1/mgmt/nodes/{id}` | Node detail: capacity, live sandboxes, last heartbeat |
| `PATCH` | `/v1/mgmt/nodes/{id}` | Update metadata, region tags, capacity overrides |
| `DELETE` | `/v1/mgmt/nodes/{id}` | Deregister (safe only when sandbox_count = 0) |
| `POST` | `/v1/mgmt/nodes/{id}/drain` | Stop new sandbox placement on this node |
| `POST` | `/v1/mgmt/nodes/{id}/undrain` | Re-enable scheduling |
| `POST` | `/v1/mgmt/nodes/{id}/cordon` | Hard cordon: no new sandboxes + no traffic |
| `POST` | `/v1/mgmt/nodes/{id}/rotate-token` | Rotate node agent auth token |

### Fleet Configuration

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/mgmt/fleet/status` | Aggregated fleet: total/used capacity, node count |
| `GET/PUT` | `/v1/mgmt/fleet/scheduler-config` | Read/update scheduler policy |
| `GET/POST` | `/v1/mgmt/fleet/images` | List or register VM base images (rootfs in R2) |
| `DELETE` | `/v1/mgmt/fleet/images/{id}` | Remove a VM image |

### Tenant Management

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/mgmt/tenants` | Create tenant, issue API key |
| `GET/PATCH/DELETE` | `/v1/mgmt/tenants/{id}` | Read, update quotas, or suspend tenant |
| `POST` | `/v1/mgmt/tenants/{id}/api-keys` | Issue new API key |
| `DELETE` | `/v1/mgmt/tenants/{id}/api-keys/{key_id}` | Revoke API key |

### IaC Flow

```
1. Terraform provisions bare-metal server on Latitude.sh
2. Terraform → POST /v1/mgmt/nodes  →  receives node_id + bootstrap_token
3. Ansible bootstraps node: installs cloudflared + node-agent,
   writes node_id + token to /etc/node-agent/config
4. Node agent starts, establishes outbound tunnel, begins heartbeating
5. wrangler.toml keeps all Worker routes + KV/D1/R2/Queue bindings in version control
6. Deprovisioning: POST /drain → wait sandbox_count=0 → DELETE node → destroy server
```

---

## 6. Observability API

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/obs/events` | Query structured events with filters |
| `GET` | `/v1/obs/events/stream` | SSE stream of real-time events |
| `GET` | `/v1/obs/billing/usage` | Tenant usage: vCPU-seconds, memory-GB-seconds, exec count |
| `GET` | `/v1/obs/billing/invoices` | List billing periods |
| `GET` | `/v1/obs/billing/invoices/{id}` | Invoice detail with line items |
| `GET` | `/v1/obs/audit` | Audit log: who called what, when, from where |
| `GET` | `/v1/obs/fleet/metrics` | Fleet metrics: utilisation, scheduling latency, error rates |
| `GET` | `/v1/obs/fleet/nodes/{id}/metrics` | Per-node metrics timeseries |

**Event fields:** `event_id`, `event_type`, `timestamp`, `tenant_id`, `sandbox_id`, `node_id`, `payload`, `request_id`, `duration_ms`, `cost_usd`

---

## 7. Durable Object Responsibilities

| DO | Scale | Owns |
|---|---|---|
| GlobalSchedulerDO | 1 global | Fleet index, bin-pack / spread placement. Single writer prevents double-booking. |
| NodeManagerDO | 1 per node | Command queue, heartbeat alarm, marks node offline after N missed pings, forwards sandbox events. |
| SandboxTrackerDO | 1 per sandbox | State machine, `timeout_seconds` and `idle_timeout_seconds` timers, billing meter (vCPU-seconds). Resets idle timer on every exec event. |
| TenantQuotaDO | 1 per tenant | Concurrent sandbox limit + resource quota. Incremented on create, decremented on destroy. No DB round-trip. |

---

## 8. Security

**Auth layers:**

| Actor | Mechanism |
|---|---|
| Agent / developer | Bearer token or `X-API-Key`. Validated in API Gateway Worker via KV lookup. |
| Node agent | Per-node mTLS cert (CN = node_id). Provisioned by Ansible. |
| Operator / IaC | Separate operator-scoped API key. Never shared with tenant keys. |
| x402 payment | `X-Payment-Signature` verified against on-chain proof by verifier Worker. |

**Network isolation:**
- No inbound ports on bare-metal. All control traffic outbound through Cloudflare Tunnel.
- VMs communicate via vsock → node agent → tunnel only. No public IPs on VMs.
- `network_policy=none`: no virtual NIC (air-gapped).
- `network_policy=outbound-only`: TAP interface + iptables blocking inbound.
- `network_policy=full`: ports exposed via cloudflared ingress routes at Cloudflare URLs.

**VM isolation:** Each sandbox is an independent Firecracker microVM. AMD SEV encrypts memory per VM. Rootfs is read-only overlayfs; writes go to ephemeral scratch disk destroyed on sandbox delete.

---

## 9. Key Data Flows

### Create Sandbox (Happy Path)
```
1.  Agent → POST /v1/sandboxes  (with payment)
2.  API Gateway Worker: auth + quota check (TenantQuotaDO) + payment verify
3.  GlobalSchedulerDO: bin-pack selection → node_id
4.  SandboxTrackerDO: created, state=provisioning, timers armed
5.  NodeManagerDO[node_id]: enqueue create_sandbox command
6.  Node Agent: long-polls GET /commands, receives create_sandbox
7.  Node Agent: boots Firecracker VM, waits for guest ready via vsock
8.  Node Agent: POST /sandbox-events {state: ready}
9.  NodeManagerDO → SandboxTrackerDO: state=ready
10. SandboxTrackerDO: write to D1, emit sandbox.ready webhook via Queue
11. If client is polling /wait?state=ready → respond with Sandbox object
```

### Node Failure Detection
```
1.  NodeManagerDO alarm fires after heartbeat_interval * 2 (e.g. 60s)
2.  Node marked offline, removed from GlobalSchedulerDO placement pool
3.  All SandboxTrackerDOs on that node → state=error, reason=node_unreachable
4.  Webhooks fired: sandbox.error for each affected sandbox
5.  Billing meters stopped at last confirmed heartbeat timestamp
6.  On recovery: heartbeat re-establishes alarm chain, node back in pool
```

---

## 10. Additional Notes

**Scheduling strategies** (configurable via Management API): bin-pack (cost), spread (reliability), region-affinity (data residency), node-affinity (snapshot locality).

**Snapshot locality**: SandboxTrackerDO tracks last-known node. Scheduler prefers it for from-snapshot restores. R2 is the durable fallback.

**Idle timeout**: SandboxTrackerDO resets idle timer on every exec event. When it fires: pause (if `auto_pause_on_idle=true`) or destroy. Primary cost-control lever for agent workloads that forget to clean up.

**Worker CPU limits**: Exec operations that exceed 30s use the async pattern (202 + polling). SSE streaming proxies stdout/stderr from node agent through tunnel in real-time — no CPU budget consumed waiting.

**Rollout**: All Workers deployed via Wrangler in CI/CD. Node agent rolled via drain → update → undrain. No manual steps anywhere.

