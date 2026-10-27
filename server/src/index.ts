import { EMBEDDED_DIST } from "./embedded-dist.ts";
import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { APP_VERSION } from "./version.ts";
import { db, sqlite } from "./db/client.ts";
import {
  aiReports, aiSessionReports, aiSettings, aiWeekReports, activities, activityDetails, dailyHealth, fitness,
  heartRate, laps, races, recovery, sleep, stress, syncLog, trainingLoad, users,
} from "./db/schema.ts";
import { SERVER_HOST, SERVER_PORT, WEB_ORIGIN } from "./config.ts";
import { ageFromBirthday, buildSessions, hrZoneOptions, hrZones, loadSeries, monthlyVolume, paceHrScatter, sessionLaps, weeklyVolume } from "./analytics.ts";
import { syncAll, type SyncProgress } from "./coros/sync.ts";
import { saveSportTypeCodes, sportSettingsPayload } from "./coros/sport-types.ts";
import { backfillAltitude, fitQuotaStatus, followState, startFollow, stopFollow } from "./auto-sync.ts";
import {
  buildRaceProfile,
  createRace,
  deleteRace,
  getRace,
  listRaces,
  updateRace,
} from "./race-service.ts";
import { buildBriefing, setAnchorExclusion } from "./race-briefing.ts";
import { COARSE_SPACING_M, pickForDisplay } from "./gpx.ts";
import { parseRouteFile, routeSourceNote } from "./route-file.ts";
import "./workflow/steps.ts";
import {
  describeSteps,
  isRunning,
  loadConfig,
  loadLastRun,
  runWorkflow,
  saveConfig,
  type WorkflowConfig,
} from "./workflow/engine.ts";
import { analyzeActivity, analyzeSession, callModel, getAiConfig, saveAiConfig } from "./ai/provider.ts";
import { analyzeWeek, normalizeWeekStart } from "./ai/week.ts";
import { buildReport } from "./prediction/pipeline.ts";
import { analyzeRacePrep, marathonPrep } from "./prediction/prep.ts";
import {
  cancelAuthFlow,
  disconnectAuth,
  getAuthStatus,
  openExternalUrl,
  resolveAccountMismatch,
  startAuthFlow,
} from "./coros/auth-service.ts";
import { closeCurrentDatabase, switchProfileDatabase } from "./db/client.ts";
import {
  createNewProfile,
  deleteProfile,
  getActiveProfileId,
  getProfileDbPath,
  listProfileMetas,
  ROOT_DATA_DIR,
  setActiveProfileId,
  updateProfileMeta,
  wipeAllLocalData,
} from "./profile-manager.ts";

const one = <T>(rows: T[]) => rows[0] ?? null;

/**
 * 快速同步的并发锁与全局进度跟踪。
 * 用模块级变量而不是 Elysia 的 state：单进程够用，且不依赖框架内部 API。
 */
let syncInFlight = false;
let activeSyncProgress: SyncProgress = {
  active: false,
  phase: "idle",
  current: 0,
  total: 0,
  percent: 0,
  message: "空闲",
  updatedAt: Date.now(),
};

function updateSyncProgress(patch: Partial<SyncProgress>) {
  activeSyncProgress = {
    ...activeSyncProgress,
    ...patch,
    updatedAt: Date.now(),
  };
}

const app = new Elysia()
  .onError(({ code, error, path }) => {
    console.error(`[Elysia Error] ${code} on ${path}:`, error);
  })
  .onRequest(({ request, set }) => {
    const origin = request.headers.get("origin");
    if (origin) {
      set.headers["Access-Control-Allow-Origin"] = origin;
      set.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
      set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin ?? "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
  })
  .get("/api/status", () => {
    const activeId = getActiveProfileId();
    const currentMeta = listProfileMetas().find((m) => m.id === activeId);
    return {
      version: APP_VERSION,
      profile: {
        id: activeId,
        name: currentMeta?.name ?? "默认跑友",
        nickname: currentMeta?.nickname ?? null,
      },
      counts: {
        activities: db.select().from(activities).all().length,
        laps: db.select().from(laps).all().length,
        loadDays: db.select().from(trainingLoad).all().length,
        healthDays: db.select().from(dailyHealth).all().length,
        sleepDays: db.select().from(sleep).all().length,
      },
      lastSync: one(db.select().from(syncLog).orderBy(desc(syncLog.startedAt)).limit(1).all()),
      latestActivityDate: one(db.select({ d: activities.dateLabel }).from(activities).orderBy(desc(activities.date)).limit(1).all())?.d ?? null,
      aiConfigured: getAiConfig() !== null,
      auth: getAuthStatus(),
    };
  })

  /** 跑友档案（Profile）管理 */
  .get("/api/profiles", () => {
    const activeId = getActiveProfileId();
    const metas = listProfileMetas();
    return {
      activeId,
      profiles: metas.map((m) => ({
        ...m,
        active: m.id === activeId,
      })),
    };
  })
  .post("/api/profiles/switch", ({ body }) => {
    if (syncInFlight) {
      return new Response(JSON.stringify({ error: "当前档案正在同步数据中，请稍候同步完成后再切换跑友" }), { status: 409 });
    }
    const id = (body as any)?.id;
    if (!id) return new Response(JSON.stringify({ error: "缺少档案 ID" }), { status: 400 });
    stopFollow();
    setActiveProfileId(id);
    switchProfileDatabase(getProfileDbPath(id));
    return { ok: true, activeId: id };
  })
  .post("/api/profiles/create", ({ body }) => {
    if (syncInFlight) {
      return new Response(JSON.stringify({ error: "当前档案正在同步数据中，请稍候同步完成后再新建跑友" }), { status: 409 });
    }
    const name = (body as any)?.name;
    // 继承当前活跃档案的 AI 配置与运动类型设置
    let aiRow: any = null;
    let syncRow: any = null;
    try {
      aiRow = sqlite.query("SELECT * FROM ai_settings WHERE id = 1 LIMIT 1").get();
      syncRow = sqlite.query("SELECT * FROM sync_settings WHERE id = 1 LIMIT 1").get();
    } catch {}

    stopFollow();
    const newProfile = createNewProfile(name);
    setActiveProfileId(newProfile.id);
    switchProfileDatabase(getProfileDbPath(newProfile.id));

    try {
      if (aiRow) {
        sqlite.query(`
          INSERT INTO ai_settings (id, provider, base_url, api_key, model, temperature, max_tokens, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            model = excluded.model,
            temperature = excluded.temperature,
            max_tokens = excluded.max_tokens,
            updated_at = unixepoch()
        `).run(aiRow.provider, aiRow.base_url, aiRow.api_key, aiRow.model, aiRow.temperature, aiRow.max_tokens);
      }
      if (syncRow) {
        sqlite.query(`
          INSERT INTO sync_settings (id, sport_type_codes, updated_at)
          VALUES (1, ?, unixepoch())
          ON CONFLICT(id) DO UPDATE SET
            sport_type_codes = excluded.sport_type_codes,
            updated_at = unixepoch()
        `).run(syncRow.sport_type_codes);
      }
    } catch {}

    return { ok: true, profile: newProfile };
  })
  .put("/api/profiles/:id", ({ params, body }) => {
    const name = (body as any)?.name;
    const updated = updateProfileMeta(params.id, { name });
    return { ok: true, profile: updated };
  })
  .delete("/api/profiles/:id", ({ params }) => {
    if (syncInFlight) {
      return new Response(JSON.stringify({ error: "当前正在同步数据中，请稍候同步完成后再删除档案" }), { status: 409 });
    }
    try {
      stopFollow();
      deleteProfile(params.id);
      switchProfileDatabase(getProfileDbPath(getActiveProfileId()));
      return { ok: true, activeId: getActiveProfileId() };
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
    }
  })

  /** 系统数据管理：查看目录路径与彻底抹除所有本地数据 */
  .get("/api/system/data-info", () => ({ rootDataDir: ROOT_DATA_DIR }))
  .post("/api/system/wipe-data", () => {
    if (syncInFlight) {
      return new Response(JSON.stringify({ error: "当前正在同步数据中，请稍候同步完成后再清空数据" }), { status: 409 });
    }
    try {
      stopFollow();
      closeCurrentDatabase();
      wipeAllLocalData();
      switchProfileDatabase(getProfileDbPath(getActiveProfileId()));
      return { ok: true, activeId: getActiveProfileId() };
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
    }
  })

  /** COROS 授权与账号连接 */
  .get("/api/auth/status", () => getAuthStatus())
  .post("/api/auth/start", async () => {
    try {
      return await startAuthFlow();
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
    }
  })
  .post("/api/auth/disconnect", async () => await disconnectAuth())
  .post("/api/auth/cancel", async () => await cancelAuthFlow())
  .post("/api/auth/resolve-mismatch", ({ body }) => {
    try {
      const action = (body as any)?.action;
      if (!action || !["create_new", "overwrite", "merge"].includes(action)) {
        return new Response(JSON.stringify({ error: "无效的操作指令" }), { status: 400 });
      }
      const res = resolveAccountMismatch(action);
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
    }
  })
  .post("/api/open-external", ({ body }) => {
    const url = (body as any)?.url;
    if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
      openExternalUrl(url);
      return { ok: true };
    }
    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400 });
  })

  .post("/api/sync", async ({ query }) => {
    const auth = getAuthStatus();
    if (!auth.connected) {
      return new Response(JSON.stringify({ error: "尚未连接 COROS 账号，请先完成授权" }), { status: 400 });
    }
    if (auth.mismatch) {
      return new Response(JSON.stringify({ error: "检测到高驰账号不一致，请先确认处理方式" }), { status: 409 });
    }
    if (syncInFlight) {
      return new Response(JSON.stringify({ error: activeSyncProgress.message || "同步正在进行中，请稍候" }), { status: 429 });
    }
    syncInFlight = true;
    const startedAt = Date.now();
    updateSyncProgress({
      active: true,
      phase: "records",
      current: 0,
      total: 100,
      percent: 2,
      message: "正在连接高驰服务...",
      startedAt,
      error: null,
    });
    const days = Number((query as any).days ?? 365);
    const withLaps = (query as any).laps !== "false";
    try {
      const res = await syncAll({
        days,
        withLaps,
        onProgress: (p) => updateSyncProgress({ active: true, ...p }),
      });
      updateSyncProgress({
        active: false,
        phase: "done",
        percent: 100,
        message: `同步完成：${res.activities} 次活动、${res.details} 条详情`,
      });
      return res;
    } catch (e) {
      const errMsg = `同步失败：${(e as Error).message}`;
      updateSyncProgress({
        active: false,
        phase: "error",
        percent: 100,
        message: errMsg,
        error: errMsg,
      });
      throw e;
    } finally {
      syncInFlight = false;
    }
  })

  /** 获取当前同步实时进度与状态（供前端进度条轮询） */
  .get("/api/sync/progress", () => {
    return {
      ...activeSyncProgress,
      elapsedSec: activeSyncProgress.startedAt ? Math.round((Date.now() - activeSyncProgress.startedAt) / 1000) : 0,
    };
  })

  /**
   * 同步哪些运动类型 —— 由使用者在设置页勾选。
   *
   * GET 同时返回分组编码表（前端勾选列表的来源）和当前选中值，
   * 免得前后端各维护一份编码表然后慢慢对不上。
   */
  .get("/api/sync/sports", () => sportSettingsPayload())
  .put("/api/sync/sports", async ({ body }) => {
    try {
      const codes = saveSportTypeCodes((body as any)?.codes);
      return { ok: true, codes };
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
    }
  })

  /** FIT 下载额度（50/24h，海拔分析依赖它） */
  .get("/api/sync/quota", () => fitQuotaStatus())

  /** 后台跟随：手表上传后自动探测 */
  .get("/api/sync/follow", () => followState())
  .post("/api/sync/follow", () => {
    const auth = getAuthStatus();
    if (!auth.connected) {
      return new Response(JSON.stringify({ error: "尚未连接 COROS 账号，无法开启跟随" }), { status: 400 });
    }
    if (auth.mismatch) {
      return new Response(JSON.stringify({ error: "检测到高驰账号不一致，请先确认处理方式" }), { status: 409 });
    }
    return startFollow();
  })
  .delete("/api/sync/follow", () => stopFollow())

  /**
   * 快速同步 —— 给前端按钮用。
   *
   * 与 /api/sync 的区别：
   *  - 智能自适应增量窗口：如果是新跑友无记录，默认拉取 365 天（1年）；若已有数据，则自动按距今日期增量回溯
   *  - 加了并发锁与全局进度广播：连点两下会友好报告当前正在进行的进度，不会造成二次冲击
   *  - 返回结构化结果（含新增了多少条），前端可以明确告诉用户"同步到了"
   */
  .post("/api/sync/quick", async ({ query }) => {
    const auth = getAuthStatus();
    if (!auth.connected) {
      return { ok: false, message: "尚未连接 COROS 账号，请先完成授权" };
    }
    if (auth.mismatch) {
      return { ok: false, message: "检测到高驰账号不一致，请先在看板中确认处理方式" };
    }
    if (syncInFlight) {
      return { ok: false, busy: true, message: activeSyncProgress.message || "同步正在进行中，请稍候" };
    }
    syncInFlight = true;
    const startedAt = Date.now();
    updateSyncProgress({
      active: true,
      phase: "records",
      current: 0,
      total: 100,
      percent: 2,
      message: "正在连接高驰服务...",
      startedAt,
      error: null,
    });
    try {
      const before = db
        .select({ labelId: activities.labelId })
        .from(activities)
        .all().length;

      // 智能自适应同步窗口：
      // 1. 检查当前档案是否曾成功完成过至少一次 365 天的历史全量回溯（确保算法具备 1 年基线锚点）
      const hasFullSync = (sqlite.query(
        "SELECT 1 FROM sync_log WHERE status = 'ok' AND detail LIKE '%\"days\":365%' LIMIT 1"
      ).get() as { 1: number } | undefined) !== undefined;

      let syncDays = 3;
      const latest = one(db.select({ d: activities.dateLabel }).from(activities).orderBy(desc(activities.date)).limit(1).all())?.d;
      if (!latest || !hasFullSync) {
        // 无数据或尚未建立 1 年全量基线：自动拉取 365 天历史训练与比赛锚点
        syncDays = 365;
      } else {
        const lastDate = new Date(latest);
        if (!isNaN(lastDate.getTime())) {
          const diffDays = Math.ceil((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
          syncDays = Math.max(3, Math.min(365, diffDays + 1));
        }
      }
      const result = await syncAll({
        days: syncDays,
        withLaps: true,
        onProgress: (p) => {
          updateSyncProgress({
            active: true,
            ...p,
          });
        },
      });
      const after = db.select().from(activities).all().length;

      // 同步完成后自动跑一遍工作流：把新数据变成可用的结论
      // （海拔、预测、备赛简报、AI 分析…每步可独立开关）
      let workflow: Awaited<ReturnType<typeof runWorkflow>> | null = null;
      const autoRun = query.workflow !== "false" && !isRunning();
      if (autoRun) {
        updateSyncProgress({
          active: true,
          phase: "workflow",
          current: 96,
          total: 100,
          percent: 96,
          message: "正在计算疲劳指数与备赛预测模型...",
        });
        try {
          // 把本次新增的活动 id 传下去，让各 step 只处理增量
          const newCount = after - before;
          const fresh = newCount > 0
            ? db
                .select({ labelId: activities.labelId })
                .from(activities)
                .orderBy(activities.dateLabel)
                .all()
                .slice(-newCount)
                .map((x) => x.labelId)
            : [];
          workflow = await runWorkflow({ labelIds: fresh });
        } catch (e) {
          // 工作流失败不该让同步失败 —— 数据已经进来了
          workflow = null;
          console.error("workflow failed:", e);
        }
      }

      const finalMsg =
        after > before
          ? `同步完成，新增 ${after - before} 次训练` +
            (workflow ? `｜${workflow.summary}` : "")
          : workflow
            ? `无新数据｜${workflow.summary}`
            : "同步完成，没有新数据";

      updateSyncProgress({
        active: false,
        phase: "done",
        current: 100,
        total: 100,
        percent: 100,
        message: finalMsg,
      });

      return {
        ok: true,
        busy: false,
        newActivities: after - before,
        workflow,
        activities: result.activities,
        details: result.details,
        lapRows: result.lapRows,
        errors: result.errors,
        fitQuotaLeft: result.fitQuotaLeft,
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        message: finalMsg,
      };
    } catch (e) {
      const errMsg = `同步失败：${e instanceof Error ? e.message : String(e)}`;
      updateSyncProgress({
        active: false,
        phase: "error",
        percent: 100,
        message: errMsg,
        error: errMsg,
      });
      return {
        ok: false,
        busy: false,
        message: errMsg,
      };
    } finally {
      syncInFlight = false;
    }
  })

  // ---------- 工作流 ----------
  /** 列出所有可插拔步骤及其当前开关状态 */
  .get("/api/workflow/steps", () => ({
    steps: describeSteps(),
    config: loadConfig(),
    running: isRunning(),
  }))

  /** 读取当前配置 */
  .get("/api/workflow/config", () => loadConfig())

  /** 保存配置（每步开关 + 参数） */
  .put("/api/workflow/config", async ({ body }) => {
    const b = (body ?? {}) as Partial<WorkflowConfig>;
    if (!b || typeof b !== "object" || !("steps" in b)) {
      return new Response(JSON.stringify({ error: "缺少 steps" }), { status: 400 });
    }
    return saveConfig(b as WorkflowConfig);
  })

  /** 手动跑一遍工作流（不触发同步） */
  .post("/api/workflow/run", async ({ body, query }) => {
    if (isRunning()) {
      return new Response(JSON.stringify({ error: "工作流正在运行中" }), { status: 409 });
    }
    const b = (body ?? {}) as any;
    const only: string[] | undefined = Array.isArray(b.only) ? b.only : undefined;
    const labelIds: string[] = Array.isArray(b.labelIds) ? b.labelIds : [];
    return await runWorkflow({ labelIds, only });
  })

  /** 上次运行结果（页面刷新后仍能看到） */
  .get("/api/workflow/last", () => loadLastRun())

  // ---------- 赛事管理 ----------
  .get("/api/races", () => listRaces())

  .post("/api/races", async ({ body }) => {
    try {
      const b = (body ?? {}) as any;
      if (!b.date || !b.name || !b.distanceKm) {
        return new Response(JSON.stringify({ error: "缺少 date / name / distanceKm" }), { status: 400 });
      }
      const row = createRace({
        date: b.date,
        name: b.name,
        city: b.city ?? null,
        distanceKm: Number(b.distanceKm),
        goalSec: b.goalSec ? Number(b.goalSec) : null,
        routeText: b.routeText ?? null,
        routeKind: b.routeKind ?? "auto",
        routeFileName: b.routeFileName ?? null,
        gpx: b.gpx ?? null,
        labelId: b.labelId ?? null,
        notes: b.notes ?? null,
      });
      return await buildRaceProfile(row);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 400 },
      );
    }
  })

  /**
   * 只改备注与训练关联，不碰路线。
   *
   * 为什么单独开一个端点：备注是**赛后**才写得出来的（累不累、哪里抽筋，
   * 要跑完才知道），而路线是赛前就定好的。跑完之后再提交一次完整表单，
   * 会有把 GPX 弄丢的风险 —— 所以把「主观体感」和「客观路线」拆开更新。
   */
  .put("/api/races/:id/notes", async ({ params, body }) => {
    const b = (body ?? {}) as any;
    const id = Number(params.id);
    const row = db.select().from(races).where(eq(races.id, id)).get();
    if (!row) return new Response(JSON.stringify({ error: "赛事不存在" }), { status: 404 });

    // labelId 传了就校验它真的存在，避免关联到脏 id 后永远查不出数据
    let labelId = b.labelId === undefined ? row.labelId : b.labelId || null;
    if (labelId) {
      const act = db
        .select({ labelId: activities.labelId })
        .from(activities)
        .where(eq(activities.labelId, labelId))
        .get();
      if (!act) {
        return new Response(
          JSON.stringify({ error: "找不到这次训练，请先同步数据，或检查是否选了同一天的其他记录" }),
          { status: 400 },
        );
      }
    }

    db.update(races)
      .set({
        notes: b.notes === undefined ? row.notes : b.notes || null,
        labelId,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(races.id, id))
      .run();
    return db.select().from(races).where(eq(races.id, id)).get();
  })

  /**
   * 轨迹文件预检 —— 只解析，不入库。
   *
   * 为什么要有这个独立端点：让用户在填完整张表**之前**就知道这份文件能不能用。
   * 否则常见体验是"填了 8 个字段 → 点保存 → 报错 → 不知道是文件选错了还是别的"，
   * 而导错格式是这一步最高频的失败原因。
   *
   * 返回的距离/爬升来自同一套解析器，与真正入库时算出来的完全一致 ——
   * 预检说 42.31km，保存后就不会变成别的数。
   */
  .post("/api/races/parse-route", async ({ body }) => {
    const b = (body ?? {}) as any;
    const parsed = parseRouteFile(String(b.text ?? ""), b.routeKind ?? "auto");
    if (parsed.error || !parsed.track) {
      return {
        ok: false,
        kind: parsed.kind,
        error: parsed.error ?? "轨迹文件解析失败",
      };
    }
    const track = parsed.track;
    return {
      ok: true,
      kind: parsed.kind,
      hasElevation: parsed.hasElevation,
      pointCount: track.points.length,
      /** 剖面图实际会画的点数 —— 展示层裁剪，与入库的完整点序列不是一回事 */
      profilePointCount: pickForDisplay(track.points).length,
      sampleSpacingM: track.sampleSpacingM,
      coarseSpacing: track.sampleSpacingM > COARSE_SPACING_M,
      distanceKm: Number((track.distanceM / 1000).toFixed(2)),
      gainM: track.gainM,
      lossM: track.lossM,
      eleMin: track.eleMin,
      eleMax: track.eleMax,
      sourceNote: routeSourceNote(parsed.kind, b.fileName ?? null),
    };
  })

  /** 上传 GPX 更新路线（赛事名/日期可同时改） */
  .post("/api/races/:id/route", async ({ params, body }) => {
    try {
      const b = (body ?? {}) as any;
      const row = updateRace(Number(params.id), {
        routeText: b.routeText ?? null,
        routeKind: b.routeKind ?? "auto",
        routeFileName: b.routeFileName ?? null,
        gpx: b.gpx ?? null,
        clearRoute: b.clearRoute === true,
        name: b.name,
        date: b.date,
        goalSec: b.goalSec !== undefined ? (b.goalSec ? Number(b.goalSec) : null) : undefined,
        city: b.city,
      });
      if (!row) return new Response(JSON.stringify({ error: "赛事不存在" }), { status: 404 });
      return await buildRaceProfile(row);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 400 },
      );
    }
  })

  .get("/api/races/:id", async ({ params }) => {
    const row = getRace(Number(params.id));
    if (!row) return new Response(JSON.stringify({ error: "赛事不存在" }), { status: 404 });
    return await buildRaceProfile(row);
  })

  /**
   * 完整备赛简报 = 路线画像（静态）+ 备赛方案（动态）。
   *
   * 分成两个端点是刻意的：路线一年不变，算完就该缓存；
   * 而备赛方案每多跑一节课都要重算。前端分开取，避免每次同步都重查 DEM。
   */
  .get("/api/races/:id/briefing", async ({ params }) => {
    const row = getRace(Number(params.id));
    if (!row) return new Response(JSON.stringify({ error: "赛事不存在" }), { status: 404 });
    const profile = await buildRaceProfile(row);
    return { ...profile, briefing: buildBriefing(profile, row.goalSec, row.date) };
  })

  .delete("/api/races/:id", ({ params }) => ({ ok: deleteRace(Number(params.id)) }))

  /**
   * 人工指定某场比赛是否计入能力基准。
   *
   * 自动判定只看数据形态（后程配速与心率同步下滑），不推断原因，
   * 而原因只有本人才知道；规则也不一定适用于每个人。所以这里给一个覆盖入口：
   *   excluded=true  → 强制排除（可带原因）
   *   excluded=false → 强制纳入，覆盖自动判定
   *   excluded=null  → 撤销人工设定，交回自动判定
   *
   * 写在 activities 的额外两列上，而同步的 upsert 不写它们，所以不会被同步冲掉。
   */
  .post("/api/races/anchors/:labelId/exclude", async ({ params, body }) => {
    const b = (body ?? {}) as any;
    const labelId = decodeURIComponent(params.labelId);
    if (typeof b.excluded !== "boolean" && b.excluded !== null) {
      return new Response(JSON.stringify({ error: "excluded 必须是 true / false / null" }), { status: 400 });
    }
    const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 200) : null;
    try {
      setAnchorExclusion(labelId, b.excluded, reason);
      return { ok: true, labelId, excluded: b.excluded, reason };
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
    }
  })

  // ---------- 活动 ----------
  .get("/api/activities", ({ query }) => {
    const q = query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 60), 500);
    const conds = [];
    if (q.from) conds.push(gte(activities.dateLabel, q.from));
    if (q.to) conds.push(lte(activities.dateLabel, q.to));
    if (q.sport) conds.push(eq(activities.sportType, Number(q.sport)));

    const rows = db
      .select()
      .from(activities)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(activities.dateLabel), desc(activities.startTs))
      .limit(limit)
      .all();

    const details = db.select().from(activityDetails).all();
    const detailById = new Map(details.map((d) => [d.labelId, d]));

    return rows.map((a) => {
      const d = detailById.get(a.labelId);
      return {
        ...a,
        detail: d && {
          avgCadence: d.avgCadence, avgPower: d.avgPower, trainingLoad: d.trainingLoad,
          trainingFocus: d.trainingFocus, performance: d.performance, aerobicTe: d.aerobicTe,
          bestKmSec: d.bestKmSec, elevGain: d.elevGain, elevLoss: d.elevLoss,
        },
      };
    });
  })

  .get("/api/activities/:labelId", ({ params }) => {
    const activity = one(db.select().from(activities).where(eq(activities.labelId, params.labelId)).all());
    if (!activity) return { error: "not found" };

    const detail = one(db.select().from(activityDetails).where(eq(activityDetails.labelId, params.labelId)).all());
    const lapRows = db
      .select()
      .from(laps)
      .where(eq(laps.labelId, params.labelId))
      .orderBy(asc(laps.lapIndex))
      .all();
    const reports = db
      .select()
      .from(aiReports)
      .where(eq(aiReports.labelId, params.labelId))
      .orderBy(desc(aiReports.createdAt))
      .all();

    const totalLapDist = lapRows.reduce((s, l) => s + l.distanceM, 0);
    const first = lapRows[0];
    const profile = one(db.select().from(users).all());
    const age = ageFromBirthday(profile?.birthday ?? null);
    const session = buildSessions().find((s) => s.labelIds.includes(params.labelId));

    return {
      activity,
      detail,
      sessionKey: session?.key ?? null,
      laps: lapRows,
      scatter: paceHrScatter(params.labelId),
      reports,
      zones: hrZones(lapRows, hrZoneOptions(age)),
      age,
      lapSummary: {
        count: lapRows.length,
        totalDistanceM: Math.round(totalLapDist),
        granularityM: first ? Math.round(first.distanceM) : null,
        distanceMatches: activity.distanceKm != null
          ? Math.abs(totalLapDist / 1000 - activity.distanceKm) < 0.05
          : null,
        fastestLapSec: lapRows.length > 1 ? Math.min(...lapRows.slice(0, -1).map((l) => l.avgPaceSec ?? Infinity)) : null,
        slowestLapSec: lapRows.length > 1 ? Math.max(...lapRows.slice(0, -1).map((l) => l.avgPaceSec ?? 0)) : null,
      },
    };
  })

  // ---------- 训练量 ----------
  .get("/api/volume/weekly", ({ query }) => weeklyVolume(Number((query as any).weeks ?? 16)))
  .get("/api/volume/monthly", ({ query }) => monthlyVolume(Number((query as any).months ?? 12)))

  // ---------- 训练负荷 ----------
  .get("/api/load", ({ query }) => loadSeries(Number((query as any).days ?? 90)))

  // ---------- 健康 / 恢复 ----------
  .get("/api/health", ({ query }) => {
    const days = Number((query as any).days ?? 60);
    const tail = <T,>(rows: T[]) => rows.slice(-days);
    const healthRows = tail(db.select().from(dailyHealth).orderBy(asc(dailyHealth.date)).all());
    let stressRows = tail(db.select().from(stress).orderBy(asc(stress.date)).all());
    // 容错兜底：若独立的 stress 序列偶发拉取为空，从 dailyHealth 中提取 stressAvg 补齐，保证图表正常展现
    if (stressRows.length === 0 && healthRows.length > 0) {
      stressRows = healthRows
        .filter((h) => h.stressAvg !== null && h.stressAvg !== undefined)
        .map((h) => ({ date: h.dateLabel, avgStress: h.stressAvg, level: null }));
    }
    return {
      health: healthRows,
      hr: tail(db.select().from(heartRate).orderBy(asc(heartRate.date)).all()),
      stress: stressRows,
      sleep: tail(db.select().from(sleep).orderBy(asc(sleep.date)).all()),
    };
  })

  .get("/api/fitness", () => ({
    latest: one(db.select().from(fitness).orderBy(desc(fitness.capturedAt)).limit(1).all()),
    history: db.select().from(fitness).orderBy(asc(fitness.capturedAt)).all(),
  }))

  .get("/api/recovery", () => ({
    latest: one(db.select().from(recovery).orderBy(desc(recovery.capturedAt)).limit(1).all()),
  }))

  .get("/api/profile", () => {
    const row = one(db.select().from(users).all());
    if (!row) return null;
    const age = ageFromBirthday(row.birthday ?? null);
    const z = hrZones([], hrZoneOptions(age));
    return {
      ...row,
      effectiveZones: z?.zones ?? [],
      observedMaxHr: z?.maxHr ?? null,
      hrMethod: z?.method ?? "五区间心率法",
    };
  })

  /**
   * 写入心率档案。
   *
   * 支持两种模式：
   *  - auto：只配置 max_hr / resting_hr，由系统按 HRR 储备百分比推导
   *  - custom：用户直接设定 Z1–Z5 各自的绝对心率范围（可直接对标手表设置）
   */
  .put("/api/profile/hr", async ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const row = one(db.select().from(users).all());
    if (!row) return new Response(JSON.stringify({ error: "没有用户档案，请先同步一次数据" }), { status: 400 });

    const parse = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : NaN;
    };
    const maxHr = parse(b.maxHr);
    const restingHr = parse(b.restingHr);

    if (Number.isNaN(maxHr) || Number.isNaN(restingHr)) {
      return new Response(JSON.stringify({ error: "心率必须是数字，或留空表示自动推算" }), { status: 400 });
    }
    // 下限 60 保证 HRR 有足够跨度；上限 230 覆盖耐力运动员的真实上限
    if (maxHr !== null && (maxHr < 60 || maxHr > 230)) {
      return new Response(JSON.stringify({ error: "最大心率需在 60–230 之间（留空表示自动推算）" }), { status: 400 });
    }
    if (restingHr !== null && (restingHr < 25 || restingHr > 120)) {
      return new Response(JSON.stringify({ error: "静息心率需在 25–120 之间（留空表示自动推算）" }), { status: 400 });
    }
    // HRR 是分区的分母，<=0 会让整个分区计算失效
    const effMax = maxHr ?? row.maxHr ?? 200;
    const effRest = restingHr ?? row.restingHr ?? 55;
    if (effMax - effRest < 30) {
      return new Response(
        JSON.stringify({ error: `最大心率 ${effMax} 与静息心率 ${effRest} 差距太小，无法划分心率区间` }),
        { status: 400 },
      );
    }

    const hrCalcMode = b.hrCalcMode === "custom" ? "custom" : "auto";
    let customHrZonesStr: string | null = null;

    if (hrCalcMode === "custom") {
      const cz = b.customHrZones;
      if (!Array.isArray(cz) || cz.length < 5) {
        return new Response(JSON.stringify({ error: "自定义心率模式需填写全部 5 个区间" }), { status: 400 });
      }
      const validatedZones: Array<{ zone: string; label: string; hrLo: number; hrHi: number | null }> = [];
      const DEFAULT_ZONE_NAMES = [
        { zone: "Z1", label: "有氧耐力" },
        { zone: "Z2", label: "有氧动力" },
        { zone: "Z3", label: "乳酸阈" },
        { zone: "Z4", label: "速度耐力" },
        { zone: "Z5", label: "无氧动力" },
      ];
      for (let i = 0; i < 5; i++) {
        const item = cz[i];
        const lo = parse(item?.hrLo);
        const hi = parse(item?.hrHi);
        if (lo === null || Number.isNaN(lo)) {
          return new Response(
            JSON.stringify({ error: `第 ${i + 1} 区间（${DEFAULT_ZONE_NAMES[i].label}）必须填写有效的心率下限` }),
            { status: 400 },
          );
        }
        if (lo < 40 || lo > 240) {
          return new Response(JSON.stringify({ error: `第 ${i + 1} 区间心率需在 40–240 bpm 之间` }), { status: 400 });
        }
        if (i < 4) {
          if (hi === null || Number.isNaN(hi)) {
            return new Response(
              JSON.stringify({ error: `第 ${i + 1} 区间（${DEFAULT_ZONE_NAMES[i].label}）必须填写有效的心率上限` }),
              { status: 400 },
            );
          }
          if (hi < 40 || hi > 240) {
            return new Response(JSON.stringify({ error: `第 ${i + 1} 区间上限需在 40–240 bpm 之间` }), { status: 400 });
          }
          if (lo >= hi) {
            return new Response(JSON.stringify({ error: `第 ${i + 1} 区间下限 (${lo}) 必须小于上限 (${hi})` }), { status: 400 });
          }
        } else {
          // 第 5 区间（无氧动力）：上限允许留空（表示无上限 / > lo）
          if (hi !== null && !Number.isNaN(hi) && (hi <= lo || hi > 250)) {
            return new Response(JSON.stringify({ error: `第 5 区间若设置上限，必须大于下限 (${lo}) 且不超过 250` }), { status: 400 });
          }
        }
        if (i > 0 && lo < validatedZones[i - 1].hrLo) {
          return new Response(
            JSON.stringify({ error: `第 ${i + 1} 区间起点 (${lo}) 不能低于前一个区间起点 (${validatedZones[i - 1].hrLo})` }),
            { status: 400 },
          );
        }
        validatedZones.push({
          zone: DEFAULT_ZONE_NAMES[i].zone,
          label: String(item?.label || DEFAULT_ZONE_NAMES[i].label),
          hrLo: lo,
          hrHi: hi ?? null,
        });
      }
      customHrZonesStr = JSON.stringify(validatedZones);
    } else if (Array.isArray(b.customHrZones)) {
      try {
        customHrZonesStr = JSON.stringify(b.customHrZones);
      } catch {}
    }

    db.update(users)
      .set({
        maxHr,
        restingHr,
        hrCalcMode,
        ...(customHrZonesStr !== null ? { customHrZones: customHrZonesStr } : {}),
      })
      .where(eq(users.nickname, row.nickname ?? ""))
      .run();

    const updated = one(db.select().from(users).all());
    const age = ageFromBirthday(updated?.birthday ?? null);
    const z = hrZones([], hrZoneOptions(age));
    return {
      ...updated,
      effectiveZones: z?.zones ?? [],
      observedMaxHr: z?.maxHr ?? null,
      hrMethod: z?.method ?? "五区间心率法",
    };
  })

  // ---------- 训练次（session）：同一天的多次记录合并 ----------
  .get("/api/sessions", ({ query }) => {
    const q = query as Record<string, string>;
    const gapSec = q.gapHours ? Number(q.gapHours) * 3600 : undefined;
    return buildSessions({ from: q.from, to: q.to, gapSec });
  })

  .get("/api/sessions/:key", ({ params }) => {
    const session = buildSessions().find((s) => s.key === params.key);
    if (!session) return { error: "not found" };

    const acts = db
      .select()
      .from(activities)
      .where(inArray(activities.labelId, session.labelIds))
      .orderBy(asc(activities.startTs))
      .all();
    const detailRows = db.select().from(activityDetails).where(inArray(activityDetails.labelId, session.labelIds)).all();
    const detailById = new Map(detailRows.map((d) => [d.labelId, d]));
    const profile = one(db.select().from(users).all());
    const age = ageFromBirthday(profile?.birthday ?? null);

    const reports = db
      .select()
      .from(aiSessionReports)
      .where(eq(aiSessionReports.sessionKey, session.key))
      .orderBy(desc(aiSessionReports.createdAt))
      .all();

    const laps = sessionLaps(session.labelIds);
    const peak = Math.max(...laps.map((l) => l.maxHr || l.avgHr || 0), 0);

    return {
      session,
      activities: acts.map((a) => ({ ...a, detail: detailById.get(a.labelId) ?? null })),
      laps,
      zones: hrZones(laps, hrZoneOptions(age)),
      reports,
      age,
    };
  })

  // ---------- 训练次级 AI ----------
  .post("/api/ai/analyze-session", async ({ body }) => {
    try {
      const b = body as any;
      if (!b?.sessionKey) return new Response(JSON.stringify({ error: "缺少 sessionKey" }), { status: 400 });
      return await analyzeSession(String(b.sessionKey), b.focus ?? null);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
    }
  })

  .get("/api/ai/session-reports/:key", ({ params }) =>
    db
      .select()
      .from(aiSessionReports)
      .where(eq(aiSessionReports.sessionKey, params.key))
      .orderBy(desc(aiSessionReports.createdAt))
      .all())

  .get("/api/ai/session-report-index", () => {
    const rows = db
      .select({ sessionKey: aiSessionReports.sessionKey, n: aiSessionReports.id })
      .from(aiSessionReports)
      .all();
    return rows.reduce((m: Record<string, number>, r) => { m[r.sessionKey] = (m[r.sessionKey] ?? 0) + 1; return m; }, {});
  })

  // ---------- 周级 AI ----------
  //
  // weekStart 必须先归一化到周一：前端周跑量柱状图的键来自 weeklyVolume → isoWeek，
  // 永远是周一；但请求参数如果直接传进来而不校验，拼出来的 7 天区间会跨到相邻两周，
  // 结果就是「本周 53.3km vs 上周 53.3km」这种自己跟自己比的假对比。
  .post("/api/ai/analyze-week", async ({ body }) => {
    try {
      const b = body as any;
      if (!b?.weekStart) return new Response(JSON.stringify({ error: "缺少 weekStart" }), { status: 400 });
      const ws = normalizeWeekStart(String(b.weekStart));
      if (!ws) return new Response(JSON.stringify({ error: "weekStart 格式应为 yyyy-mm-dd" }), { status: 400 });
      return await analyzeWeek({ weekStart: ws, focus: b.focus ?? null });
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
    }
  })

  .get("/api/ai/week-reports", ({ query }) => {
    const ws = (query as Record<string, string>)?.weekStart;
    const normalized = ws ? normalizeWeekStart(ws) : null;
    if (!normalized) return new Response(JSON.stringify({ error: "缺少或非法的 weekStart" }), { status: 400 });
    return db
      .select()
      .from(aiWeekReports)
      .where(eq(aiWeekReports.weekStart, normalized))
      .orderBy(desc(aiWeekReports.createdAt))
      .all();
  })

  /** 哪些周已经有分析报告，供训练页在周跑量柱状图上打标记 */
  .get("/api/ai/week-report-index", () => {
    const rows = db
      .select({ weekStart: aiWeekReports.weekStart, n: aiWeekReports.id })
      .from(aiWeekReports)
      .all();
    return rows.reduce((m: Record<string, number>, r) => { m[r.weekStart] = (m[r.weekStart] ?? 0) + 1; return m; }, {});
  })

  // ---------- 马拉松备赛 ----------
  .get("/api/race-prep", ({ query }) => {
    const q = query as Record<string, string>;
    return marathonPrep({ weeks: q.weeks ? Number(q.weeks) : 8, raceDate: q.raceDate ?? null });
  })

  .post("/api/ai/race-prep", async ({ body }) => {
    try {
      const b = (body ?? {}) as any;
      return await analyzeRacePrep({
        weeks: b.weeks ? Number(b.weeks) : 8,
        raceDate: b.raceDate ?? null,
        focus: b.focus ?? null,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
    }
  })

  // ---------- 自建成绩预测 ----------
  .get("/api/prediction", () => {
    try {
      return buildReport();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500 },
      );
    }
  })

  // ---------- AI ----------
  .get("/api/ai/settings", () => {
    const cfg = getAiConfig();
    if (!cfg) return { configured: false };
    return { configured: true, ...cfg, apiKey: `${cfg.apiKey.slice(0, 6)}…${cfg.apiKey.slice(-4)}` };
  })

  .put("/api/ai/settings", async ({ body }) => {
    const b = body as any;
    if (!b?.baseUrl || !b?.model) {
      return new Response(JSON.stringify({ error: "baseUrl / model 都不能为空" }), { status: 400 });
    }
    const old = getAiConfig();
    const isLocal = /localhost|127\.0\.0\.1|11434/.test(String(b.baseUrl));
    let apiKey = String(b.apiKey ?? "").trim();
    if (!apiKey || apiKey.includes("…") || apiKey.includes("...")) {
      if (old?.apiKey) {
        apiKey = old.apiKey;
      } else if (isLocal) {
        apiKey = "ollama";
      } else {
        return new Response(JSON.stringify({ error: "API Key 不能为空" }), { status: 400 });
      }
    }
    saveAiConfig({
      provider: b.provider === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(b.baseUrl),
      apiKey,
      model: String(b.model),
      temperature: Number(b.temperature ?? 0.7),
      maxTokens: Number(b.maxTokens ?? 2000),
    });
    return { ok: true };
  })

  .post("/api/ai/test", async ({ body }) => {
    try {
      const b = body as any;
      const old = getAiConfig();
      const isLocal = /localhost|127\.0\.0\.1|11434/.test(String(b?.baseUrl));
      let apiKey = String(b?.apiKey ?? "").trim();
      if (!apiKey || apiKey.includes("…") || apiKey.includes("...")) {
        if (old?.apiKey) {
          apiKey = old.apiKey;
        } else if (isLocal) {
          apiKey = "ollama";
        } else {
          return new Response(JSON.stringify({ error: "请先填写 API Key" }), { status: 400 });
        }
      }
      const testCfg = {
        provider: (b?.provider === "anthropic" ? "anthropic" : "openai") as "openai" | "anthropic",
        baseUrl: String(b?.baseUrl || "https://api.openai.com/v1"),
        apiKey,
        model: String(b?.model || "gpt-4o-mini"),
        temperature: 0.3,
        maxTokens: Math.max(Number(b?.maxTokens ?? 2000), 2000),
      };
      const t0 = Date.now();
      const reply = await callModel(testCfg, "你是一个连通性测试助手。请只回复：连接成功。", "ping");
      const latencyMs = Date.now() - t0;
      return { ok: true, reply: reply.trim().slice(0, 80), latencyMs };
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
    }
  })

  .post("/api/ai/analyze/:labelId", async ({ params, body }) => {
    try {
      const focus = (body as any)?.focus ?? null;
      return await analyzeActivity(params.labelId, focus);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
    }
  })

  .get("/api/ai/reports/:labelId", ({ params }) =>
    db.select().from(aiReports).where(eq(aiReports.labelId, params.labelId)).orderBy(desc(aiReports.createdAt)).all())

  .get("/api/ai/has-reports", () =>
    db.select({ labelId: aiReports.labelId, n: aiReports.id }).from(aiReports).all().reduce((m: any, r) => {
      m[r.labelId] = (m[r.labelId] ?? 0) + 1; return m;
    }, {}))

  // ---------- 生产模式：同源托管前端，因此完全不需要 CORS ----------
  .get("/*", async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

    // 1. 本地源码运行场景：如果存在物理 web/dist 目录，优先读取热更新静态文件
    const distDir = join(import.meta.dir, "../../web/dist");
    if (existsSync(distDir)) {
      const file = Bun.file(join(distDir, rel));
      if (await file.exists()) return new Response(file);

      const index = Bun.file(join(distDir, "index.html"));
      if (await index.exists()) return new Response(index);
    }

    // 2. 桌面安装包 / 单文件编译场景：从内嵌静态资源表中读取
    if (EMBEDDED_DIST[rel]) {
      const item = EMBEDDED_DIST[rel];
      return new Response(Buffer.from(item.base64, "base64"), {
        headers: { "Content-Type": item.mime },
      });
    }

    // SPA 路由回退到 index.html
    if (EMBEDDED_DIST["index.html"]) {
      const item = EMBEDDED_DIST["index.html"];
      return new Response(Buffer.from(item.base64, "base64"), {
        headers: { "Content-Type": item.mime },
      });
    }

    return new Response("前端尚未构建：请在项目根目录运行 bun run build", { status: 404 });
  })

  // 只监听回环地址，不对外暴露。
  //
  // 为什么必须显式指定：这个服务**没有任何鉴权**，任何能访问到端口的人
  // 都能看到全部训练数据。Elysia 默认监听 0.0.0.0，在笔记本上意味着
  // 同一个 WiFi 下的任何设备都能直连 —— 单用户本地工具绝不能这样。
  // 需要局域网访问时可以让用户显式改 HOST，而不是默默放开。
  .listen({ port: SERVER_PORT, hostname: SERVER_HOST }, () => {
    console.log(`\n  COROS Dashboard → http://${SERVER_HOST}:${SERVER_PORT}`);
    console.log(`  （开发时前端用 Vite 代理，跨域来源：${WEB_ORIGIN}）`);
    if (SERVER_HOST !== "127.0.0.1") {
      console.log(`  ⚠ 已监听 ${SERVER_HOST}（非回环地址）。本服务无鉴权，仅在可信网络内使用。`);
    }
  });

export default app;
