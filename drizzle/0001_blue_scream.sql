CREATE TABLE `asks` (
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`state` text NOT NULL,
	`withai` text DEFAULT '[]' NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `asks_open` ON `asks` (`open`);--> statement-breakpoint
ALTER TABLE `runs` ADD `config` text;