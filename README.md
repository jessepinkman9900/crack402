# crack402

host your own agent sandbox env using latitube baremetal vm with a control plane deployed on cloudflare workers


## Status
- [x] Terraform to provision clusters
    - [ ] Firecracker setup on provisioned nodes
- [ ] Scheduling system for placing workloads across the cluster
- [ ] x402 payment integration

## Design
```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent Clients                         │
│              (x402 payment in X-PAYMENT header)             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│              Cloudflare Workers (API Gateway)               │
│  • x402 signature verification (viem, ~2ms CPU)             │
│  • Route to SchedulerDO or fan-out to NodeDOs               │
│  • Rate limiting via Workers Rate Limiting binding          │
└──┬──────────┬────────────┬──────────┬───────────────────────┘
   │          │            │          │
   ▼          ▼            ▼          ▼
┌──────┐ ┌────────┐ ┌──────────┐ ┌─────────────────────┐
│  KV  │ │Queues  │ │ D1/Hyper │ │   Durable Objects   │
│      │ │        │ │ drive    │ │                     │
│Node  │ │Exec    │ │Billing & │ │SchedulerDO (1)      │
│Regis-│ │dispatch│ │audit logs│ │NodeDO (per node)    │
│try   │ │+ DLQ   │ │          │ │SandboxDO (per VM)   │
└──────┘ └────┬───┘ └──────────┘ └─────┬───────────────┘
              │                        │
              │         WebSocket / Cloudflare Tunnel
              │                        │
┌─────────────▼────────────────────────▼──────────────────────┐
│           Bare Metal Nodes (Latitude.sh)                    │
│  • cloudflared tunnel agent                                 │
│  • Node agent (Rust HTTP server)                            │
│  • Firecracker microVM fleet + warm pool                    │
│  • Pulls rootfs from R2 via S3 API                          │
└─────────────────────────────────────────────────────────────┘
```
