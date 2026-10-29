-- 活动去重与多品牌交叉冲突处理
ALTER TABLE `activities` ADD `is_duplicate` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `activities` ADD `duplicate_of` text;
--> statement-breakpoint
ALTER TABLE `activities` ADD `conflict_status` text;
