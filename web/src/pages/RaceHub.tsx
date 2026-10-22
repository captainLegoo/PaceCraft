import { useState, useEffect } from "react";
import RaceSetup from "./RaceSetup";
import Prediction from "./Prediction";
import RacePrep from "./RacePrep";
import { IconFlag, IconTrend, IconStopwatch } from "../icons";

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
          <h2>赛事中心</h2>
          <div className="sub">从赛道路线画像、自建能力预测到长距离体检的一站式备赛决策</div>
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
            <span>赛道与简报</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prediction"}
            className={`hub-tab ${tab === "prediction" ? "active" : ""}`}
            onClick={() => setTab("prediction")}
          >
            <IconTrend size={15} />
            <span>自建预测模型</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prep"}
            className={`hub-tab ${tab === "prep" ? "active" : ""}`}
            onClick={() => setTab("prep")}
          >
            <IconStopwatch size={15} />
            <span>备赛体检</span>
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
