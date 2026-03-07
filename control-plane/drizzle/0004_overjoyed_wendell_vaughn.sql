CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`request_id` text,
	`timestamp` integer NOT NULL,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_tenant_id` ON `audit_logs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_timestamp` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE TABLE `billing_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sandbox_id` text NOT NULL,
	`vcpu_seconds` integer DEFAULT 0,
	`memory_gb_seconds` integer DEFAULT 0,
	`cost_micro_usd` integer DEFAULT 0,
	`period_start` integer NOT NULL,
	`period_end` integer
);
--> statement-breakpoint
CREATE INDEX `idx_billing_records_tenant_id` ON `billing_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_records_sandbox_id` ON `billing_records` (`sandbox_id`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`sandbox_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`stdout` text,
	`stderr` text,
	`duration_ms` integer,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_executions_sandbox_id` ON `executions` (`sandbox_id`);--> statement-breakpoint
CREATE INDEX `idx_executions_tenant_id` ON `executions` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'healthy' NOT NULL,
	`region` text NOT NULL,
	`total_vcpu` integer NOT NULL,
	`total_memory_mb` integer NOT NULL,
	`firecracker_version` text,
	`bootstrap_token` text,
	`metadata` text,
	`last_heartbeat_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nodes_status` ON `nodes` (`status`);--> statement-breakpoint
CREATE TABLE `sandboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`node_id` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`base_image` text NOT NULL,
	`vcpu` integer DEFAULT 2 NOT NULL,
	`memory_mb` integer DEFAULT 2048 NOT NULL,
	`gpu` text,
	`timeout_seconds` integer DEFAULT 3600 NOT NULL,
	`idle_timeout_seconds` integer DEFAULT 600 NOT NULL,
	`auto_pause_on_idle` integer DEFAULT 0 NOT NULL,
	`auto_destroy` integer DEFAULT 1 NOT NULL,
	`network_policy` text DEFAULT 'outbound-only' NOT NULL,
	`env_vars` text,
	`metadata` text,
	`region` text,
	`isolation_backend` text,
	`cost_accrued_usd` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`expires_at` integer,
	`destroyed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sandboxes_tenant_id` ON `sandboxes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sandboxes_status` ON `sandboxes` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sandboxes_node_id` ON `sandboxes` (`node_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`sandbox_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text,
	`size_bytes` integer DEFAULT 0,
	`metadata` text,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_sandbox_id` ON `snapshots` (`sandbox_id`);--> statement-breakpoint
CREATE INDEX `idx_snapshots_tenant_id` ON `snapshots` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `tenant_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`name` text,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_api_keys_tenant_id` ON `tenant_api_keys` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text,
	`max_concurrent_sandboxes` integer DEFAULT 10 NOT NULL,
	`max_vcpu` integer DEFAULT 64 NOT NULL,
	`max_memory_mb` integer DEFAULT 131072 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tenants_user_id` ON `tenants` (`user_id`);--> statement-breakpoint
CREATE TABLE `webhook_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`secret` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_registrations_tenant_id` ON `webhook_registrations` (`tenant_id`);