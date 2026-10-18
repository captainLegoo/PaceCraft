-- 心率档案可配置化 + 修复 users 表重复行。
--
-- 背景一：max_hr / resting_hr 之前硬编码在 analytics.ts 的 HR_PROFILE 里，
-- 写的是某一组固定实测值。这让其他使用者拿到手时分区会整体错位 ——
-- 同样的 140 bpm，对静息很低的人是有氧中段，对静息偏高的人已经是高强度。
-- 现在改为字段落在 users 表由使用者自己填；留 NULL 时分别回退到
-- observedMaxHr（从历史分圈推算）和生理中位数 55。
--
-- 背景二：sync.ts 原来是 INSERT + ON CONFLICT(rowid) DO NOTHING，
-- rowid 对新插入的行不冲突，于是每次同步都新增一行档案（长期待下去会攒出大量完全重复的记录）。
-- 读取端都取 all()[0] 所以没暴露为故障，
-- 但属于数据污染。同步逻辑已改为 ON CONFLICT(nickname) DO UPDATE，
-- 这里补上 nickname 唯一索引让该 upsert 生效，并清理已产生的重复行。
ALTER TABLE `users` ADD `max_hr` integer;
ALTER TABLE `users` ADD `resting_hr` integer;

-- 只保留每个 nickname 最早的一行。取 min(rowid) 而不是随便留一行，
-- 是因为第 1 行就是首次同步写入的原始档案，后续行都是它的副本。
DELETE FROM `users` WHERE rowid NOT IN (SELECT MIN(rowid) FROM `users` GROUP BY nickname);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_nickname` ON `users` (`nickname`);