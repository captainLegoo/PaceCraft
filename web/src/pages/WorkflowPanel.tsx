import { useEffect, useState } from "react";
import { IconLayers } from "../icons";

type StepMeta = {
  name: string;
  label: string;
  description: string;
  order: number;
};

/**
 * 自动化工作流面板。
 * 展示数据同步完成后系统在后台默认执行的自动化分析与计算步骤。
 */
export default function WorkflowPanel() {
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workflow/steps")
      .then((r) => r.json())
      .then((d) => setSteps(d.steps ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="wf-head">
        <div className="wf-head-main">
          <h3 className="card-title" style={{ marginBottom: 2 }}>
            <IconLayers size={14} /> 自动化工作流
          </h3>
          <p className="card-sub" style={{ margin: 0 }}>
            数据同步完成后，系统在后台默认自动执行以下分析与计算步骤：
          </p>
        </div>
      </div>

      {err && <div className="banner error" style={{ marginTop: 10 }}>{err}</div>}

      <div className="table-scroll">
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>步骤</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.name}>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--text-faint)", marginRight: 6 }}>{s.order}</span>
                  {s.label}
                </td>
                <td className="cell-text" style={{ textAlign: "left", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                  {s.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
