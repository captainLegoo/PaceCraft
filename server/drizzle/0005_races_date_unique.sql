-- 修正去重键：从 (date, name) 改为 date 单列。
--
-- 业务事实：同一天只能参加一场比赛。
-- 之前的 (date, name) 组合允许"同一天两场不同名称"并存，
-- 那是技术上的宽松，不是业务需要 —— 只会让用户不小心建出两条互相矛盾的记录。
--
-- 改名不算新建：updateRace 按 id 更新，(date, name) 都没变时不会触发约束。
DROP INDEX IF EXISTS idx_races_date_name;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_races_date_only ON races (date);
