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
	`mode` text DEFAULT 'shadow' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`head_sha` text NOT NULL,
	`pull` integer,
	`state` text NOT NULL,
	`result` text,
	`mode` text NOT NULL,
	`decision` text,
	`notes` text DEFAULT '[]' NOT NULL,
	`pending` text DEFAULT '[]' NOT NULL,
	`council_calls` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	`check_run` text,
	`first_seen_at` integer NOT NULL,
	`decided_at` integer,
	`locked_until` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_repo_sha` ON `runs` (`repo`,`head_sha`);--> statement-breakpoint
CREATE INDEX `runs_state` ON `runs` (`state`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
