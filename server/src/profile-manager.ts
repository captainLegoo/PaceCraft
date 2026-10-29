import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const ROOT_DATA_DIR = process.env.COROS_DATA_DIR ?? join(homedir(), ".coros-dashboard");
export const PROFILES_DIR = join(ROOT_DATA_DIR, "profiles");
export const ACTIVE_PROFILE_FILE = join(ROOT_DATA_DIR, "active_profile.json");

export type ProfileMeta = {
  id: string;
  name: string;
  nickname?: string | null;
  createdAt: number;
  lastActiveAt: number;
};

export type ProfileSummary = ProfileMeta & {
  active: boolean;
  connected: boolean;
  activityCount: number;
  latestActivityDate: string | null;
};

// 确保目录存在
function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
}

/**
 * 自动迁移遗留的单档案结构：
 * 如果 ~/.coros-dashboard 下直接有 coros.db 或 tokens.json，但还没有 profiles/，
 * 将其平滑搬迁到 profiles/default/，保证老数据毫发无损。
 */
function checkLegacyMigration() {
  ensureDir(ROOT_DATA_DIR);
  ensureDir(PROFILES_DIR);

  const defaultDir = join(PROFILES_DIR, "default");
  const oldDb = join(ROOT_DATA_DIR, "coros.db");
  const oldToken = join(ROOT_DATA_DIR, "tokens.json");

  if (!existsSync(defaultDir)) {
    mkdirSync(defaultDir, { recursive: true, mode: 0o700 });
    const meta: ProfileMeta = {
      id: "default",
      name: "主跑友档案",
      nickname: null,
      createdAt: Math.floor(Date.now() / 1000),
      lastActiveAt: Math.floor(Date.now() / 1000),
    };
    writeFileSync(join(defaultDir, "profile.json"), JSON.stringify(meta, null, 2), "utf8");

    // 搬移已有数据文件
    if (existsSync(oldDb)) {
      try {
        renameSync(oldDb, join(defaultDir, "coros.db"));
        if (existsSync(oldDb + "-wal")) renameSync(oldDb + "-wal", join(defaultDir, "coros.db-wal"));
        if (existsSync(oldDb + "-shm")) renameSync(oldDb + "-shm", join(defaultDir, "coros.db-shm"));
      } catch {
        // 如果跨文件系统无法 rename，则 copy
        copyFileSync(oldDb, join(defaultDir, "coros.db"));
      }
    }
    if (existsSync(oldToken)) {
      try {
        renameSync(oldToken, join(defaultDir, "tokens.json"));
      } catch {
        copyFileSync(oldToken, join(defaultDir, "tokens.json"));
      }
    }
  }

  if (!existsSync(ACTIVE_PROFILE_FILE)) {
    writeFileSync(ACTIVE_PROFILE_FILE, JSON.stringify({ activeId: "default" }, null, 2), "utf8");
  }
}

// 初始化检查迁移
checkLegacyMigration();

export function getActiveProfileId(): string {
  try {
    if (existsSync(ACTIVE_PROFILE_FILE)) {
      const data = JSON.parse(readFileSync(ACTIVE_PROFILE_FILE, "utf8"));
      if (data?.activeId && existsSync(join(PROFILES_DIR, data.activeId))) {
        return data.activeId;
      }
    }
  } catch {}
  return "default";
}

export function setActiveProfileId(id: string) {
  if (!existsSync(join(PROFILES_DIR, id))) {
    throw new Error(`Profile ${id} 不存在`);
  }
  writeFileSync(ACTIVE_PROFILE_FILE, JSON.stringify({ activeId: id }, null, 2), "utf8");

  // 更新活跃时间
  const metaPath = join(PROFILES_DIR, id, "profile.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ProfileMeta;
      meta.lastActiveAt = Math.floor(Date.now() / 1000);
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
    } catch {}
  }
}

export function getProfileDir(id = getActiveProfileId()): string {
  const dir = join(PROFILES_DIR, id);
  ensureDir(dir);
  return dir;
}

export function getProfileDbPath(id = getActiveProfileId()): string {
  return join(getProfileDir(id), "coros.db");
}

export function getProfileTokenPath(id = getActiveProfileId()): string {
  return join(getProfileDir(id), "tokens.json");
}

export function getProfileGarminTokenPath(id = getActiveProfileId()): string {
  return join(getProfileDir(id), "garmin_tokens.json");
}

export function listProfileMetas(): ProfileMeta[] {
  ensureDir(PROFILES_DIR);
  const dirs = readdirSync(PROFILES_DIR).filter((f) => {
    return !f.startsWith(".") && existsSync(join(PROFILES_DIR, f, "profile.json"));
  });

  if (dirs.length === 0) {
    // 兜底一个 default
    checkLegacyMigration();
    dirs.push("default");
  }

  const list: ProfileMeta[] = [];
  for (const id of dirs) {
    try {
      const text = readFileSync(join(PROFILES_DIR, id, "profile.json"), "utf8");
      list.push(JSON.parse(text) as ProfileMeta);
    } catch {
      list.push({
        id,
        name: id === "default" ? "默认跑友" : id,
        createdAt: Math.floor(Date.now() / 1000),
        lastActiveAt: Math.floor(Date.now() / 1000),
      });
    }
  }

  return list.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export function createNewProfile(name?: string): ProfileMeta {
  const now = Math.floor(Date.now() / 1000);
  const id = `user_${now}_${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(PROFILES_DIR, id);
  ensureDir(dir);

  const meta: ProfileMeta = {
    id,
    name: name?.trim() || `跑友 ${listProfileMetas().length + 1}`,
    nickname: null,
    createdAt: now,
    lastActiveAt: now,
  };

  writeFileSync(join(dir, "profile.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function updateProfileMeta(id: string, updates: { name?: string; nickname?: string | null }): ProfileMeta {
  const metaPath = join(PROFILES_DIR, id, "profile.json");
  if (!existsSync(metaPath)) throw new Error(`Profile ${id} 不存在`);

  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ProfileMeta;
  if (updates.name !== undefined) meta.name = updates.name.trim() || meta.name;
  if (updates.nickname !== undefined) meta.nickname = updates.nickname;

  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function deleteProfile(id: string): { ok: boolean } {
  const all = listProfileMetas();
  if (all.length <= 1) {
    throw new Error("至少保留一个跑友档案，不可全部删除");
  }

  const dir = join(PROFILES_DIR, id);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }

  const activeId = getActiveProfileId();
  if (activeId === id) {
    const remain = listProfileMetas();
    setActiveProfileId(remain[0]?.id || "default");
  }

  return { ok: true };
}

/**
 * 彻底抹除并重置本机所有跑友数据与档案 (Wipe all data)
 * 清空 ~/.coros-dashboard 目录并重新初始化默认档案
 */
export function wipeAllLocalData(): { ok: boolean } {
  if (existsSync(ROOT_DATA_DIR)) {
    rmSync(ROOT_DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  checkLegacyMigration();
  return { ok: true };
}
