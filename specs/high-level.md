


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


┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLOUDFLARE EDGE                                    │
│                                                                             │
│   AI Agent ──POST /run──► Worker                                            │
│                              │                                              │
│                              │ assign job                                   │
│                              ▼                                              │
│                    ┌─────────────────┐   /heartbeat    ┌────────────────┐   │
│                    │  NodeRegistry   │◄────────────────│  Node Agents   │   │
│                    │  Durable Object │                 │  (all nodes)   │   │
│                    │                 │                 └────────────────┘   │
│                    │  node-a: 3 free │                                      │
│                    │  node-b: 0 free │                                      │
│                    │  node-c: 7 free │                                      │
│                    └────────┬────────┘                                      │
│                             │ pick node-c                                   │
│                             │ fetch tunnel URL                              │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
                              │ HTTPS (through Cloudflare network)
                              │
┌─────────────────────────────┼───────────────────────────────────────────────┐
│  cloudflared tunnel         │                          NODE C               │
│                             ▼                                               │
│                    ┌─────────────────┐                                      │
│                    │   Node Agent    │                                      │
│                    │   :8080         │                                      │
│                    │                 │                                      │
│                    │  pool:          │                                      │
│                    │  [vm1 READY]    │                                      │
│                    │  [vm2 BUSY ]    │                                      │
│                    │  [vm3 READY] ◄──┼── acquire vm3                        │
│                    │  [vm4 READY]    │                                      │
│                    └────────┬────────┘                                      │
│                             │                                               │
│                             │ inject job via vsock                          │
│                             ▼                                               │
│              ┌──────────────────────────────┐                               │
│              │   Firecracker microVM (vm3)  │                               │
│              │                              │                               │
│              │   ┌──────────────────────┐   │                               │
│              │   │   in-VM agent        │   │                               │
│              │   │                      │   │                               │
│              │   │  recv job via vsock  │   │                               │
│              │   │  exec: python run.py │   │                               │
│              │   │  stdout: "2\n"       │   │                               │
│              │   │  send result         │   │                               │
│              │   └──────────────────────┘   │                               │
│              └──────────────┬───────────────┘                               │
│                             │                                               │
│                             │ result via vsock                              │
│                             ▼                                               │
│                    ┌─────────────────┐                                      │
│                    │   Node Agent    │  restore vm3 from snapshot           │
│                    │                 │──────────────────► [vm3 READY]       │
│                    └────────┬────────┘                                      │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
                              │ { output: "2\n", exit_code: 0, duration_ms: 43 }
                              │
┌─────────────────────────────┼───────────────────────────────────────────────┐
│  CLOUDFLARE EDGE            │                                               │
│                             ▼                                               │
│                          Worker ──────────────────────────► AI Agent        │
└─────────────────────────────────────────────────────────────────────────────┘
