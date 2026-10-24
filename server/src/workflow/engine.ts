/**
 * 工作流内核 —— 可插拔 / 可配置的数据处理流水线。
 *
 * 为什么要有这层：
 *  原来的 syncAll 是写死的 8 步（活动→明细→逐圈→负荷→健康→睡眠→心率→体能）。
 *  后来加的能力（FIT 海拔、爬升分析、路线画像、成绩预测、AI 报告）
 *  全都游离在外，只能手动跑 CLI —— 这是真实的割裂：
 *  你跑完步点一下同步，活动数据进来了，但海拔还是上次的，
 *  路线画像还是三个月前算的，备赛简报里的预测也没更新。
 *
 * 这一层要解决的问题：
 *  1. **可插拔**：每个能力是一个独立 Step，注册进来就能用，不需要改 syncAll
 *  2. **可配置**：每步能单独开关、单独调参数；配置持久化，不用改代码
 *  3. **AI 可选**：依赖 AI 的 Step 在未配置时自动 skip，而不是报错
 *  4. **失败隔离**：某一步挂了不影响其他步（除非它被标记为 critical）
 *  5. **可观测**：每步的耗时、结果、错误都记录下来，前端能看
 *
 * 设计上刻意保持简单：一个 Step 就是一个 async 函数 + 元数据，
 * 没有引入任何工作流框架（dag/cron/队列）——那些东西对这个规模是过度设计。
 */

/** Step 的执行上下文 */
export type StepContext = {
  /** 本次运行的全局配置（来自配置文件 + API 修改） */
  config: WorkflowConfig;
  /** 本次同步新增/更新的活动 id —— 让 Step 只处理增量 */
  labelIds: string[];
  /** 训练结束的秒级时间戳 */
  startedAt: number;
  /** 步骤日志 */
  log: (msg: string) => void;
  /** 工作流配置存储（Step 可以通过它读自己的参数） */
  get: <T>(key: string, fallback: T) => T;
};

export type StepStatus = "ok" | "skipped" | "failed" | "disabled";

export type StepResult = {
  status: StepStatus;
  /** 人类可读的结果摘要，会显示在前端 */
  message: string;
  /** 附带的结构化数据（供后续 step 或调试用） */
  data?: unknown;
};

export type Step = {
  /** 唯一标识，配置文件里用它来开关 */
  name: string;
  /** 中文名，前端展示用 */
  label: string;
  description: string;
  /**
   * 执行顺序（数字越小越早）。
   * 用数字而不是依赖图，是因为这里的流程本质是线性的，
   * 引入拓扑排序只会让配置变复杂而没有实际收益。
   */
  order: number;
  /**
   * 是否关键。
   *  - true：失败会中断后续 step（例如同步本身失败，后面都没意义）
   *  - false：失败只记录，不影响别人（大多数派生计算都属于这类）
   */
  critical?: boolean;
  /**
   * 执行。返回 ok/skipped 即可；抛异常会被执行器捕获成 failed。
   * 想"跳过"请显式返回 skipped 并说明原因 —— 静默跳过会让人以为它在正常工作。
   */
  run: (ctx: StepContext) => Promise<StepResult>;
  /**
   * 可选：判断该步当前是否适用。
   * 返回 false 会记为 skipped，原因写进 message。
   * 「AI 未配置」这类判断放这里最合适。
   */
  applicable?: (ctx: StepContext) => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
};

/** 每步的可配置项 */
export type StepConfig = {
  /** 总开关 */
  enabled: boolean;
  /** 任意自定义参数，Step 自己解释 */
  params?: Record<string, unknown>;
};

export type WorkflowConfig = {
  /** 各 step 的配置，key 是 step.name */
  steps: Record<string, StepConfig>;
  /** 工作流级别的选项 */
  options?: Record<string, unknown>;
};

export type StepRun = {
  name: string;
  label: string;
  status: StepStatus;
  message: string;
  durationMs: number;
  /** 该步的配置快照，便于排查"当时是什么参数跑的" */
  params?: Record<string, unknown>;
};

export type WorkflowRun = {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: StepRun[];
  /** 汇总结论 */
  summary: string;
  ok: boolean;
};

// ---------------- 注册表 ----------------

const registry = new Map<string, Step>();

/** 注册一个 Step。同名覆盖，方便开发时热替换。 */
export function registerStep(step: Step): void {
  registry.set(step.name, step);
}

export function getStep(name: string): Step | undefined {
  return registry.get(name);
}

export function allSteps(): Step[] {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

// ---------------- 默认配置 ----------------

export const DEFAULT_CONFIG: WorkflowConfig = {
  steps: {
    "fetch-altitude": { enabled: true, params: { maxCount: 5 } },
    "compute-prediction": { enabled: true },
    "check-acwr-risk": { enabled: true },
    "compute-race-briefing": { enabled: true },
    "compute-aerobic-decoupling": { enabled: true },
  },
  options: {},
};

// ---------------- 配置存储 ----------------

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDataDir } from "../config.ts";

const getConfigPath = () => process.env.COROS_WORKFLOW_CONFIG ?? join(getDataDir(), "workflow-config.json");
let cached: WorkflowConfig | null = null;
let cachedMtime = 0;
let cachedPath = "";

export function loadConfig(): WorkflowConfig {
  try {
    const configPath = getConfigPath();
    const mtime = existsSync(configPath) ? statSync(configPath).mtimeMs : 0;
    if (cached && cachedMtime === mtime && cachedPath === configPath) return cached;
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as WorkflowConfig;
    // 与默认配置合并，保证新增 step 时旧配置文件也能拿到默认开关
    cached = {
      steps: { ...DEFAULT_CONFIG.steps, ...(raw.steps ?? {}) },
      options: { ...DEFAULT_CONFIG.options, ...(raw.options ?? {}) },
    };
    cachedMtime = mtime;
    cachedPath = configPath;
    return cached;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: WorkflowConfig): WorkflowConfig {
  const configPath = getConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  cached = null;
  cachedMtime = 0;
  cachedPath = "";
  return loadConfig();
}

// ---------------- 运行结果持久化 ----------------

const getLastRunPath = () => process.env.COROS_WORKFLOW_LAST ?? join(getDataDir(), "workflow-last.json");

export function saveLastRun(run: WorkflowRun | null): void {
  try {
    const lastRunPath = getLastRunPath();
    const dir = dirname(lastRunPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (run === null) {
      // 记录"尚无运行"，避免读到上次的陈旧结果
      writeFileSync(lastRunPath, JSON.stringify({ empty: true, at: Math.floor(Date.now() / 1000) }));
    } else {
      writeFileSync(lastRunPath, JSON.stringify(run));
    }
  } catch {
    /* 落盘失败不该影响工作流本身 */
  }
}

export function loadLastRun(): WorkflowRun | null {
  try {
    const lastRunPath = getLastRunPath();
    if (!existsSync(lastRunPath)) return null;
    const d = JSON.parse(readFileSync(lastRunPath, "utf8"));
    if (d?.empty) return null;
    return d?.steps ? (d as WorkflowRun) : null;
  } catch {
    return null;
  }
}

// ---------------- 执行器 ----------------

let running = false;

export function isRunning(): boolean {
  return running;
}

/**
 * 跑一遍工作流。
 *
 * 语义要点：
 *  - 某步 critical 且失败 → 中断，剩余步记为 disabled
 *  - 某步非 critical 失败 → 继续，后面的步照跑
 *  - 返回每一步的耗时和结论，前端直接展示
 */
export async function runWorkflow(
  opts: { labelIds: string[]; only?: string[] } = { labelIds: [] },
): Promise<WorkflowRun> {
  const startedAt = Math.floor(Date.now() / 1000);
  const t0 = Date.now();
  const config = loadConfig();
  const steps = allSteps().filter((s) => !opts.only || opts.only.includes(s.name));

  running = true;
  const runs: StepRun[] = [];
  let aborted = false;

  for (const step of steps) {
    if (aborted) {
      runs.push({
        name: step.name,
        label: step.label,
        status: "disabled",
        message: "前序步骤失败，已跳过",
        durationMs: 0,
      });
      continue;
    }

    const cfg = config.steps[step.name];
    const params = cfg?.params ?? {};
    const started = Date.now();

    const record = (status: StepStatus, message: string) => {
      runs.push({
        name: step.name,
        label: step.label,
        status,
        message,
        durationMs: Date.now() - started,
        params,
      });
    };

    // 1) 总开关
    if (cfg && !cfg.enabled) {
      record("disabled", "已在配置中关闭");
      continue;
    }

    try {
      const ctx: StepContext = {
        config,
        labelIds: opts.labelIds,
        startedAt,
        log: (msg) => record("ok", msg),
        get: <T,>(key: string, fallback: T) => (params[key] as T) ?? fallback,
      };

      // 2) 适用性判断（AI 未配置这类）
      if (step.applicable) {
        const a = await step.applicable(ctx);
        if (!a.ok) {
          record("skipped", a.reason ?? "不适用");
          continue;
        }
      }

      // 3) 执行
      const r = await step.run(ctx);
      record(r.status, r.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record("failed", msg);
      if (step.critical) aborted = true;
    }
  }

  running = false;

  const ok = runs.filter((r) => r.status === "ok").length;
  const skipped = runs.filter((r) => r.status === "skipped").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const disabled = runs.filter((r) => r.status === "disabled").length;

  const result: WorkflowRun = {
    startedAt,
    finishedAt: Math.floor(Date.now() / 1000),
    durationMs: Date.now() - t0,
    steps: runs,
    ok: failed === 0,
    summary: `完成 ${ok} 步` +
      (skipped ? `，跳过 ${skipped}` : "") +
      (failed ? `，失败 ${failed}` : "") +
      (disabled ? `，未执行 ${disabled}` : ""),
  };
  saveLastRun(result);
  return result;
}

/** 把配置和内置默认对齐，供前端展示"有哪些步骤可以开关" */
export function describeSteps() {
  return allSteps().map((s) => {
    const cfg = loadConfig().steps[s.name];
    return {
      name: s.name,
      label: s.label,
      description: s.description,
      order: s.order,
      critical: s.critical ?? false,
      enabled: cfg?.enabled ?? true,
      params: cfg?.params ?? {},
    };
  });
}