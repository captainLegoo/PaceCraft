import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db/client.ts";
import {
  aiReports, aiSessionReports, aiSettings, aiWeekReports, activities, activityDetails, dailyHealth, fitness,
  heartRate, laps, races, recovery, sleep, stress, syncLog, trainingLoad, users,
} from "./db/schema.ts";
import { SERVER_HOST, SERVER_PORT, WEB_ORIGIN } from "./config.ts";
import { ageFromBirthday, buildSessions, hrZoneOptions, hrZones, loadSeries, monthlyVolume, paceHrScatter, sessionLaps, weeklyVolume } from "./analytics.ts";
import { syncAll } from "./coros/sync.ts";
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
import { analyzeActivity, analyzeSession, getAiConfig, saveAiConfig } from "./ai/provider.ts";
import { analyzeWeek, normalizeWeekStart } from "./ai/week.ts";
import { buildReport } from "./prediction/pipeline.ts";
import { analyzeRacePrep, marathonPrep } from "./prediction/prep.ts";

const one = <T>(rows: T[]) => rows[0] ?? null;

/**
 * 快速同步的并发锁。
 * 用模块级变量而不是 Elysia 的 state：单进程够用，且不依赖框架内部 API。
 */
let syncInFlight = false;

const app = new Elysia()
  .get("/api/status", () => ({
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
  }))

  .post("/api/sync", async ({ query }) => {
    const days = Number((query as any).days ?? 120);
    const withLaps = (query as any).laps !== "false";
    return await syncAll({ days, withLaps });
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
  .post("/api/sync/follow", () => startFollow())
  .delete("/api/sync/follow", () => stopFollow())

  /**
   * 快速同步 —— 给前端按钮用。
   *
   * 与 /api/sync 的区别：
   *  - 只回溯 3 天而不是 120 天：刚跑完的那次训练在 3 天内就够了，快得多
   *  - 加了并发锁：连点两下会同时发起两次全量拉取，把 COROS 的接口打爆
   *  - 返回结构化结果（含新增了多少条），前端可以明确告诉用户"同步到了"
   */
  .post("/api/sync/quick", async ({ query }) => {
    if (syncInFlight) {
      return { ok: false, busy: true, message: "同步正在进行中，请稍候" };
    }
    syncInFlight = true;
    const startedAt = Date.now();
    try {
      const before = db
        .select({ labelId: activities.labelId })
        .from(activities)
        .all().length;

      // 3 天窗口足够覆盖「今天跑完立刻点」，同时避免触发过多接口调用
      const result = await syncAll({ days: 3, withLaps: true });
      const after = db.select().from(activities).all().length;

      // 同步完成后自动跑一遍工作流：把新数据变成可用的结论
      // （海拔、预测、备赛简报、AI 分析…每步可独立开关）
      let workflow: Awaited<ReturnType<typeof runWorkflow>> | null = null;
      const autoRun = query.workflow !== "false" && !isRunning();
      if (autoRun) {
        try {
          // 把本次新增的活动 id 传下去，让各 step 只处理增量
          const fresh = db
            .select({ labelId: activities.labelId })
            .from(activities)
            .orderBy(activities.dateLabel)
            .all()
            .slice(after - before || 1)
            .map((x) => x.labelId);
          workflow = await runWorkflow({ labelIds: fresh });
        } catch (e) {
          // 工作流失败不该让同步失败 —— 数据已经进来了
          workflow = null;
          console.error("workflow failed:", e);
        }
      }

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
        message:
          after > before
            ? `同步完成，新增 ${after - before} 次训练` +
              (workflow ? `｜${workflow.summary}` : "")
            : workflow
              ? `无新数据｜${workflow.summary}`
              : "同步完成，没有新数据",
      };
    } catch (e) {
      return {
        ok: false,
        busy: false,
        message: `同步失败：${e instanceof Error ? e.message : String(e)}`,
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
        // useLibraryRoute 必须透传：前端「先不填路线」就靠它。
        // 以前这里漏了它，服务端永远拿到 undefined → 永远去查内置库 → 空库必报错
        useLibraryRoute: b.useLibraryRoute,
        routeText: b.routeText ?? null,
        routeKind: b.routeKind ?? "auto",
        routeFileName: b.routeFileName ?? null,
        gpx: b.gpx ?? null,
        routeKey: b.routeKey ?? null,
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
        routeKey: b.routeKey ?? null,
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

    return {
      activity,
      detail,
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
    return {
      health: tail(db.select().from(dailyHealth).orderBy(asc(dailyHealth.date)).all()),
      hr: tail(db.select().from(heartRate).orderBy(asc(heartRate.date)).all()),
      stress: tail(db.select().from(stress).orderBy(asc(stress.date)).all()),
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

  .get("/api/profile", () => one(db.select().from(users).all()))

  /**
   * 写入心率档案。
   *
   * 只有 max_hr / resting_hr 走这个端点 —— 其余字段由 COROS 同步负责，
   * 这里不碰，避免用户填的值被下一次同步覆盖。
   *
   * 存 null / 空串表示「交回自动推算」：max_hr 回退到 observedMaxHr（从分圈推算），
   * resting_hr 回退到生理中位数。校验范围按生理可能区间给，
   * 明显不合理的值直接拒绝而不是静默存进去 —— 错的值会让全部分区错位，比没有更糟。
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

    db.update(users).set({ maxHr, restingHr }).where(eq(users.nickname, row.nickname ?? "")).run();
    return one(db.select().from(users).all());
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
    if (!b?.baseUrl || !b?.apiKey || !b?.model) {
      return new Response(JSON.stringify({ error: "baseUrl / apiKey / model 都不能为空" }), { status: 400 });
    }
    saveAiConfig({
      provider: b.provider === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(b.baseUrl),
      apiKey: String(b.apiKey),
      model: String(b.model),
      temperature: Number(b.temperature ?? 0.7),
      maxTokens: Number(b.maxTokens ?? 2000),
    });
    return { ok: true };
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
    const distDir = join(import.meta.dir, "../../web/dist");
    if (!existsSync(distDir)) {
      return new Response("前端尚未构建：请在项目根目录运行 bun run build", { status: 404 });
    }
    const pathname = new URL(request.url).pathname;
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = Bun.file(join(distDir, rel));
    if (await file.exists()) return new Response(file);

    const index = Bun.file(join(distDir, "index.html"));
    if (await index.exists()) return new Response(index); // SPA 回退
    return new Response("Not Found", { status: 404 });
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
