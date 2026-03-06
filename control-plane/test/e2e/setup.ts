import { env } from "cloudflare:test";

export async function applyMigrations() {
  const db = env.DB;

  await db.exec(`CREATE TABLE IF NOT EXISTS "sandboxes" ("id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "node_id" text, "status" text NOT NULL DEFAULT 'provisioning', "base_image" text NOT NULL, "vcpu" integer NOT NULL DEFAULT 2, "memory_mb" integer NOT NULL DEFAULT 2048, "gpu" text, "timeout_seconds" integer NOT NULL DEFAULT 3600, "idle_timeout_seconds" integer NOT NULL DEFAULT 600, "auto_pause_on_idle" integer NOT NULL DEFAULT 0, "auto_destroy" integer NOT NULL DEFAULT 1, "network_policy" text NOT NULL DEFAULT 'outbound-only', "env_vars" text, "metadata" text, "region" text, "isolation_backend" text, "cost_accrued_usd" integer DEFAULT 0, "created_at" integer NOT NULL, "started_at" integer, "expires_at" integer, "destroyed_at" integer);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_sandboxes_tenant_id" ON "sandboxes" ("tenant_id");`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_sandboxes_status" ON "sandboxes" ("status");`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_sandboxes_node_id" ON "sandboxes" ("node_id");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "executions" ("id" text PRIMARY KEY NOT NULL, "sandbox_id" text NOT NULL, "tenant_id" text NOT NULL, "type" text NOT NULL, "status" text NOT NULL, "exit_code" integer, "stdout" text, "stderr" text, "duration_ms" integer, "started_at" integer NOT NULL, "completed_at" integer);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_executions_sandbox_id" ON "executions" ("sandbox_id");`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_executions_tenant_id" ON "executions" ("tenant_id");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "snapshots" ("id" text PRIMARY KEY NOT NULL, "sandbox_id" text NOT NULL, "tenant_id" text NOT NULL, "name" text, "size_bytes" integer DEFAULT 0, "metadata" text, "created_at" integer NOT NULL, "expires_at" integer);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_snapshots_sandbox_id" ON "snapshots" ("sandbox_id");`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_snapshots_tenant_id" ON "snapshots" ("tenant_id");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "nodes" ("id" text PRIMARY KEY NOT NULL, "status" text NOT NULL DEFAULT 'healthy', "region" text NOT NULL, "total_vcpu" integer NOT NULL, "total_memory_mb" integer NOT NULL, "firecracker_version" text, "bootstrap_token" text, "metadata" text, "last_heartbeat_at" integer, "created_at" integer NOT NULL);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_nodes_status" ON "nodes" ("status");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "tenants" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "max_concurrent_sandboxes" integer NOT NULL DEFAULT 10, "max_vcpu" integer NOT NULL DEFAULT 64, "max_memory_mb" integer NOT NULL DEFAULT 131072, "status" text NOT NULL DEFAULT 'active', "created_at" integer NOT NULL);`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "tenant_api_keys" ("id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "key_hash" text NOT NULL, "name" text, "last_used_at" integer, "created_at" integer NOT NULL, "expires_at" integer);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_tenant_api_keys_tenant_id" ON "tenant_api_keys" ("tenant_id");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "billing_records" ("id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "sandbox_id" text NOT NULL, "vcpu_seconds" integer DEFAULT 0, "memory_gb_seconds" integer DEFAULT 0, "cost_micro_usd" integer DEFAULT 0, "period_start" integer NOT NULL, "period_end" integer);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_billing_records_tenant_id" ON "billing_records" ("tenant_id");`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_billing_records_sandbox_id" ON "billing_records" ("sandbox_id");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "audit_logs" ("id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "action" text NOT NULL, "resource_type" text NOT NULL, "resource_id" text, "request_id" text, "timestamp" integer NOT NULL, "details" text);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_audit_logs_tenant_id" ON "audit_logs" ("tenant_id");`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_audit_logs_timestamp" ON "audit_logs" ("timestamp");`);

  await db.exec(`CREATE TABLE IF NOT EXISTS "webhook_registrations" ("id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "url" text NOT NULL, "events" text NOT NULL, "secret" text, "created_at" integer NOT NULL);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS "idx_webhook_registrations_tenant_id" ON "webhook_registrations" ("tenant_id");`);
}
