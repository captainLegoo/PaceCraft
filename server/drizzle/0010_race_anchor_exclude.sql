-- 比赛锚点的人工覆盖标记。
--
-- 背景：锚点异常（后程配速与心率同步下滑）是**自动判定的**，规则只描述数据形态，
-- 不推断原因。触发这个形态的原因可能是用药、生病、伤病、前一场没恢复……
-- 只有本人知道。而规则也不一定适用于每个人 —— 别人可能想手动排除某场，
-- 或者某场被自动标记了但其实状态没问题、希望纳入基准。
--
-- 所以给 activities 加两个可空列：
--   race_excluded        1 = 强制排除；0 = 强制纳入（覆盖自动判定）；NULL = 交给自动判定
--   race_exclude_reason  人工排除的原因（可选，只有本人知道）
--
-- 为什么加在 activities 上而不用独立表：activities 的同步 upsert 只写它显式列出的
-- 那 17 个字段（见 coros/sync.ts），额外列不会被同步覆盖，标注能稳定留存。
ALTER TABLE `activities` ADD `race_excluded` integer;
ALTER TABLE `activities` ADD `race_exclude_reason` text;
