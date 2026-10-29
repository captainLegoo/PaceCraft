-- 活动来源品牌（coros / garmin / suunto / fit 等）
ALTER TABLE `activities` ADD `source` text DEFAULT 'coros';
--> statement-breakpoint
-- 补齐已有 Garmin 活动的历史来源标记
UPDATE `activities` SET `source` = 'garmin' WHERE `label_id` LIKE 'garmin_%';
