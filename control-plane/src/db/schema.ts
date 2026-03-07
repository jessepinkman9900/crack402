import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// SSH Keys table - managed by Drizzle ORM
export const sshKeys = sqliteTable(
  "ssh_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_ssh_keys_user_id").on(table.userId),
    fingerprintIdx: index("idx_ssh_keys_fingerprint").on(table.fingerprint),
  })
);

// Bots table - managed by Drizzle ORM
export const bots = sqliteTable(
  "bots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["stopped", "provisioning", "running", "deleting", "deleted"] })
      .notNull()
      .default("stopped"),
    provisioningStatus: text("provisioning_status", {
      enum: ["pending_openrouter", "pending_vm", "pending_setup", "ready", "failed"],
    }),
    botType: text("bot_type", { enum: ["standard", "gateway"] })
      .notNull()
      .default("standard"),
    version: text("version").notNull().default("1.0.0"),
    provider: text("provider").notNull(),
    region: text("region").notNull(),
    serverType: text("server_type").notNull().default("cx23"),
    serverId: text("server_id"),
    ipAddress: text("ip_address"),
    openrouterKeyId: text("openrouter_key_id"),
    openrouterKey: text("openrouter_key"),
    channelConfig: text("channel_config"),
    gatewayConfig: text("gateway_config"), // JSON: { host, port, newPairing }
    sshKeyId: text("ssh_key_id"),
    provisioningError: text("provisioning_error"),
    provisioningStartedAt: integer("provisioning_started_at"),
    provisioningCompletedAt: integer("provisioning_completed_at"),
    retryCount: integer("retry_count").default(0),
    /**
     * Net hourly price for the VM in micro-dollars (divide by 1_000_000 for USD).
     * e.g. 4034 = $0.004034/hr. Set at bot creation from the Hetzner pricing API
     * and used for billing calculations.
     */
    pricePerHour: integer("price_per_hour"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_bots_user_id").on(table.userId),
    provisioningStatusIdx: index("idx_bots_provisioning_status").on(table.provisioningStatus),
    sshKeyIdIdx: index("idx_bots_ssh_key_id").on(table.sshKeyId),
  })
);

// Relations
export const sshKeysRelations = relations(sshKeys, ({ many }) => ({
  bots: many(bots),
}));

export const botsRelations = relations(bots, ({ one }) => ({
  sshKey: one(sshKeys, {
    fields: [bots.sshKeyId],
    references: [sshKeys.id],
  }),
}));

// Credits table - managed by Drizzle ORM
export const credits = sqliteTable(
  "credits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    amount: integer("amount").notNull(),
    source: text("source").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_credits_user_id").on(table.userId),
  })
);

// Usage records table - managed by Drizzle ORM
export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    botId: text("bot_id"),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_usage_records_user_id").on(table.userId),
    botIdIdx: index("idx_usage_records_bot_id").on(table.botId),
  })
);

// ====== Sandbox API Tables ======

export const sandboxes = sqliteTable(
  "sandboxes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    nodeId: text("node_id"),
    status: text("status", {
      enum: [
        "provisioning", "ready", "running", "paused",
        "stopping", "stopped", "error", "destroyed",
      ],
    }).notNull().default("provisioning"),
    baseImage: text("base_image").notNull(),
    vcpu: integer("vcpu").notNull().default(2),
    memoryMb: integer("memory_mb").notNull().default(2048),
    gpu: text("gpu"),
    timeoutSeconds: integer("timeout_seconds").notNull().default(3600),
    idleTimeoutSeconds: integer("idle_timeout_seconds").notNull().default(600),
    autoPauseOnIdle: integer("auto_pause_on_idle").notNull().default(0),
    autoDestroy: integer("auto_destroy").notNull().default(1),
    networkPolicy: text("network_policy", {
      enum: ["none", "outbound-only", "full"],
    }).notNull().default("outbound-only"),
    envVars: text("env_vars"), // JSON
    metadata: text("metadata"), // JSON
    region: text("region"),
    isolationBackend: text("isolation_backend"),
    costAccruedUsd: integer("cost_accrued_usd").default(0), // micro-dollars
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    expiresAt: integer("expires_at"),
    destroyedAt: integer("destroyed_at"),
  },
  (table) => ({
    tenantIdIdx: index("idx_sandboxes_tenant_id").on(table.tenantId),
    statusIdx: index("idx_sandboxes_status").on(table.status),
    nodeIdIdx: index("idx_sandboxes_node_id").on(table.nodeId),
  })
);

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    type: text("type", { enum: ["code", "command", "file"] }).notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "timed_out", "cancelled"],
    }).notNull(),
    exitCode: integer("exit_code"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    durationMs: integer("duration_ms"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => ({
    sandboxIdIdx: index("idx_executions_sandbox_id").on(table.sandboxId),
    tenantIdIdx: index("idx_executions_tenant_id").on(table.tenantId),
  })
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    name: text("name"),
    sizeBytes: integer("size_bytes").default(0),
    metadata: text("metadata"), // JSON
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => ({
    sandboxIdIdx: index("idx_snapshots_sandbox_id").on(table.sandboxId),
    tenantIdIdx: index("idx_snapshots_tenant_id").on(table.tenantId),
  })
);

export const nodes = sqliteTable(
  "nodes",
  {
    id: text("id").primaryKey(),
    status: text("status", {
      enum: ["pending", "healthy", "degraded", "draining", "cordoned", "offline"],
    }).notNull().default("healthy"),
    region: text("region").notNull(),
    totalVcpu: integer("total_vcpu").notNull(),
    totalMemoryMb: integer("total_memory_mb").notNull(),
    firecrackerVersion: text("firecracker_version"),
    bootstrapToken: text("bootstrap_token"),
    metadata: text("metadata"), // JSON
    lastHeartbeatAt: integer("last_heartbeat_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    statusIdx: index("idx_nodes_status").on(table.status),
  })
);


export const billingRecords = sqliteTable(
  "billing_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sandboxId: text("sandbox_id").notNull(),
    vcpuSeconds: integer("vcpu_seconds").default(0),
    memoryGbSeconds: integer("memory_gb_seconds").default(0),
    costMicroUsd: integer("cost_micro_usd").default(0),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end"),
  },
  (table) => ({
    tenantIdIdx: index("idx_billing_records_tenant_id").on(table.tenantId),
    sandboxIdIdx: index("idx_billing_records_sandbox_id").on(table.sandboxId),
  })
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    requestId: text("request_id"),
    timestamp: integer("timestamp").notNull(),
    details: text("details"), // JSON
  },
  (table) => ({
    tenantIdIdx: index("idx_audit_logs_tenant_id").on(table.tenantId),
    timestampIdx: index("idx_audit_logs_timestamp").on(table.timestamp),
  })
);

export const webhookRegistrations = sqliteTable(
  "webhook_registrations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    url: text("url").notNull(),
    events: text("events").notNull(), // JSON array
    secret: text("secret"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    tenantIdIdx: index("idx_webhook_registrations_tenant_id").on(table.tenantId),
  })
);

// Export types — existing
export type SSHKey = typeof sshKeys.$inferSelect;
export type NewSSHKey = typeof sshKeys.$inferInsert;
export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;
export type Credit = typeof credits.$inferSelect;
export type NewCredit = typeof credits.$inferInsert;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;

// Export types — sandbox API
export type SandboxRecord = typeof sandboxes.$inferSelect;
export type NewSandboxRecord = typeof sandboxes.$inferInsert;
export type ExecutionRecord = typeof executions.$inferSelect;
export type NewExecutionRecord = typeof executions.$inferInsert;
export type SnapshotRecord = typeof snapshots.$inferSelect;
export type NewSnapshotRecord = typeof snapshots.$inferInsert;
export type NodeRecord = typeof nodes.$inferSelect;
export type NewNodeRecord = typeof nodes.$inferInsert;
export type BillingRecord = typeof billingRecords.$inferSelect;
export type AuditLogRecord = typeof auditLogs.$inferSelect;
export type WebhookRegistrationRecord = typeof webhookRegistrations.$inferSelect;
