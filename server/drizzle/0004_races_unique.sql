-- 赛事去重：同一场比赛用 (date, name) 唯一标识。
-- 之前只按日期去重会导致同一天的两场不同比赛（比如全马和半马分开发枪）互相覆盖。
-- 用 name 参与唯一键后，改目标成绩走 UPDATE，同一天加第二场赛事走 INSERT。
CREATE UNIQUE INDEX IF NOT EXISTS idx_races_date_name ON races (date, name);
--> statement-breakpoint
-- 清理历史重复：同名同日期只保留 id 最小的一条
DELETE FROM races WHERE id NOT IN (
  SELECT MIN(id) FROM races GROUP BY date, name
);
