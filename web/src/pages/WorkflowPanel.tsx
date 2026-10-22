import { useCallback, useEffect, useState } from "react";
import { IconLayers } from "../icons";

type StepMeta = {
  name: string;
  label: string;
  description: string;
  order: number;
  critical: boolean;
  enabled: boolean;
  params: Record<string, unknown>;
};

type StepRun = {
  name: string;
  label: string;
  status: "ok" | "skipped" | "failed" | "disabled";
  message: string;
  durationMs: number;
  params?: Record<string, unknown>;
};

type RunResult = {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: StepRun[];
  summary: string;
  ok: boolean;
};

type Config = {
  steps: Record<string, { enabled: boolean; params?: Record<string, unknown> }>;
  options?: Record<string, unknown>;
};

const STATUS_ICON: Record<StepRun["status"], string> = {
  ok: "✓",
  skipped: "○",
  failed: "✗",
  disabled: "·",
};

const STATUS_COLOR: Record<StepRun["status"], string> = {
  ok: "var(--good)",
  skipped: "var(--text-faint)",
  failed: "var(--warn)",
  disabled: "var(--text-faint)",
};

/**
 * 自动化工作流面板。
 *
 * 这个面板要回答三个问题：
 *  1. 上次同步后自动跑了什么、结果如何（可观测）
 *  2. 哪些步骤可以单独开关（可配置）
 *  3. 为什么某步没跑（跳过原因要说清楚，不能静默）
 */
export default function WorkflowPanel() {
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [last, setLast] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/workflow/steps")
      .then((r) => r.json())
      .then((d) => {
        setSteps(d.steps ?? []);
        setConfig(d.config ?? null);
        setRunning(!!d.running);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const loadLast = useCallback(() => {
    fetch("/api/workflow/last")
      .then((r) => r.json())
      .then((d) => d && setLast(d as RunResult))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadLast();
    // 有运行结果时轮询，感知后台自动触发
    const t = setInterval(() => {
      fetch("/api/workflow/steps")
        .then((r) => r.json())
        .then((d) => setRunning(!!d.running))
        .catch(() => {});
      loadLast();
    }, 8000);
    return () => clearInterval(t);
  }, [load, loadLast]);

  const toggle = async (name: string, enabled: boolean) => {
    try {
      const next: Config = {
        steps: { ...(config?.steps ?? {}) },
        options: config?.options,
      };
      next.steps[name] = { ...(next.steps[name] ?? {}), enabled };
      const r = await fetch("/api/workflow/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setConfig(await r.json());
      load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const runNow = async () => {
    setRunning(true);
    setErr(null);
    try {
      const r = await fetch("/api/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      setLast(await r.json());
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const lastByName = new Map((last?.steps ?? []).map((s) => [s.name, s]));

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="wf-head">
        <div className="wf-head-main">
          <h3 className="card-title" style={{ marginBottom: 2 }}><IconLayers size={14} />自动化工作流</h3>
          <p className="card-sub" style={{ margin: 0 }}>
            同步完成后自动运行以下步骤，每步可单独开关
            {last && <span style={{ color: "var(--text-faint)" }}> · 上次 {last.summary}（{last.durationMs}ms）</span>}
          </p>
        </div>
        <div className="wf-actions">
          <button className="sync-btn" style={{ maxWidth: 130, marginBottom: 0 }} onClick={() => void runNow()} disabled={running}>
            {running ? "运行中…" : "立即运行"}
          </button>
          <button className="pill" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
            {open ? "收起" : "配置"}
          </button>
        </div>
      </div>

      {err && <div className="banner error" style={{ marginTop: 10 }}>{err}</div>}

      <div className="table-scroll">
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr><th>步骤</th><th>说明</th><th>上次结果</th><th>状态</th></tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const r = lastByName.get(s.name);
              return (
                <tr key={s.name}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    <span style={{ color: "var(--text-faint)", marginRight: 6 }}>{s.order}</span>
                    {s.label}
                  </td>
                  <td className="cell-text" style={{ textAlign: "left", fontSize: 11.5, color: "var(--text-dim)" }}>{s.description}</td>
                  <td className="cell-text" style={{ textAlign: "left", fontSize: 11.5 }}>
                    {r ? (
                      <span style={{ color: r.status === "failed" ? "var(--warn)" : "var(--text-dim)" }}>
                        <span style={{ color: STATUS_COLOR[r.status], marginRight: 5 }}>{STATUS_ICON[r.status]}</span>
                        {r.message}
                        <span style={{ color: "var(--text-faint)" }}> · {r.durationMs}ms</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>尚未运行</span>
                    )}
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) => void toggle(s.name, e.target.checked)}
                      />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--text-dim)" }}>工作流参数</h4>
          <div className="grid g2" style={{ gap: 10 }}>
            {steps
              .filter((s) => Object.keys(s.params).length > 0)
              .map((s) => (
                <div key={s.name} className="stat">
                  <span className="label">{s.label} · 参数</span>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                    {Object.entries(s.params).map(([k, v]) => (
                      <div key={k}>
                        <code style={{ color: "var(--accent)" }}>{k}</code> = {String(v)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            配置文件保存在 <code>/tmp/coros-workflow.json</code>，也可以直接改这个文件调整参数。
          </div>
        </div>
      )}
    </div>
  );
}