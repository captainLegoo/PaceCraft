-- AI 周级训练分析报告。
--
-- 为什么周级要单独一张表，不能复用 ai_session_reports：
-- 场次分析的对象是「某一天这一场」，键是 session_key；
-- 周级分析的对象是「周一到周日这一周」，键是 week_start（yyyy-mm-dd）。
-- 两者粒度不同、生命周期不同（改一次整周重算），塞进同一张表会互相覆盖。
--
-- 与场次表保持一致：同一周 + 同一个关注点只保留最新一份（唯一索引实现）。
CREATE TABLE IF NOT EXISTS `ai_week_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`session_count` integer DEFAULT 1 NOT NULL,
	`block_count` integer DEFAULT 1 NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`focus` text,
	`report` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_week_reports_week` ON `ai_week_reports` (`week_start`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_ai_week_focus` ON `ai_week_reports` (`week_start`, `focus`);
