import { useEffect, useState } from "react";
import { api, type GarminHealthRecord } from "../api";
import { LineChart, fmtDur } from "../charts";
import { IconBattery, IconHeart, IconMoon, IconPulse, IconRecovery } from "../icons";

type HealthBrandFilter = "all" | "garmin" | "coros";

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}小时${m}分` : `${m}分`;
}

function formatSeconds(sec: number): string {
  return formatMinutes(Math.round(sec / 60));
}

export default function Health() {
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
          ? `深睡 ${formatSeconds(g.deepSleepSec)} · 快速眼动 ${formatSeconds(g.remSleepSec || 0)}`
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
            健康与生理恢复监控
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
            {hasBoth
              ? "打通高驰与佳明双品牌生态：夜间 HRV 状态、睡眠分期、身体电量与全天压力趋势"
              : hasGarminData
              ? "佳明 Garmin 生理状态：夜间 HRV 状态 · 身体电量 · 睡眠分期深度分析"
              : "高驰 COROS 生理状态：体能恢复度 · 静态心率 · 训练日活动时长"}
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
              全部健康生态
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
              佳明 Garmin 生态
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
              高驰 COROS 生态
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
                GARMIN 生理指标
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--strong)" }}>
                夜间 HRV 状态 · 身体电量 · 睡眠分期分析
              </span>
            </div>
          )}

          <div className="grid g4" style={{ marginBottom: 14 }}>
            {/* 1. HRV 状态卡片 */}
            <div className="card stat-card" style={{ borderColor: "rgba(16, 185, 129, 0.3)" }}>
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconPulse size={15} />夜间 HRV 状态</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>佳明</span>
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
                    {latestGarmin.hrvStatus === "BALANCED" ? "均衡" : latestGarmin.hrvStatus === "LOW" ? "偏低" : "未平衡"}
                  </span>
                </div>
                <span className="hint">
                  7天基线: {latestGarmin.hrvBaselineLow ?? 50} ~ {latestGarmin.hrvBaselineHigh ?? 62} ms
                </span>
              </div>
            </div>

            {/* 2. 身体电量卡片 */}
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconBattery size={15} />身体电量</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>佳明</span>
                </span>
                <span className="value num" style={{ color: (latestGarmin.bodyBatteryRecent ?? 0) >= 50 ? "var(--good)" : "var(--warn)" }}>
                  {latestGarmin.bodyBatteryRecent ?? latestGarmin.bodyBatteryHigh ?? "—"}<span className="unit">/ 100</span>
                </span>
                <span className="hint">
                  充入 +{latestGarmin.bodyBatteryCharged ?? "—"} · 消耗 -{latestGarmin.bodyBatteryDrained ?? "—"}
                </span>
              </div>
            </div>

            {/* 3. 佳明静息心率卡片 */}
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconHeart size={15} />静息心率 (RHR)</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>连续序列</span>
                </span>
                <span className="value num">
                  {latestGarmin.restingHr ?? "—"}<span className="unit">bpm</span>
                </span>
                <span className="hint">
                  全天心率范围 {latestGarmin.minHr ?? "—"} ~ {latestGarmin.maxHr ?? "—"} bpm
                </span>
              </div>
            </div>

            {/* 4. 佳明睡眠评分与分期 */}
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconMoon size={15} />昨夜睡眠质量</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>佳明</span>
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
                  时长: {latestGarmin.sleepDurationSec ? formatSeconds(latestGarmin.sleepDurationSec) : "—"}
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
              <span style={{ color: "#10b981", fontWeight: 700 }}>生理评估：</span>
              <span style={{ color: "var(--text)" }}>{latestGarmin.hrvFeedback}</span>
            </div>
          )}

          {/* 佳明图表行 */}
          <div className="grid g2" style={{ marginBottom: 14 }}>
            {/* 夜间 HRV 趋势与基线区间带 */}
            <div className="card">
              <h3 className="card-title">夜间 HRV 连续走势与 7 天基线带</h3>
              <p className="card-sub">曲线为昨夜均值，绿色背景带为 7 天正常基线区间（处于或高于基线代表身体适应良好）</p>
              <LineChart
                labels={garminRecords.map((r) => r.date.slice(5))}
                series={[
                  {
                    key: "hrv",
                    label: "夜间 HRV (ms)",
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
              <h3 className="card-title">身体电量充放与日间压力</h3>
              <p className="card-sub">追踪夜间电量充电（高值）与训练消耗（低值），配合全天平均压力</p>
              <LineChart
                labels={garminRecords.map((r) => r.date.slice(5))}
                series={[
                  {
                    key: "bb_high",
                    label: "电量峰值 (充电后)",
                    color: "var(--chart-good)",
                    values: garminRecords.map((r) => r.bodyBatteryHigh ?? 0),
                  },
                  {
                    key: "bb_low",
                    label: "电量谷值 (消耗后)",
                    color: "var(--chart-accent)",
                    values: garminRecords.map((r) => r.bodyBatteryLow ?? 0),
                  },
                  {
                    key: "stress",
                    label: "日均压力",
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
                  <h3 className="card-title" style={{ margin: 0 }}>昨夜睡眠分期占比结构</h3>
                  <p className="card-sub" style={{ margin: "3px 0 0" }}>
                    入睡时长 {formatSeconds(latestGarmin.sleepDurationSec)} · 包含深睡、浅睡与 REM 快速眼动期
                  </p>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-dim)" }}>
                  {latestGarmin.avgSleepSpo2 && <span>平均血氧: <strong style={{ color: "var(--strong)" }}>{latestGarmin.avgSleepSpo2}%</strong></span>}
                  {latestGarmin.avgRespiration && <span>平均呼吸率: <strong style={{ color: "var(--strong)" }}>{latestGarmin.avgRespiration}次/分</strong></span>}
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
                      <div style={{ width: `${deepPct}%`, background: "#3b82f6" }} title={`深睡: ${deepPct}%`} />
                      <div style={{ width: `${remPct}%`, background: "#8b5cf6" }} title={`REM快速眼动: ${remPct}%`} />
                      <div style={{ width: `${lightPct}%`, background: "#60a5fa" }} title={`浅睡: ${lightPct}%`} />
                      <div style={{ width: `${awakePct}%`, background: "#f59e0b" }} title={`清醒: ${awakePct}%`} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 11.5, color: "var(--text-dim)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#3b82f6" }} />
                        <span>深睡: {formatSeconds(latestGarmin.deepSleepSec || 0)} ({deepPct}%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#8b5cf6" }} />
                        <span>快速眼动 (REM): {formatSeconds(latestGarmin.remSleepSec || 0)} ({remPct}%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#60a5fa" }} />
                        <span>浅睡: {formatSeconds(latestGarmin.lightSleepSec || 0)} ({lightPct}%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }} />
                        <span>清醒: {formatSeconds(latestGarmin.awakeSleepSec || 0)} ({awakePct}%)</span>
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
                COROS 生理指标
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--strong)" }}>
                体能恢复度 · 静态心率 · 训练日活动时长
              </span>
            </div>
          )}

          {sleepMissing > sleepAvailable.length && (
            <div className="banner info" style={{ borderColor: "rgba(59, 130, 246, 0.3)", marginBottom: 14 }}>
              近 {sleep.length} 天中记录到 <strong>{sleepAvailable.length}</strong> 天夜间入睡佩戴。
              高驰睡眠评分与夜间心率需入睡时佩戴腕表；未佩戴的天数官方云端标记为未入睡，不影响白天的跑步与训练负荷分析。
            </div>
          )}

          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconRecovery size={15} />当前恢复度</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>高驰</span>}
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
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconHeart size={15} />静息心率参考</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>高驰</span>}
                </span>
                <span className="value num">{restingHrCoros ?? "—"}<span className="unit">bpm</span></span>
                <span className="hint">官方单点参考值</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconPulse size={15} />HRV 静态基线</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>高驰</span>}
                </span>
                <span className="value num">{hrvCoros ?? "—"}<span className="unit">ms</span></span>
                <span className="hint">单点基线值</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconMoon size={15} />高驰睡眠评分</span>
                  {hasBoth && <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>高驰</span>}
                </span>
                <span className="value num">{lastSleepCoros?.score ?? "—"}</span>
                <span className="hint">{sleepAvailable.length} / {sleep.length} 天有佩戴</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">每日压力</h3>
            <p className="card-sub">高驰日均压力值，背景带为 60–80 的中等区间</p>
            <LineChart
              labels={stress.map((s: any) => s.date)}
              series={[{ key: "s", label: "日均压力", color: "var(--chart-warn)", values: stress.map((s: any) => s.avgStress) }]}
              bands={[{ from: 60, to: 80, color: "var(--chart-good)" }]}
              height={180}
              yFmt={(n) => String(Math.round(n))}
            />
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">全天心率范围</h3>
            <p className="card-sub">来自 queryAvgHeartRate，含当日最低、平均与最高心率</p>
            <LineChart
              labels={hr.map((h: any) => h.date)}
              series={[
                { key: "max", label: "最高心率", color: "var(--chart-bad)", values: hr.map((h: any) => h.maxHr) },
                { key: "avg", label: "平均心率", color: "var(--chart-hr)", values: hr.map((h: any) => h.avgHr) },
                { key: "min", label: "最低心率", color: "var(--chart-z2)", values: hr.map((h: any) => h.minHr) },
              ]}
              height={200}
              yFmt={(n) => String(Math.round(n))}
            />
          </div>

          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="card">
              <h3 className="card-title">日常步数</h3>
              <p className="card-sub">训练日之外的活动步数</p>
              <LineChart
                labels={datesCoros}
                series={[{ key: "steps", label: "步数", color: "var(--chart-accent)", values: health.map((h: any) => h.steps) }]}
                height={170}
                yFmt={(n) => (n >= 1000 ? (n / 1000).toFixed(0) + "k" : String(Math.round(n)))}
              />
            </div>
            <div className="card">
              <h3 className="card-title">运动时长</h3>
              <p className="card-sub">当日活动记录的运动分钟数</p>
              <LineChart
                labels={datesCoros}
                series={[{ key: "ex", label: "运动分钟", color: "var(--chart-z2)", values: health.map((h: any) => h.exerciseMin) }]}
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
        <h3 className="card-title">{hasBoth ? "多品牌睡眠数据明细" : "睡眠数据明细"}</h3>
        <p className="card-sub">
          {hasBoth
            ? "数据严格归属于采集设备，支持查看各手表的睡眠评分与分期深度"
            : hasGarminData
            ? "佳明 Garmin 夜间入睡时长、分期深度与睡眠质量"
            : "手表记录睡眠时以「醒来那天」为日期。未佩戴的日期会显示为无数据。"}
        </p>
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>日期</th>
                {hasBoth && <th>设备来源</th>}
                <th>睡眠评分</th>
                <th>睡眠时长</th>
                <th>分期明细 / 状态</th>
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
                          佳明 Garmin
                        </span>
                      ) : (
                        <span className="pill" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", fontWeight: 700 }}>
                          高驰 COROS
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
                    {item.durationSec ? formatSeconds(item.durationSec) : "—"}
                  </td>
                  <td style={{ color: "var(--text-dim)", fontSize: 12 }}>
                    {item.detail ?? (item.quality ? `评分等级: ${item.quality}` : "已记录")}
                  </td>
                </tr>
              ))}
              {filteredSleepList.length === 0 && (
                <tr>
                  <td colSpan={hasBoth ? 5 : 4} style={{ textAlign: "center", color: "var(--text-faint)", padding: "20px 0" }}>
                    暂无夜间佩戴睡眠记录
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
