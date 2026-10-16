CREATE TABLE `ai_chat` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text DEFAULT 'race' NOT NULL,
	`ref_key` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_chat_thread` ON `ai_chat` (`scope`,`ref_key`,`id`);