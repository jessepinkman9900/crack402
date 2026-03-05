-- Migration: Add SSH keys table and bot type support
-- Created: 2026-03-01

-- Create SSH keys table
CREATE TABLE `ssh_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL,
  `public_key` text NOT NULL,
  `fingerprint` text NOT NULL,
  `created_at` integer NOT NULL
);

-- Add indexes for SSH keys
CREATE INDEX `idx_ssh_keys_user_id` ON `ssh_keys` (`user_id`);
CREATE INDEX `idx_ssh_keys_fingerprint` ON `ssh_keys` (`fingerprint`);

-- Add new columns to bots table
ALTER TABLE `bots` ADD COLUMN `bot_type` text DEFAULT 'standard' NOT NULL;
ALTER TABLE `bots` ADD COLUMN `gateway_config` text;
ALTER TABLE `bots` ADD COLUMN `ssh_key_id` text;

-- Add index for SSH key foreign key
CREATE INDEX `idx_bots_ssh_key_id` ON `bots` (`ssh_key_id`);
