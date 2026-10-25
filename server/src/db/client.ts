import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDbPath } from "../config.ts";
import * as schema from "./schema.ts";
import { INLINE_MIGRATIONS } from "./migrations-data.ts";

let currentSqlite: Database;
let currentDb: ReturnType<typeof drizzle>;

function runMigrations(targetSqlite: Database) {
  const dir = join(import.meta.dir, "../../drizzle");
  const useInline = !existsSync(dir);

  targetSqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at integer NOT NULL)");
  const applied = new Set(
    (targetSqlite.query("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );

  const files = useInline
    ? Object.keys(INLINE_MIGRATIONS).sort()
    : readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = useInline ? INLINE_MIGRATIONS[file]! : readFileSync(join(dir, file), "utf8");
    targetSqlite.transaction(() => {
      for (const stmt of sqlText.split("--> statement-breakpoint")) {
        const s = stmt.trim();
        if (s) targetSqlite.exec(s);
      }
      targetSqlite.query("INSERT INTO _migrations (name, applied_at) VALUES (?, unixepoch())").run(file);
    })();
  }
}

export function closeCurrentDatabase() {
  if (currentSqlite) {
    try {
      currentSqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      currentSqlite.close();
    } catch {}
  }
}

export function switchProfileDatabase(newDbPath: string) {
  closeCurrentDatabase();

  mkdirSync(dirname(newDbPath), { recursive: true, mode: 0o700 });
  currentSqlite = new Database(newDbPath, { create: true });
  currentSqlite.exec("PRAGMA journal_mode = WAL");
  currentSqlite.exec("PRAGMA foreign_keys = ON");
  runMigrations(currentSqlite);
  currentDb = drizzle(currentSqlite, { schema });
}

// 启动时初始化当前 Profile 的数据库
switchProfileDatabase(getDbPath());

/**
 * 导出动态透明 Proxy：
 * 后续所有业务模块（analytics, prediction, sync, routes）不需要改动任何代码，
 * 切换档案后，db 和 sqlite 会自动映射至新跑友的数据库连接上。
 */
export const sqlite = new Proxy({} as Database, {
  get(_target, prop) {
    const val = (currentSqlite as any)[prop];
    return typeof val === "function" ? val.bind(currentSqlite) : val;
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const val = (currentDb as any)[prop];
    return typeof val === "function" ? val.bind(currentDb) : val;
  },
});

export { schema };
