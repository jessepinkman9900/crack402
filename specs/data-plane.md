# Node Agent Specification

> The node agent is the sole process on a bare-metal host that bridges the Cloudflare control plane and the Firecracker VMs running on that host. It is written in Rust, runs as a systemd service, and is deployed and configured entirely via Ansible. No manual setup.

---

## 1. Responsibilities

The node agent owns exactly four things:

1. **Heartbeat** — report host capacity and live sandbox state to the control plane on a fixed interval
2. **Command execution** — long-poll the control plane for pending commands and execute them (create VM, destroy VM, exec, snapshot, etc.)
3. **vsock bridge** — proxy exec requests and stream stdout/stderr between the control plane and the guest agent running inside each Firecracker VM
4. **Tunnel management** — instruct cloudflared to expose or unexpose VM ports at runtime

It does not schedule, route, or make placement decisions. Those live in the GlobalSchedulerDO. The node agent is purely an executor.

---

## 2. Process Model

```
systemd
  └── node-agent  (single process, async Rust / tokio)
        ├── heartbeat loop          (interval tick)
        ├── command poller          (long-poll HTTP loop)
        ├── vsock listener          (AF_VSOCK server, one thread per VM)
        ├── cloudflared mgmt client (unix socket to cloudflared)
        └── metrics exporter        (Prometheus HTTP :9090)
```

One process. No child processes spawned by node-agent itself — Firecracker VMMs are launched as independent processes managed by the agent via the Firecracker HTTP API on a per-VM unix socket.

---

## 3. Configuration

Delivered by Ansible at bootstrap. Written to `/etc/node-agent/config.toml`. Never edited manually.

```toml
[identity]
node_id       = "node_abc123"          # assigned by control plane at registration
region        = "us-east-1"
latitude_site = "ASH"

[control_plane]
base_url      = "https://internal.api.example.com"   # Workers internal route
auth_token    = "<mTLS token rotated by /rotate-token>"
poll_interval_ms  = 2000
heartbeat_interval_s = 15

[firecracker]
binary_path   = "/usr/bin/firecracker"
jailer_path   = "/usr/bin/jailer"
rootfs_base   = "/var/lib/node-agent/images"     # local image cache
vm_socket_dir = "/run/node-agent/vms"            # per-VM unix sockets
vsock_cid_start = 3                              # CIDs allocated from here up
tap_bridge     = "br0"

[snapshots]
r2_bucket     = "sandbox-snapshots"
r2_endpoint   = "https://<accountid>.r2.cloudflarestorage.com"
local_cache_dir = "/var/lib/node-agent/snapshot-cache"
local_cache_max_gb = 50

[cloudflared]
admin_socket  = "/run/cloudflared/admin.sock"    # cloudflared management API

[metrics]
listen_addr = "127.0.0.1:9090"
```

All secrets (auth_token, R2 credentials) are written by Ansible from Vault. The config file is `0600 root:root`.

---

## 4. Authentication

The node agent authenticates to the control plane using a **per-node token** issued at registration via `POST /v1/mgmt/nodes`. The token is sent as `Authorization: Bearer <token>` on every outbound request to the control plane.

Token rotation is triggered by the control plane via the `rotate_token` command. The agent applies the new token atomically — it continues using the old token until it receives and acks the rotation command, then switches and persists the new token to config.

---

## 5. Heartbeat Loop

Fires every `heartbeat_interval_s` (default 15s). Posts to `POST /v1/internal/nodes/{node_id}/heartbeat`.

**Payload:**

```json
{
  "node_id": "node_abc123",
  "timestamp": "2026-03-04T12:00:00Z",
  "status": "healthy",
  "total_vcpu": 128,
  "used_vcpu": 24,
  "total_memory_mb": 262144,
  "used_memory_mb": 49152,
  "disk_free_gb": 840,
  "sandbox_count": 6,
  "sandbox_ids": ["sbx_aaa", "sbx_bbb", "sbx_ccc"],
  "firecracker_version": "1.7.0",
  "kernel_version": "6.1.102",
  "agent_version": "0.4.1"
}
```

The control plane's NodeManagerDO resets a watchdog alarm on every heartbeat. If the alarm fires (no heartbeat for `heartbeat_interval_s * 4`), the node is marked offline and removed from the scheduler pool.

**Status values:** `healthy` | `degraded` | `draining` | `offline`

The agent sets `degraded` if: disk free < 10 GB, used_vcpu > 95% of total, or any VM is in an error state. It sets `draining` when it receives a `drain` command and is winding down existing sandboxes.

---

## 6. Command Poller

The agent long-polls `GET /v1/internal/nodes/{node_id}/commands` with a 30s timeout. On receiving commands, it acks each one immediately (`POST .../commands/{cmd_id}/ack`), executes, then posts the result (`POST .../commands/{cmd_id}/result`).

Commands are processed concurrently up to a configurable limit (default: 8 concurrent command workers). Long-running commands (exec, snapshot) run on dedicated workers; fast commands (destroy, pause) get immediate workers.

### 6.1 Command Types

#### `create_sandbox`

```json
{
  "type": "create_sandbox",
  "sandbox_id": "sbx_aaa",
  "vcpu": 2,
  "memory_mb": 4096,
  "base_image": "python:3.12-slim",
  "rootfs_snapshot_id": null,
  "env_vars": { "API_KEY": "..." },
  "network_policy": "outbound-only",
  "timeout_seconds": 3600,
  "metadata": { "agent_id": "agt_xyz" }
}
```

Execution steps:
1. Pull or verify rootfs image from local cache (fetch from R2 if not cached)
2. Allocate vsock CID (next available from `vsock_cid_start`)
3. Write Firecracker VM config JSON to a temp file
4. Launch `firecracker --api-sock /run/node-agent/vms/{sandbox_id}.sock`
5. PUT `/machine-config`, PUT `/boot-source`, PUT `/drives/rootfs`, PUT `/vsock` to Firecracker API
6. If `network_policy != none`: create TAP interface, PUT `/network-interfaces/eth0`
7. PUT `/actions {"action_type": "InstanceStart"}` — boots the VM
8. Wait for guest agent ready signal on vsock (max 30s; fail if timeout)
9. POST result: `{status: "ok", vsock_cid: 4, started_at: "..."}`

**Error handling:** If any step fails, attempt to kill the Firecracker process, clean up the tap interface, free the CID, and POST result `{status: "error", error: "..."}`. Never leave a partial VM alive.

#### `destroy_sandbox`

```json
{
  "type": "destroy_sandbox",
  "sandbox_id": "sbx_aaa",
  "force": false
}
```

Steps:
1. If `force=false`: send SIGTERM to guest via vsock, wait up to `grace_period_seconds` (default 10s)
2. DELETE to Firecracker API (or SIGKILL the process if API unresponsive)
3. Remove TAP interface and iptables rules
4. Free vsock CID
5. Delete VM socket file and working directory
6. POST result: `{status: "ok"}`

#### `pause_sandbox`

Uses Firecracker's snapshot API to freeze the VM in memory:
1. PUT `/vm` `{"state": "Paused"}` to Firecracker API
2. POST result: `{status: "ok"}`

Resume via `resume_sandbox`: PUT `/vm` `{"state": "Resumed"}`

#### `snapshot_sandbox`

```json
{
  "type": "snapshot_sandbox",
  "sandbox_id": "sbx_aaa",
  "snapshot_id": "snap_zzz",
  "r2_path": "snapshots/snap_zzz/"
}
```

Steps:
1. Pause the VM (PUT `/vm` `{"state": "Paused"}`)
2. Create Firecracker snapshot: PUT `/snapshot/create` `{"snapshot_type": "Full", "snapshot_path": "/tmp/...", "mem_file_path": "/tmp/..."}`
3. Resume the VM (PUT `/vm` `{"state": "Resumed"}`)
4. Upload both snapshot files to R2 (`r2_path/snapshot` and `r2_path/mem`)
5. Delete local temp files
6. POST result: `{status: "ok", size_bytes: 1234567}`

Snapshot is non-interrupting by default (VM resumes during upload). The local snapshot-cache directory (`local_cache_dir`) retains a copy for fast restore locality.

#### `restore_snapshot`

```json
{
  "type": "restore_snapshot",
  "sandbox_id": "sbx_bbb",
  "snapshot_id": "snap_zzz",
  "r2_path": "snapshots/snap_zzz/",
  "vcpu": 2,
  "memory_mb": 4096
}
```

Steps:
1. Check local snapshot cache; download from R2 if not cached
2. Launch Firecracker and load snapshot: PUT `/snapshot/load`
3. Resume: PUT `/vm` `{"state": "Resumed"}`
4. Wait for guest agent ready on vsock
5. POST result: `{status: "ok", vsock_cid: 5}`

#### `exec`

```json
{
  "type": "exec",
  "sandbox_id": "sbx_aaa",
  "exec_id": "exec_111",
  "exec_type": "command",
  "command": ["python", "-c", "print('hello')"],
  "working_dir": "/workspace",
  "env_vars": {},
  "timeout_seconds": 30,
  "stdin": null,
  "stream": true
}
```

Steps:
1. Look up vsock CID for `sandbox_id`
2. Open vsock connection to the guest agent (AF_VSOCK, CID, port 1000)
3. Send exec request as JSON frame
4. If `stream=true`: forward stdout/stderr chunks to `POST /v1/internal/nodes/{id}/exec-events` in real-time
5. On exit: POST final exec result to `/exec-events` with `exit_code`, `duration_ms`

The guest agent inside the VM handles process spawning. The node agent is only a vsock proxy — it does not exec directly on the host.

#### `update_tunnel`

```json
{
  "type": "update_tunnel",
  "action": "expose",
  "sandbox_id": "sbx_aaa",
  "port": 8080,
  "protocol": "http"
}
```

Calls the cloudflared management API via unix socket to add or remove an ingress rule mapping a public Cloudflare hostname to `127.0.0.1:{guest_port_via_tap}`. Posts result with the public URL assigned.

#### `drain`

Marks the node as draining. The agent:
1. Sets internal `draining=true` flag
2. Starts reporting `status: "draining"` in heartbeats
3. Rejects new `create_sandbox` commands (returns error immediately)
4. Waits for all live VMs to finish and be destroyed
5. Once `sandbox_count=0`, posts a `drain_complete` event

#### `rotate_token`

```json
{
  "type": "rotate_token",
  "new_token": "<new bearer token>"
}
```

Agent atomically writes new token to config file, switches to using it, acks the command.

---

## 7. vsock Bridge

The node agent runs an `AF_VSOCK` server bound to CID `VMADDR_CID_HOST` (2). Each VM's guest agent connects to this on a well-known port (default: 9999) to register itself as ready.

For exec operations, the direction reverses: the node agent opens an outbound vsock connection to the guest agent (CID = VM's CID, port = 1000) and sends a framed JSON request.

**Wire format — request frame:**
```
[4 bytes: length as u32 big-endian][JSON payload]
```

**Wire format — response stream:**
```
[1 byte: frame_type][4 bytes: length][payload]

frame_type:
  0x01 = stdout chunk  (payload: utf-8 bytes)
  0x02 = stderr chunk  (payload: utf-8 bytes)
  0x03 = exit          (payload: {"exit_code": 0, "duration_ms": 123})
  0x04 = error         (payload: {"message": "..."})
```

The node agent buffers up to 64 KB of output per stream before flushing to the control plane. This prevents head-of-line blocking on slow network links to the control plane.

---

## 8. Guest Agent (Inside VM)

The guest agent is a small binary bundled into every rootfs image. It is not the node agent — it is the in-VM counterpart.

Responsibilities:
- On boot: connect to host vsock (CID 2, port 9999) and send a `ready` signal
- Listen on vsock port 1000 for exec requests from the node agent
- Spawn processes, stream stdout/stderr back over vsock
- Report exit code and duration on process exit

The guest agent runs as PID 1 (or is started by init) to ensure it is always available before any exec requests arrive. It does not have any network access to the internet — all I/O goes through vsock to the node agent.

---

## 9. Firecracker VM Lifecycle (Internal State)

The node agent maintains an in-memory map of live VMs:

```rust
struct VmEntry {
    sandbox_id: String,
    pid: u32,                     // Firecracker process PID
    api_socket: PathBuf,          // unix socket for Firecracker API
    vsock_cid: u32,
    tap_interface: Option<String>,
    state: VmState,
    created_at: Instant,
    last_exec_at: Option<Instant>,
}

enum VmState {
    Booting,
    Ready,
    Running,
    Paused,
    Stopping,
    Stopped,
    Error(String),
}
```

This map is in-memory only. On agent restart, the agent reconciles by:
1. Scanning for live Firecracker processes (`/run/node-agent/vms/*.sock`)
2. Querying each via the Firecracker API to get state
3. Rebuilding the map
4. Sending a reconcile report in the next heartbeat so the control plane can diff against its expected state

---

## 10. Error Handling & Fault Tolerance

| Scenario | Behaviour |
|---|---|
| Firecracker process crashes | Agent detects via SIGCHLD, marks VM as error, reports to control plane via sandbox-events, cleans up resources |
| vsock connection lost | Agent retries exec 3 times with backoff; on final failure posts exec error event |
| Control plane unreachable | Agent continues operating. Heartbeats queue in memory (last 10 dropped gracefully). Commands already acked will be retried at result-post time |
| Agent crash/restart | On restart: reconcile live VMs, resume heartbeating, re-join command poll loop. No VMs are killed on agent restart |
| R2 upload failure (snapshot) | Retry 3x with exponential backoff. If all fail, post snapshot error, resume VM, clean up local temp files |
| Guest agent never sends ready | Boot timeout (30s default). Destroy VM, post create error. Log Firecracker console output for debugging |
| Node running out of disk | Heartbeat sets `degraded`. Agent refuses new `create_sandbox` commands if disk < 5 GB free |

---

## 11. Logging & Metrics

**Logs:** Structured JSON to stdout. Collected by the host's log shipper (Vector → Cloudflare Logpush or S3). Every log line includes `node_id`, `sandbox_id` (when relevant), `exec_id` (when relevant), and a `request_id` correlating back to the originating control plane call.

**Metrics (Prometheus on :9090):**

| Metric | Type | Description |
|---|---|---|
| `node_agent_sandboxes_total` | Gauge | Live VM count |
| `node_agent_vcpu_used` | Gauge | vCPUs currently allocated |
| `node_agent_memory_used_mb` | Gauge | Memory currently allocated |
| `node_agent_command_duration_ms` | Histogram | Time to execute each command type |
| `node_agent_exec_duration_ms` | Histogram | Wall-clock time per exec |
| `node_agent_heartbeat_failures_total` | Counter | Failed heartbeat POSTs |
| `node_agent_vsock_errors_total` | Counter | vsock communication errors |
| `node_agent_boot_duration_ms` | Histogram | Time from create_sandbox command to guest-ready |

---

## 12. IaC Integration

### Ansible Role

The `node-agent` Ansible role does:

```
1. Copy node-agent binary to /usr/bin/node-agent
2. Write /etc/node-agent/config.toml from template (vars from Vault)
3. Write /etc/systemd/system/node-agent.service
4. systemctl daemon-reload && systemctl enable --now node-agent
5. Wait for first heartbeat to appear in control plane health endpoint
```

**systemd unit:**

```ini
[Unit]
Description=Node Agent
After=network-online.target cloudflared.service
Wants=network-online.target
Requires=cloudflared.service

[Service]
ExecStart=/usr/bin/node-agent --config /etc/node-agent/config.toml
Restart=always
RestartSec=5
User=root
LimitNOFILE=65536
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

Root is required to create TAP interfaces, set iptables rules, and access vsock devices. A future hardening pass can use Linux capabilities instead (`CAP_NET_ADMIN`, `CAP_SYS_PTRACE`).

### Terraform

Terraform calls `POST /v1/mgmt/nodes` after server provisioning completes and passes the returned `node_id` and `bootstrap_token` as instance metadata, which Ansible reads during bootstrap.

```hcl
resource "latitudesh_server" "node" {
  # ... server config
}

resource "null_resource" "register_node" {
  triggers = { server_id = latitudesh_server.node.id }

  provisioner "local-exec" {
    command = <<EOF
      curl -s -X POST ${var.control_plane_url}/v1/mgmt/nodes \
        -H "Authorization: Bearer ${var.operator_token}" \
        -d '{"server_id": "${latitudesh_server.node.id}", "region": "${var.region}"}' \
        | tee /tmp/node-registration.json
    EOF
  }
}
```

### Node Agent Update Flow

Rolling update via Ansible:

```
1. POST /v1/mgmt/nodes/{id}/drain  — stop new sandbox placement
2. Wait until sandbox_count = 0    — poll /v1/mgmt/nodes/{id}
3. ansible-playbook update-agent.yml --limit {node}
4. POST /v1/mgmt/nodes/{id}/undrain — re-enable scheduling
```

---

## 13. Security Hardening

- Binary is a single static Rust executable with no external library dependencies
- Config file is `0600 root:root`. Secrets never logged
- vsock is host-kernel-only — VMs cannot reach each other or external hosts via vsock
- Firecracker processes are launched with the jailer (`/usr/bin/jailer`) — chroot, cgroup isolation, seccomp filter
- TAP interfaces use separate network namespaces per VM for `network_policy=none` and `outbound-only`
- Node agent does not listen on any TCP/UDP port accessible from outside the host — only vsock and the local Prometheus exporter on loopback
- Outbound connections: only to Cloudflare (via cloudflared tunnel) and R2 (for snapshots)

---

## 14. Open Questions

- **Image caching strategy:** LRU eviction on `rootfs_base`? Pre-warm popular images on new node registration?
- **Jailer vs. no jailer:** Jailer adds ~50ms to boot time. Worth the tradeoff for the added isolation?
- **Guest agent init:** PID 1 vs sidecar started by init. PID 1 is simpler but requires the rootfs image to be built with it. Init approach is more flexible but adds complexity.
- **Concurrent exec per sandbox:** Spec allows one exec at a time per sandbox (control plane enforces). Should the agent enforce this too as a belt-and-suspenders check?
- **Log collection:** Vector sidecar on each node vs journald + a Cloudflare Logpush integration. Vector is more flexible but another service to manage.
