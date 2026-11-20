import { useState, useEffect } from "react";
import Health from "./Health";
import Fitness from "./Fitness";
import { IconPulse, IconTrophy } from "../icons";
import { useI18n } from "../i18n";

export type ReadinessTab = "recovery" | "fitness";

interface ReadinessProps {
  initialTab?: ReadinessTab;
  dataVersion: number;
}

export default function Readiness({
  initialTab = "recovery",
  dataVersion,
}: ReadinessProps) {
  const { isZh } = useI18n();
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
          <h2>{isZh ? "身体状态" : "Readiness & Recovery"}</h2>
          <div className="sub">
            {isZh
              ? "恢复度、心率变异性、睡眠质量与体能评估"
              : "Recovery, HRV (Heart Rate Variability), sleep quality & physiological fitness tracking"}
          </div>
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
            <span>{isZh ? "日常恢复与睡眠" : "Daily Recovery & Sleep"}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "fitness"}
            className={`hub-tab ${tab === "fitness" ? "active" : ""}`}
            onClick={() => setTab("fitness")}
          >
            <IconTrophy size={15} />
            <span>{isZh ? "体能与能力评估" : "Fitness & Physiological Assessment"}</span>
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
