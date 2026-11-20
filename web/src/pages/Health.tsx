import { useEffect, useState } from "react";
import { api, type GarminHealthRecord } from "../api";
import { LineChart, fmtDur } from "../charts";
import { IconBattery, IconHeart, IconMoon, IconPulse, IconRecovery } from "../icons";
import { useI18n } from "../i18n";

type HealthBrandFilter = "all" | "garmin" | "coros";

function formatMinutes(min: number, isZh: boolean = true): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (isZh ? `${h}小时${m}分` : `${h}h ${m}m`) : (isZh ? `${m}分` : `${m}m`);
}

function formatSeconds(sec: number, isZh: boolean = true): string {
  return formatMinutes(Math.round(sec / 60), isZh);
}

export default function Health() {
  const { t, isZh } = useI18n();
  const [d, setD] = useState<any>(null);
  const [recovery, setRecovery] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<HealthBrandFilter>("all");

  useEffect(() => {
    Promise.all([api.health(60), api.recovery()])
      .then(([h, r]) => {
        setD(h);
        setRecovery(r.latest);
      })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="banner error">{err}</div>;
  if (!d) {
    return (
      <div>
        <div className="skeleton skeleton-hero" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    );
  }

  const { health, hr, stress, sleep, garmin } = d;
  const garminRecords: GarminHealthRecord[] = garmin?.records ?? [];
  const latestGarmin: GarminHealthRecord | null =
    garmin?.latest ?? (garminRecords.length > 0 ? garminRecords[garminRecords.length - 1] : null);

  const hasCorosData = Boolean((health && health.length > 0) || (sleep && sleep.length > 0));
  const hasGarminData = Boolean(garminRecords && garminRecords.length > 0);
  const hasBoth = hasCorosData && hasGarminData;

  // 单一品牌时自动锁定对应视图，双品牌时才使用用户的切换选择
  const effectiveFilter: HealthBrandFilter = hasBoth
    ? brandFilter
    : hasGarminData
    ? "garmin"
    : "coros";

  const sleepAvailable = sleep.filter((s: any) => Number(s.available) === 1 && Number(s.score) > 0);
  const sleepMissing = sleep.length - sleepAvailable.length;
  const latestCoros = health[health.length - 1];
  const lastSleepCoros = sleepAvailable.length > 0 ? sleepAvailable[sleepAvailable.length - 1] : null;

  const restingHrCoros = latestCoros?.restingHr ?? null;
  const hrvCoros = latestCoros?.hrvBaseline ?? null;
  const datesCoros = health.map((h: any) => h.dateLabel);

  // 综合睡眠明细列表
  type MergedSleepItem = {
    date: string;
    brand: "garmin" | "coros";
    score: number | null;
    durationSec?: number | null;
    quality?: string | null;
    detail?: string;
  };

  const mergedSleepList: MergedSleepItem[] = [];
  for (const s of sleep) {
    if (Number(s.available) === 1 && Number(s.score) > 0) {
      mergedSleepList.push({
        date: s.date,
        brand: "coros",
        score: s.score,
        detail: "入睡佩戴正常",
      });
    }
  }
  for (const g of garminRecords) {
    if (g.sleepScore) {
      mergedSleepList.push({
        date: g.date,
        brand: "garmin",
        score: g.sleepScore,
        durationSec: g.sleepDurationSec,
        quality: g.sleepQuality,
        detail: g.deepSleepSec
          ? (isZh
            ? `深睡 ${formatSeconds(g.deepSleepSec, isZh)} · 快速眼动 ${formatSeconds(g.remSleepSec || 0, isZh)}`
            : `Deep ${formatSeconds(g.deepSleepSec, isZh)} · REM ${formatSeconds(g.remSleepSec || 0, isZh)}`)
          : undefined,
      });
    }
  }
  mergedSleepList.sort((a, b) => b.date.localeCompare(a.date));

  const filteredSleepList = mergedSleepList.filter((item) => {
    if (effectiveFilter === "all") return true;
    return item.brand === effectiveFilter;
  });

  return (
    <>
      {/* 顶部标题与多品牌视角切换栏（仅当同时拥有双品牌数据时才展示切换器） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--strong)" }}>
            {isZh ? "健康与生理恢复监控" : "Health & Recovery Monitoring"}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
            {hasBoth
              ? (isZh ? "打通高驰与佳明双品牌生态：夜间 HRV 状态、睡眠分期、身体电量与全天压力趋势" : "Cross-brand integration: Overnight HRV status, sleep stages, body battery & daily stress trends")
              : hasGarminData
              ? (isZh ? "佳明 Garmin 生理状态：夜间 HRV 状态 · 身体电量 · 睡眠分期深度分析" : "Garmin Physiological Metrics: Overnight HRV, Body Battery & Sleep Stages")
              : (isZh ? "高驰 COROS 生理状态：体能恢复度 · 静态心率 · 训练日活动时长" : "COROS Physiological Metrics: Stamina Recovery, Resting HR & Daily Active Time")}
          </p>
        </div>

        {/* 只有在双品牌数据均存在时才呈现切换按钮 */}
        {hasBoth && (
          <div style={{ display: "flex", background: "var(--surface-2)", padding: 3, borderRadius: 8, border: "1px solid var(--border)" }}>
            <button
              onClick={() => setBrandFilter("all")}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                background: brandFilter === "all" ? "var(--surface-3)" : "transparent",
                color: brandFilter === "all" ? "var(--strong)" : "var(--text-dim)",
                transition: "all 0.15s ease",
              }}
            >
              {isZh ? "全部健康生态" : "All Brands"}
            </button>
            <button
              onClick={() => setBrandFilter("garmin")}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: brandFilter === "garmin" ? "rgba(16, 185, 129, 0.15)" : "transparent",
                color: brandFilter === "garmin" ? "#10b981" : "var(--text-dim)",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
              {isZh ? "佳明 Garmin 生态" : "Garmin"}
            </button>
            <button
              onClick={() => setBrandFilter("coros")}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: brandFilter === "coros" ? "rgba(59, 130, 246, 0.15)" : "transparent",
                color: brandFilter === "coros" ? "#3b82f6" : "var(--text-dim)",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6" }} />
              {isZh ? "高驰 COROS 生态" : "COROS"}
            </button>
          </div>
        )}
      </div>

      {/* ============================================================
          佳明生态模块（仅当存在佳明数据且当前视图包含佳明时显示）
          ============================================================ */}
      {hasGarminData && latestGarmin && (effectiveFilter === "all" || effectiveFilter === "garmin") && (
        <div style={{ marginBottom: 24 }}>
          {hasBoth && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(16, 185, 129, 0.2)", color: "#10b981", fontWeight: 700 }}>
                {isZh ? "GARMIN 生理指标" : "GARMIN METRICS"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--strong)" }}>
                {isZh ? "夜间 HRV 状态 · 身体电量 · 睡眠分期分析" : "Overnight HRV · Body Battery · Sleep Stages"}
              </span>
            </div>
          )}

          <div className="grid g4" style={{ marginBottom: 14 }}>
            {/* 1. HRV 状态卡片 */}
            <div className="card stat-card" style={{ borderColor: "rgba(16, 185, 129, 0.3)" }}>
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconPulse size={15} />{isZh ? "夜间 HRV 状态" : "Overnight HRV Status"}</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>{isZh ? "佳明" : "Garmin"}</span>
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="value num" style={{ color: latestGarmin.hrvStatus === "BALANCED" ? "var(--good)" : "var(--warn)" }}>
                    {latestGarmin.hrvLastNightAvg ?? "—"}<span className="unit">ms</span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontWeight: 700,
                      background: latestGarmin.hrvStatus === "BALANCED" ? "rgba(16, 185, 129, 0.2)" : "rgba(234, 179, 8, 0.2)",
                      color: latestGarmin.hrvStatus === "BALANCED" ? "#10b981" : "#eab308",
                    }}
                  >
                    {latestGarmin.hrvStatus === "BALANCED" ? (isZh ? "均衡" : "Balanced") : latestGarmin.hrvStatus === "LOW" ? (isZh ? "偏低" : "Low") : (isZh ? "未平衡" : "Unbalanced")}
                  </span>
                </div>
                <span className="hint">
                  {isZh ? "7天基线:" : "7d Baseline:"} {latestGarmin.hrvBaselineLow ?? 50} ~ {latestGarmin.hrvBaselineHigh ?? 62} ms
                </span>
              </div>
            </div>

            {/* 2. 身体电量卡片 */}
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconBattery size={15} />{isZh ? "身体电量" : "Body Battery"}</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>{isZh ? "佳明" : "Garmin"}</span>
                </span>
                <span className="value num" style={{ color: (latestGarmin.bodyBatteryRecent ?? 0) >= 50 ? "var(--good)" : "var(--warn)" }}>
                  {latestGarmin.bodyBatteryRecent ?? latestGarmin.bodyBatteryHigh ?? "—"}<span className="unit">/ 100</span>
                </span>
                <span className="hint">
                  {isZh ? "充入" : "Charged"} +{latestGarmin.bodyBatteryCharged ?? "—"} · {isZh ? "消耗" : "Drained"} -{latestGarmin.bodyBatteryDrained ?? "—"}
                </span>
              </div>
            </div>

            {/* 3. 佳明静息心率卡片 */}
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconHeart size={15} />{isZh ? "静息心率 (RHR)" : "Resting HR (RHR)"}</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>{isZh ? "连续序列" : "Continuous"}</span>
                </span>
                <span className="value num">
                  {latestGarmin.restingHr ?? "—"}<span className="unit">bpm</span>
                </span>
                <span className="hint">
                  {isZh ? "全天心率范围" : "All-Day HR"} {latestGarmin.minHr ?? "—"} ~ {latestGarmin.maxHr ?? "—"} bpm
                </span>
              </div>
            </div>

            {/* 4. 佳明睡眠评分与分期 */}
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconMoon size={15} />{isZh ? "昨夜睡眠质量" : "Last Night Sleep Quality"}</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>{isZh ? "佳明" : "Garmin"}</span>
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span className="value num" style={{ color: (latestGarmin.sleepScore ?? 0) >= 80 ? "var(--good)" : "var(--warn)" }}>
                    {latestGarmin.sleepScore ?? "—"}
                  </span>
                  {latestGarmin.sleepQuality && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      ({latestGarmin.sleepQuality})
                    </span>
                  )}
                </div>
                <span className="hint">
                  {isZh ? "时长:" : "Duration:"} {latestGarmin.sleepDurationSec ? formatSeconds(latestGarmin.sleepDurationSec, isZh) : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 佳明 HRV 详细反馈条 */}
          {latestGarmin.hrvFeedback && (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                borderRadius: 8,
                padding: "9px 14px",
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12.5,
              }}
            >
              <span style={{ color: "#10b981", fontWeight: 700 }}>{isZh ? "生理评估：" : "Physiological Assessment: "}</span>
              <span style={{ color: "var(--text)" }}>{latestGarmin.hrvFeedback}</span>
            </div>
          )}

          {/* 佳明图表行 */}
          <div className="grid g2" style={{ marginBottom: 14 }}>
            {/* 夜间 HRV 趋势与基线区间带 */}
            <div className="card">
              <h3 className="card-title">{isZh ? "夜间 HRV 连续走势与 7 天基线带" : "Overnight HRV Trend & 7d Baseline"}</h3>
              <p className="card-sub">{isZh ? "曲线为昨夜均值，绿色背景带为 7 天正常基线区间（处于或高于基线代表身体适应良好）" : "Curve shows overnight average; green band indicates 7-day baseline band."}</p>
              <LineChart
                labels={garminRecords.map((r) => r.date.slice(5))}
                series={[
                  {
                    key: "hrv",
                    label: isZh ? "夜间 HRV (ms)" : "Overnight HRV (ms)",
                    color: "var(--chart-good)",
                    values: garminRecords.map((r) => r.hrvLastNightAvg ?? 0),
                  },
                ]}
                bands={
                  latestGarmin.hrvBaselineLow && latestGarmin.hrvBaselineHigh
                    ? [{ from: latestGarmin.hrvBaselineLow, to: latestGarmin.hrvBaselineHigh, color: "var(--chart-good)" }]
                    : undefined
                }
                height={190}
                yFmt={(n) => `${Math.round(n)}ms`}
              />
            </div>

            {/* 身体电量与日均压力 */}
            <div className="card">
              <h3 className="card-title">{isZh ? "身体电量充放与日间压力" : "Body Battery & Daytime Stress"}</h3>
              <p className="card-sub">{isZh ? "追踪夜间电量充电（高值）与训练消耗（低值），配合全天平均压力" : "Tracks overnight charging (peaks), activity depletion (troughs), and daily stress."}</p>
              <LineChart
                labels={garminRecords.map((r) => r.date.slice(5))}
                series={[
                  {
                    key: "bb_high",
                    label: isZh ? "电量峰值 (充电后)" : "Battery Peak (Charged)",
                    color: "var(--chart-good)",
                    values: garminRecords.map((r) => r.bodyBatteryHigh ?? 0),
                  },
                  {
                    key: "bb_low",
                    label: isZh ? "电量谷值 (消耗后)" : "Battery Trough (Drained)",
                    color: "var(--chart-accent)",
                    values: garminRecords.map((r) => r.bodyBatteryLow ?? 0),
                  },
                  {
                    key: "stress",
                    label: isZh ? "日均压力" : "Avg Stress",
                    color: "var(--chart-warn)",
                    values: garminRecords.map((r) => r.avgStress ?? 0),
                  },
                ]}
                height={190}
                yFmt={(n) => String(Math.round(n))}
              />
            </div>
          </div>

          {/* 睡眠分期比例条 */}
          {latestGarmin.deepSleepSec && latestGarmin.sleepDurationSec && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>{isZh ? "昨夜睡眠分期占比结构" : "Overnight Sleep Stages Structure"}</h3>
                  <p className="card-sub" style={{ margin: "3px 0 0" }}>
                    {isZh ? `入睡时长 ${formatSeconds(latestGarmin.sleepDurationSec, isZh)} · 包含深睡、浅睡与 REM 快速眼动期` : `Sleep Duration: ${formatSeconds(latestGarmin.sleepDurationSec, isZh)} · Deep, Light & REM stages`}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-dim)" }}>
                  {latestGarmin.avgSleepSpo2 && <span>{isZh ? "平均血氧: " : "Avg SpO2: "}<strong style={{ color: "var(--strong)" }}>{latestGarmin.avgSleepSpo2}%</strong></span>}
                  {latestGarmin.avgRespiration && <span>{isZh ? "平均呼吸率: " : "Avg Respiration: "}<strong style={{ color: "var(--strong)" }}>{latestGarmin.avgRespiration}{isZh ? "次/分" : " brpm"}</strong></span>}
                </div>
              </div>

              {(() => {
                const total = latestGarmin.sleepDurationSec || 1;
                const deepPct = Math.round(((latestGarmin.deepSleepSec || 0) / total) * 100);
                const remPct = Math.round(((latestGarmin.remSleepSec || 0) / total) * 100);
                const awakePct = Math.round(((latestGarmin.awakeSleepSec || 0) / total) * 100);
                const lightPct = Math.max(0, 100 - deepPct - remPct - awakePct);

                return (
                  <div>
                    <div style={{ height: 18, width: "100%", borderRadius: 6, display: "flex", overflow: "hidden", margin: "10px 0 8px" }}>
                      <div style={{ width: `${deepPct}%`, background: "#3b82f6" }} title={`${isZh ? "深睡" : "Deep"}: ${deepPct}%`} />
                      <div style={{ width: `${remPct}%`, background: "#8b5cf6" }} title={`${isZh ? "REM快速眼动" : "REM"}: ${remPct}%`} />
                      <div style={{ width: `${lightPct}%`, background: "#60a5fa" }} title={`${isZh ? "浅睡" : "Light"}: ${lightPct}%`} />
                      <div style={{ width: `${awakePct}%`, background: "#f59e0b" }} title={`${isZh ? "清醒" : "Awake"}: ${awakePct}%`} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 11.5, color: "var(--text-dim)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#3b82f6" }} />
                        <span>{isZh ? "深睡" : "Deep"}: {formatSeconds(latestGarmin.deepSleepSec || 0, isZh)} ({deepPct}%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#8b5cf6" }} />
                        <span>{isZh ? "快速眼动 (REM)" : "REM"}: {formatSeconds(latestGarmin.remSleepSec || 0, isZh)} ({remPct}%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#60a5fa" }} />
                        <span>{isZh ? "浅睡" : "Light"}: {formatSeconds(latestGarmin.lightSleepSec || 0, isZh)} ({lightPct}%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }} />
                        <span>{isZh ? "清醒" : "Awake"}: {formatSeconds(latestGarmin.awakeSleepSec || 0, isZh)} ({awakePct}%)</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          高驰生态模块（仅当存在高驰数据且当前视图包含高驰时显示）
          ============================================================ */}
      {hasCorosData && (effectiveFilter === "all" || effectiveFilter === "coros") && (
        <div style={{ marginBottom: 24 }}>
          {hasBoth && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(59, 130, 246, 0.2)", color: "#3b82f6", fontWeight: 700 }}>
                {isZh ? "COROS 生理指标" : "COROS METRICS"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--strong)" }}>
                {isZh ? "体能恢复度 · 静态心率 · 训练日活动时长" : "Stamina Recovery · Resting HR · Active Duration"}
              </span>
            </div>
          )}

          {sleepMissing > sleepAvailable.length && (
            <div className="banner info" style={{ borderColor: "rgba(59, 130, 246, 0.3)", marginBottom: 14 }}>
              {t("readiness.healthBanner", { days: sleepAvailable.length })}
            </div>
          )}

          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconRecovery size={15} />{t("readiness.currentRecovery")}</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>{isZh ? "高驰" : "COROS"}</span>}
                </span>
                <span className="value num" style={{ color: recovery?.recoveryPct >= 70 ? "var(--good)" : recovery?.recoveryPct >= 40 ? "var(--warn)" : "var(--bad)" }}>
                  {recovery?.recoveryPct ?? "—"}<span className="unit">%</span>
                </span>
                <span className="hint">{recovery?.level ?? "—"}</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconHeart size={15} />{t("readiness.restingHrRef")}</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>{isZh ? "高驰" : "COROS"}</span>}
                </span>
                <span className="value num">{restingHrCoros ?? "—"}<span className="unit">bpm</span></span>
                <span className="hint">{t("readiness.singlePointRef")}</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconPulse size={15} />{t("readiness.hrvBaseline")}</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>{isZh ? "高驰" : "COROS"}</span>}
                </span>
                <span className="value num">{hrvCoros ?? "—"}<span className="unit">ms</span></span>
                <span className="hint">{t("readiness.singlePointBaseline")}</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconMoon size={15} />{t("readiness.corosSleepScore")}</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>{isZh ? "高驰" : "COROS"}</span>}
                </span>
                <span className="value num">{lastSleepCoros?.score ?? "—"}</span>
                <span className="hint">{t("readiness.wornDaysRatio", { worn: sleepAvailable.length, total: sleep.length })}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">{t("readiness.dailyStress")}</h3>
            <p className="card-sub">{t("readiness.corosDailyStressDesc")}</p>
            <LineChart
              labels={stress.map((s: any) => s.date)}
              series={[{ key: "s", label: t("readiness.dailyAvgStress"), color: "var(--chart-warn)", values: stress.map((s: any) => s.avgStress) }]}
              bands={[{ from: 60, to: 80, color: "var(--chart-good)" }]}
              height={180}
              yFmt={(n) => String(Math.round(n))}
            />
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">{t("readiness.allDayHrRange")}</h3>
            <p className="card-sub">{t("readiness.allDayHrDesc")}</p>
            <LineChart
              labels={hr.map((h: any) => h.date)}
              series={[
                { key: "max", label: isZh ? "最高心率" : "Max HR", color: "var(--chart-bad)", values: hr.map((h: any) => h.maxHr) },
                { key: "avg", label: isZh ? "平均心率" : "Avg HR", color: "var(--chart-hr)", values: hr.map((h: any) => h.avgHr) },
                { key: "min", label: isZh ? "最低心率" : "Min HR", color: "var(--chart-z2)", values: hr.map((h: any) => h.minHr) },
              ]}
              height={200}
              yFmt={(n) => String(Math.round(n))}
            />
          </div>

          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="card">
              <h3 className="card-title">{isZh ? "日常步数" : "Daily Steps"}</h3>
              <p className="card-sub">{isZh ? "训练日之外的活动步数" : "Active steps outside training"}</p>
              <LineChart
                labels={datesCoros}
                series={[{ key: "steps", label: isZh ? "步数" : "Steps", color: "var(--chart-accent)", values: health.map((h: any) => h.steps) }]}
                height={170}
                yFmt={(n) => (n >= 1000 ? (n / 1000).toFixed(0) + "k" : String(Math.round(n)))}
              />
            </div>
            <div className="card">
              <h3 className="card-title">{isZh ? "运动时长" : "Active Duration"}</h3>
              <p className="card-sub">{isZh ? "当日活动记录的运动分钟数" : "Recorded active minutes today"}</p>
              <LineChart
                labels={datesCoros}
                series={[{ key: "ex", label: isZh ? "运动分钟" : "Active Min", color: "var(--chart-z2)", values: health.map((h: any) => h.exerciseMin) }]}
                height={170}
                yFmt={(n) => String(Math.round(n))}
              />
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          睡眠数据明细表
          ============================================================ */}
      <div className="card">
        <h3 className="card-title">{isZh ? (hasBoth ? "多品牌睡眠数据明细" : "睡眠数据明细") : (hasBoth ? "Multi-Brand Sleep Breakdown" : "Sleep Breakdown")}</h3>
        <p className="card-sub">
          {isZh
            ? (hasBoth
              ? "数据严格归属于采集设备，支持查看各手表的睡眠评分与分期深度"
              : hasGarminData
              ? "佳明 Garmin 夜间入睡时长、分期深度与睡眠质量"
              : "手表记录睡眠时以「醒来那天」为日期。未佩戴的日期会显示为无数据。")
            : (hasBoth
              ? "Device-attributed sleep records. Compare sleep scores and stage breakdowns across watches."
              : hasGarminData
              ? "Garmin overnight sleep duration, stage breakdown and sleep quality"
              : "Sleep records recorded by wake date. Days without watch wear show as no data.")}
        </p>
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{isZh ? "日期" : "Date"}</th>
                {hasBoth && <th>{isZh ? "设备来源" : "Device"}</th>}
                <th>{isZh ? "睡眠评分" : "Sleep Score"}</th>
                <th>{isZh ? "睡眠时长" : "Sleep Duration"}</th>
                <th>{isZh ? "分期明细 / 状态" : "Stages / Status"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSleepList.map((item, idx) => (
                <tr key={`${item.brand}-${item.date}-${idx}`}>
                  <td style={{ fontWeight: 500 }}>{item.date}</td>
                  {hasBoth && (
                    <td>
                      {item.brand === "garmin" ? (
                        <span className="pill" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontWeight: 700 }}>
                          {isZh ? "佳明 Garmin" : "Garmin"}
                        </span>
                      ) : (
                        <span className="pill" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", fontWeight: 700 }}>
                          {isZh ? "高驰 COROS" : "COROS"}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="num">
                    <strong style={{ color: (item.score ?? 0) >= 80 ? "var(--good)" : (item.score ?? 0) >= 60 ? "var(--warn)" : "var(--bad)" }}>
                      {item.score ?? "—"}
                    </strong>
                  </td>
                  <td>
                    {item.durationSec ? formatSeconds(item.durationSec, isZh) : "—"}
                  </td>
                  <td style={{ color: "var(--text-dim)", fontSize: 12 }}>
                    {item.detail ?? (item.quality ? (isZh ? `评分等级: ${item.quality}` : `Tier: ${item.quality}`) : (isZh ? "已记录" : "Logged"))}
                  </td>
                </tr>
              ))}
              {filteredSleepList.length === 0 && (
                <tr>
                  <td colSpan={hasBoth ? 5 : 4} style={{ textAlign: "center", color: "var(--text-faint)", padding: "20px 0" }}>
                    {isZh ? "暂无夜间佩戴睡眠记录" : "No sleep records logged"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
