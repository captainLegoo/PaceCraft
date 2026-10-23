import { useEffect, useState } from "react";
import { apiUrl } from "../api";
import { IconLayers } from "../icons";

type StepMeta = {
  name: string;
  label: string;
  description: string;
  order: number;
};

/**
 * 自动化工作流面板（紧凑精简视图）。
 * 展示数据同步完成后系统在后台默认执行的自动化分析与计算步骤。
 */
export default function WorkflowPanel() {
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/workflow/steps"))
      .then((r) => r.json())
      .then((d) => setSteps(d.steps ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: 2 }}>
        <IconLayers size={14} /> 自动化工作流
      </h3>
      <p className="card-sub" style={{ margin: "0 0 10px" }}>
        数据同步完成后，系统在后台默认自动依次执行以下分析与计算：
      </p>

      {err && <div className="banner error">{err}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, idx) => (
          <div
            key={s.name}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "8px 10px",
              background: "var(--surface-2)",
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <span
              className="pill"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-dim)",
                background: "var(--surface-3)",
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              步骤 {idx + 1} · {s.label}
            </span>
            <span style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              {s.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
