CREATE TABLE `assessments` (
	`run_id` text NOT NULL,
	`concern` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`answer` text,
	`final` integer NOT NULL,
	`probability` real,
	`citations` text DEFAULT '[]' NOT NULL,
	`verified` text DEFAULT '[]' NOT NULL,
	`synthetic` integer DEFAULT false NOT NULL,
	`decision_id` text,
	`cost_usd` real,
	`answered_by` text,
	`error` text,
	`input_request` text,
	`outcome` text,
	`outcome_source` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `concern`)
);
--> statement-breakpoint
CREATE INDEX `assessments_decision` ON `assessments` (`decision_id`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`scope` text NOT NULL,
	`seq` integer NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`payload` text,
	`prev_hash` text,
	`hash` text NOT NULL,
	PRIMARY KEY(`scope`, `seq`)
);
--> statement-breakpoint
CREATE INDEX `evidence_run` ON `evidence` (`run_id`);--> statement-breakpoint
CREATE TABLE `permit_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`full_name` text PRIMARY KEY NOT NULL,
	`check_mode` text DEFAULT 'report_only' NOT NULL,
	`synthetic` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`head_sha` text NOT NULL,
	`pull` integer,
	`title` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`result` text,
	`reason` text,
	`check_mode` text DEFAULT 'report_only' NOT NULL,
	`decider` text,
	`harness` text,
	`hard_failures` text DEFAULT '[]' NOT NULL,
	`concerns` text DEFAULT '[]' NOT NULL,
	`agent_steps` text DEFAULT '[]' NOT NULL,
	`ci` text DEFAULT '[]' NOT NULL,
	`config` text,
	`notes` text DEFAULT '[]' NOT NULL,
	`cost_usd` real,
	`synthetic` integer DEFAULT false NOT NULL,
	`error` text,
	`check_run` text,
	`first_seen_at` integer NOT NULL,
	`decided_at` integer,
	`rerun_requested` integer DEFAULT false NOT NULL,
	`merged_at` integer,
	`reverted_at` integer,
	`locked_until` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_repo_sha` ON `runs` (`repo`,`head_sha`);--> statement-breakpoint
CREATE INDEX `runs_state` ON `runs` (`state`);--> statement-breakpoint
CREATE INDEX `runs_pull` ON `runs` (`repo`,`pull`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);