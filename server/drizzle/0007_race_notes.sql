-- 比赛关联训练 + 主观体感备注。
--
-- 背景一：比赛当天在手表里就是一次普通训练，没有额外标记。
-- 关联 label_id 之后，才能把「赛前登记的目标成绩」和「赛后实测的分段数据」
-- 对上同一次训练做对比。允许为空：未来的比赛、当天没同步到的都能先登记。
--
-- 背景二：notes 存主观体感（累不累、抽筋、哪一段不舒服）。
-- COROS 没有这类数据，只有本人知道，但它是解释客观数据的关键线索。
ALTER TABLE `races` ADD `label_id` text;
ALTER TABLE `races` ADD `notes` text;

-- 关联索引：按训练反查赛事（训练详情页要显示「这天是比赛」）
CREATE INDEX IF NOT EXISTS `idx_races_label_id` ON `races` (`label_id`);