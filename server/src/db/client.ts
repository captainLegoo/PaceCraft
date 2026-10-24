import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DB_PATH } from "../config.ts";
import * as schema from "./schema.ts";
import { INLINE_MIGRATIONS } from "./migrations-data.ts";

mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 });

export const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

/**
 * 迁移在启动时直接跑：读 drizzle/*.sql 逐个执行并记账。
 * 这样不用引入 drizzle-kit push 所需的额外 driver 依赖 —— 本地 SQLite 用 bun:sqlite 就够了。
 */
function migrate() {
  const dir = join(import.meta.dir, "../../drizzle");
  const useInline = !existsSync(dir);

  sqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at integer NOT NULL)");
  const applied = new Set(
    (sqlite.query("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );

  const files = useInline ? Object.keys(INLINE_MIGRATIONS).sort() : readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = useInline ? INLINE_MIGRATIONS[file]! : readFileSync(join(dir, file), "utf8");
    sqlite.transaction(() => {
      for (const stmt of sqlText.split("--> statement-breakpoint")) {
        const s = stmt.trim();
        if (s) sqlite.exec(s);
      }
      sqlite.query("INSERT INTO _migrations (name, applied_at) VALUES (?, unixepoch())").run(file);
    })();
  }
}

migrate();

export const db = drizzle(sqlite, { schema });
export { schema };
