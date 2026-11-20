import { useEffect, useState } from "react";
import { api } from "../api";
import { IconLayers } from "../icons";

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

/**
 * 自动化工作流面板。
 * 展示数据同步完成后系统在后台默认执行的自动化分析与计算步骤，
 * 并支持查看最近一次运行状态与一键重跑分析。
 */
export default function WorkflowPanel() {
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
      setMsg(`工作流执行完成：${res.summary}`);
    } catch (e: any) {
      setErr(e?.message || "执行工作流失败");
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
            <IconLayers size={14} /> 自动化工作流
          </h3>
          <p className="card-sub" style={{ margin: 0 }}>
            数据同步完成后，系统在后台默认自动依次执行以下分析与计算：
          </p>
        </div>
        <button
          className="btn primary small"
          onClick={handleRun}
          disabled={running}
          style={{ flexShrink: 0, padding: "5px 12px", fontSize: 12 }}
        >
          {running ? "正在分析计算..." : "立即执行自动化分析"}
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
            上次分析：
            <strong style={{ color: "var(--text)" }}>
              {new Date(lastRun.finishedAt * 1000).toLocaleString("zh-CN")}
            </strong>
            <span style={{ marginLeft: 8 }}>({lastRun.durationMs}ms)</span>
          </span>
          <span
            className={`pill ${lastRun.ok ? "good" : "warn"}`}
            style={{ fontSize: 11 }}
          >
            {lastRun.summary}
          </span>
        </div>
      )}

      {err && <div className="banner error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="banner info" style={{ marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, idx) => {
          const run = stepRunMap.get(s.name);
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
                  步骤 {idx + 1} · {s.label}
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
                      ? "✓ 已完成"
                      : run.status === "skipped"
                      ? "⏭ 跳过"
                      : run.status === "disabled"
                      ? "⏹ 未启用"
                      : "❌ 失败"}
                    {run.durationMs > 0 ? ` (${run.durationMs}ms)` : ""}
                  </span>
                )}
              </div>
              <span style={{ color: "var(--text-dim)", lineHeight: 1.4, fontSize: 11.5 }}>
                {s.description}
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
                  分析结论：{run.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
