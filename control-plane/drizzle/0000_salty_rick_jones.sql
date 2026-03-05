CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`provisioning_status` text,
	`provider` text NOT NULL,
	`region` text NOT NULL,
	`server_id` text,
	`ip_address` text,
	`openrouter_key_id` text,
	`openrouter_key` text,
	`channel_config` text,
	`provisioning_error` text,
	`provisioning_started_at` integer,
	`provisioning_completed_at` integer,
	`retry_count` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bots_user_id` ON `bots` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_bots_provisioning_status` ON `bots` (`provisioning_status`);--> statement-breakpoint
CREATE TABLE `credits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_credits_user_id` ON `credits` (`user_id`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_user_id` ON `usage_records` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_records_bot_id` ON `usage_records` (`bot_id`);