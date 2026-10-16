CREATE TABLE `ai_session_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_key` text NOT NULL,
	`date` text NOT NULL,
	`activity_count` integer DEFAULT 1 NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`focus` text,
	`report` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_session_reports_key` ON `ai_session_reports` (`session_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_session_focus` ON `ai_session_reports` (`session_key`,`focus`);