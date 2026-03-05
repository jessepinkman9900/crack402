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

// Export types
export type SSHKey = typeof sshKeys.$inferSelect;
export type NewSSHKey = typeof sshKeys.$inferInsert;
export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;
export type Credit = typeof credits.$inferSelect;
export type NewCredit = typeof credits.$inferInsert;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
