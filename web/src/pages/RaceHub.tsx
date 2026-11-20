import { useState, useEffect } from "react";
import RaceSetup from "./RaceSetup";
import Prediction from "./Prediction";
import RacePrep from "./RacePrep";
import { IconFlag, IconTrend, IconStopwatch } from "../icons";
import { useI18n } from "../i18n";

export type RaceTab = "routes" | "prediction" | "prep";

interface RaceHubProps {
  initialTab?: RaceTab;
  dataVersion: number;
  aiConfigured: boolean;
  onRefresh?: () => void;
}

export default function RaceHub({
  initialTab = "routes",
  dataVersion,
  aiConfigured,
  onRefresh,
}: RaceHubProps) {
  const { isZh } = useI18n();
  const [tab, setTab] = useState<RaceTab>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="hub-container">
      <div className="hub-header">
        <div className="page-head-title">
          <h2>{isZh ? "赛事中心" : "Race Hub"}</h2>
          <div className="sub">
            {isZh
              ? "从赛道路线画像、自建能力预测到长距离体检的一站式备赛决策"
              : "All-in-one race preparation: route elevation profiling, predictive modeling & long-run checkups"}
          </div>
        </div>

        {/* 现代分段切换器 */}
        <div className="hub-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "routes"}
            className={`hub-tab ${tab === "routes" ? "active" : ""}`}
            onClick={() => setTab("routes")}
          >
            <IconFlag size={15} />
            <span>{isZh ? "赛道与简报" : "Course & Briefing"}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prediction"}
            className={`hub-tab ${tab === "prediction" ? "active" : ""}`}
            onClick={() => setTab("prediction")}
          >
            <IconTrend size={15} />
            <span>{isZh ? "自建预测模型" : "Race Prediction"}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prep"}
            className={`hub-tab ${tab === "prep" ? "active" : ""}`}
            onClick={() => setTab("prep")}
          >
            <IconStopwatch size={15} />
            <span>{isZh ? "备赛体检" : "Prep Readiness"}</span>
          </button>
        </div>
      </div>

      <div className="hub-content">
        {tab === "routes" && (
          <RaceSetup key={`race-setup-${dataVersion}`} onChanged={onRefresh} />
        )}
        {tab === "prediction" && (
          <Prediction key={`prediction-${dataVersion}`} />
        )}
        {tab === "prep" && (
          <RacePrep aiConfigured={aiConfigured} dataVersion={dataVersion} />
        )}
      </div>
    </div>
  );
}
