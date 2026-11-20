import { useEffect, useState } from "react";
import { api } from "../api";
import { IconLayers } from "../icons";
import { useI18n } from "../i18n";

type StepMeta = {
  name: string;
  label: string;
  description: string;
  order: number;
};

type StepRun = {
  name: string;
  label: string;
  status: "ok" | "skipped" | "failed" | "disabled";
  message: string;
  durationMs: number;
};

type WorkflowLastRun = {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: StepRun[];
  summary: string;
  ok: boolean;
};

const STEP_LABEL_EN: Record<string, string> = {
  "训练海拔": "Workout Elevation",
  "成绩预测模型": "Performance Prediction",
  "急慢性负荷比 (ACWR)": "Acute:Chronic Load (ACWR)",
  "赛事路线与备赛": "Race Route & Briefing",
  "有氧脱钩率分析": "Aerobic Decoupling",
};

const STEP_DESC_EN: Record<string, string> = {
  "为新增活动下载 FIT，提取实测海拔（受每日 50 个下载限额约束）": "Download FIT files for new activities to extract elevation (subject to 50/day limit)",
  "重算阈值配速、爬升能力与各距离成绩预测（纯计算，不调用外部接口）": "Recalculate threshold pace, climbing cost and race predictions (pure local computation)",
  "基于 Gabbett 负荷模型评估短期疲劳与长期体能比值，预警负荷激增与伤病风险": "Evaluate ACWR via Gabbett impulse-response model to detect fatigue spikes and injury risk",
  "重算目标赛事的路线爬升画像与备赛简报（预测、配速、备赛日历）": "Recalculate target race elevation profile, pace strategy and briefing",
  "基于 Joe Friel 有氧脱钩模型，检测长距离稳态跑前半程效率因子衰减 (<5% 优秀)": "Joe Friel aerobic decoupling model evaluating cardiovascular drift in steady-state runs (<5% optimal)",
};

function formatWorkflowSummary(summary: string | undefined, isZh: boolean): string {
  if (!summary) return "";
  if (isZh) return summary;
  return summary
    .replace(/完成\s*(\d+)\s*步/g, "$1 completed")
    .replace(/跳过\s*(\d+)/g, "$1 skipped")
    .replace(/失败\s*(\d+)/g, "$1 failed");
}

function formatWorkflowMessage(msg: string | undefined, isZh: boolean): string {
  if (!msg) return "";
  if (isZh) return msg;
  return msg
    .replace(/有\s*(\d+)\s*个活动待补，但\s*FIT\s*额度或数据不可用/g, "$1 activities pending, but FIT quota or data unavailable")
    .replace(/阈值配速/g, "Threshold pace")
    .replace(/爬升短板/g, "Climbing gap")
    .replace(/减量恢复区/g, "Recovery/Taper zone")
    .replace(/最佳竞技区/g, "Sweet spot")
    .replace(/过度疲劳区/g, "Overload zone")
    .replace(/伤病高危区/g, "High injury risk")
    .replace(/短期负荷/g, "Acute load")
    .replace(/低于长期基线/g, "below chronic baseline")
    .replace(/高于长期基线/g, "above chronic baseline")
    .replace(/疲劳充分消退，适宜赛前减量或恢复/g, "fatigue fully dissipated, optimal for taper/recovery")
    .replace(/体能处于超量恢复黄金窗口/g, "golden supercompensation window")
    .replace(/置信度\s*中/g, "Confidence: Med")
    .replace(/置信度\s*高/g, "Confidence: High")
    .replace(/置信度\s*低/g, "Confidence: Low")
    .replace(/起步配速/g, "Start pace")
    .replace(/爬升/g, "Climb")
    .replace(/预测/g, "Predicted")
    .replace(/最近训练分圈数据不足或心率缺失/g, "Insufficient recent lap data or missing HR")
    .replace(/仅\s*(\d+)\s*圈有效/g, "$1 valid laps")
    .replace(/无法进行前后半分段/g, "unable to split halves")
    .replace(/重算完成/g, "Recalculated successfully");
}

/**
 * 自动化工作流面板。
 * 展示数据同步完成后系统在后台默认执行的自动化分析与计算步骤，
 * 并支持查看最近一次运行状态与一键重跑分析。
 */
export default function WorkflowPanel() {
  const { isZh } = useI18n();
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const [lastRun, setLastRun] = useState<WorkflowLastRun | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadData = () => {
    api
      .workflowSteps()
      .then((d) => setSteps(d.steps ?? []))
      .catch((e) => setErr(String(e)));

    api
      .workflowLast()
      .then((d) => setLastRun(d))
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.runWorkflow();
      setLastRun(res);
      setMsg(isZh ? `工作流执行完成：${res.summary}` : `Workflow completed: ${res.summary}`);
    } catch (e: any) {
      setErr(e?.message || (isZh ? "执行工作流失败" : "Failed to run workflow"));
    } finally {
      setRunning(false);
    }
  };

  const stepRunMap = new Map<string, StepRun>();
  if (lastRun?.steps) {
    for (const r of lastRun.steps) {
      stepRunMap.set(r.name, r);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <h3 className="card-title" style={{ marginBottom: 2 }}>
            <IconLayers size={14} /> {isZh ? "自动化工作流" : "Automated Workflows"}
          </h3>
          <p className="card-sub" style={{ margin: 0 }}>
            {isZh
              ? "数据同步完成后，系统在后台默认自动依次执行以下分析与计算："
              : "After data sync completes, the background pipeline executes these analysis steps:"}
          </p>
        </div>
        <button
          className="btn primary small"
          onClick={handleRun}
          disabled={running}
          style={{ flexShrink: 0, padding: "5px 12px", fontSize: 12 }}
        >
          {running
            ? isZh
              ? "正在分析计算..."
              : "Analyzing..."
            : isZh
              ? "立即执行自动化分析"
              : "Run Analysis Now"}
        </button>
      </div>

      {lastRun && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--surface-3)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 10,
            marginTop: 4,
          }}
        >
          <span style={{ color: "var(--text-dim)" }}>
            {isZh ? "上次分析：" : "Last run: "}
            <strong style={{ color: "var(--text)" }}>
              {new Date(lastRun.finishedAt * 1000).toLocaleString(isZh ? "zh-CN" : "en-US")}
            </strong>
            <span style={{ marginLeft: 8 }}>({lastRun.durationMs}ms)</span>
          </span>
          <span
            className={`pill ${lastRun.ok ? "good" : "warn"}`}
            style={{ fontSize: 11 }}
          >
            {formatWorkflowSummary(lastRun.summary, isZh)}
          </span>
        </div>
      )}

      {err && <div className="banner error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="banner info" style={{ marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, idx) => {
          const run = stepRunMap.get(s.name);
          const stepLabel = isZh ? s.label : (STEP_LABEL_EN[s.label] || s.label);
          const stepDesc = isZh ? s.description : (STEP_DESC_EN[s.description] || s.description);
          return (
            <div
              key={s.name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "8px 10px",
                background: "var(--surface-2)",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span
                  className="pill"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    background: "var(--surface-3)",
                    flexShrink: 0,
                  }}
                >
                  {isZh ? `步骤 ${idx + 1} · ${stepLabel}` : `Step ${idx + 1} · ${stepLabel}`}
                </span>
                {run && (
                  <span
                    className={`pill ${
                      run.status === "ok"
                        ? "good"
                        : run.status === "skipped"
                        ? "dim"
                        : run.status === "disabled"
                        ? "dim"
                        : "warn"
                    }`}
                    style={{ fontSize: 10 }}
                  >
                    {run.status === "ok"
                      ? isZh ? "✓ 已完成" : "✓ Done"
                      : run.status === "skipped"
                      ? isZh ? "⏭ 跳过" : "⏭ Skipped"
                      : run.status === "disabled"
                      ? isZh ? "⏹ 未启用" : "⏹ Disabled"
                      : isZh ? "❌ 失败" : "❌ Failed"}
                    {run.durationMs > 0 ? ` (${run.durationMs}ms)` : ""}
                  </span>
                )}
              </div>
              <span style={{ color: "var(--text-dim)", lineHeight: 1.4, fontSize: 11.5 }}>
                {stepDesc}
              </span>
              {run?.message && (
                <div
                  style={{
                    marginTop: 2,
                    padding: "4px 8px",
                    background: "var(--surface-3)",
                    borderRadius: 4,
                    fontSize: 11,
                    color: run.status === "ok" ? "var(--good)" : "var(--text-dim)",
                    lineHeight: 1.4,
                  }}
                >
                  {isZh ? "分析结论：" : "Result: "}
                  {formatWorkflowMessage(run.message, isZh)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
