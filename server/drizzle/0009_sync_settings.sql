-- 同步的运动类型白名单改为用户可配置。
--
-- 背景：sync.ts 里硬编码了 RUN_SPORT_CODES = [100,102,103,104,900,902,903,904]，
-- 作为 sportTypeCodes 传给 querySportRecords。结果是室内有氧（400）这类
-- 训练**根本不会被拉取** —— 不是 COROS 没有数据，是我们在过滤环节丢掉了。
-- （实测过：这类训练在 MCP 里返回得好好的，只是不在白名单里。）
--
-- 为什么要配置化而不是直接加 400/401/402：每个人的训练内容不同，
-- 写死一份对别人就是错的。跑步者、跑者+力量训练者、跑者+骑行者需要的白名单
-- 本来就不一样，交回给使用者在设置页勾选。
--
-- 单行表（id 固定为 1）：与 ai_settings、users 同样的存法。
-- 没有这一行时读取端回退到 DEFAULT_SPORT_TYPE_CODES，
-- 所以老库升级后第一次同步的行为不变。
CREATE TABLE IF NOT EXISTS `sync_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`sport_type_codes` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
