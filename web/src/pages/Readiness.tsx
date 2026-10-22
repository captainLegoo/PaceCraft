import { useState, useEffect } from "react";
import Health from "./Health";
import Fitness from "./Fitness";
import { IconPulse, IconTrophy } from "../icons";

export type ReadinessTab = "recovery" | "fitness";

interface ReadinessProps {
  initialTab?: ReadinessTab;
  dataVersion: number;
}

export default function Readiness({
  initialTab = "recovery",
  dataVersion,
}: ReadinessProps) {
  const [tab, setTab] = useState<ReadinessTab>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="hub-container">
      <div className="hub-header">
        <div className="page-head-title">
          <h2>身体状态</h2>
          <div className="sub">恢复度、心率变异性、睡眠质量与体能评估</div>
        </div>

        <div className="hub-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "recovery"}
            className={`hub-tab ${tab === "recovery" ? "active" : ""}`}
            onClick={() => setTab("recovery")}
          >
            <IconPulse size={15} />
            <span>日常恢复与睡眠</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "fitness"}
            className={`hub-tab ${tab === "fitness" ? "active" : ""}`}
            onClick={() => setTab("fitness")}
          >
            <IconTrophy size={15} />
            <span>体能与能力评估</span>
          </button>
        </div>
      </div>

      <div className="hub-content">
        {tab === "recovery" && (
          <Health key={`health-${dataVersion}`} />
        )}
        {tab === "fitness" && (
          <Fitness key={`fitness-${dataVersion}`} />
        )}
      </div>
    </div>
  );
}
