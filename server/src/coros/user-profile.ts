import { sqlite } from "../db/client.ts";

/**
 * 确保 users 表严格保持「单档案唯一个人主档案」：
 * 1. 无论 COROS 官方昵称是否变更，始终更新这唯一一行；
 * 2. 绝不覆盖用户手动登记的 max_hr、resting_hr、custom_hr_zones 等心率区间配置；
 * 3. 自动清理任何可能遗留的重复行，杜绝 LIMIT 1 读取时的不确定性。
 */
export function upsertUserProfile(rawUserInfo: string, incomingNickname?: string | null): string | null {
  const num = (re: RegExp) => Number(rawUserInfo.match(re)?.[1] ?? NaN);
  const parsedNick =
    (rawUserInfo.match(/Nickname:\s*(.+)/)?.[1] ?? "").replace(/["'\s]+"?\s*$/, "") || null;
  const nick = incomingNickname ?? parsedNick;
  const height = num(/Height:\s*([\d.]+)/);
  const weight = num(/Weight:\s*([\d.]+)/);
  const birthday = rawUserInfo.match(/Birthday:\s*(\S+)/)?.[1] ?? null;
  const gender = rawUserInfo.match(/Gender:\s*(\w+)/)?.[1] ?? null;

  sqlite.transaction(() => {
    const existing = sqlite.query("SELECT rowid FROM users LIMIT 1").get() as { rowid: number } | null;
    if (existing) {
      sqlite.query(`
        UPDATE users
        SET height_cm = ?, weight_kg = ?, birthday = ?, gender = ?, nickname = ?, raw = ?
        WHERE rowid = ?
      `).run(
        isNaN(height) ? null : height,
        isNaN(weight) ? null : weight,
        birthday,
        gender,
        nick,
        rawUserInfo,
        existing.rowid,
      );
      // 幂等清理多余行
      sqlite.query("DELETE FROM users WHERE rowid != ?").run(existing.rowid);
    } else {
      sqlite.query(`
        INSERT INTO users (height_cm, weight_kg, birthday, gender, nickname, raw)
        VALUES (?,?,?,?,?,?)
      `).run(
        isNaN(height) ? null : height,
        isNaN(weight) ? null : weight,
        birthday,
        gender,
        nick,
        rawUserInfo,
      );
    }
  })();

  return nick;
}
