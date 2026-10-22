import { useState } from "react";
import { api, type RaceDetail } from "../api";

export type RaceAnchor = {
  /** 训练 id —— 人工排除/纳入时用它定位这一场 */
  labelId: string;
  date: string;
  label: string;
  distanceKm: number;
  seconds: number;
  avgHr: number;
  climbRate: number;
  altitude: number;
  altitudeSource: "fit" | "city-table" | "unknown";
  seaLevelSec: number;
  excluded?: boolean;
  excludeReason?: string;
  /**
   * 排除/纳入的决定来自哪里：
   *   manual   = 用户手动指定
   *   auto     = 自动判定（后程配速与心率同步下滑）
   *   included = 自动判定为异常，但用户手动要求纳入
   */
  excludeSource?: "manual" | "auto" | "included";
  fadePct: number | null;
};

export type Briefing = {
  anchors: RaceAnchor[];
  training: {
    weeklyKm4: number;
    weeklyKm8: number;
    trendPct: number | null;
    loadRatio: number | null;
    /** 负荷比取自哪一天（与窗口锚点对齐） */
    loadAsOf: string | null;
    longRun: {
      /** 近 4 周窗口内 ≥28km 的长距离（取最近一次） */
      ready: { date: string; km: number } | null;
      /** 近 4 周窗口内 ≥25km 的最长一次 */
      max: { date: string; km: number } | null;
      adjustPct: number;
      tone: "good" | "warn";
      effect: string;
    };
    easyPct: number | null;
    /** 统计窗口的右端 = 最近一次训练的日期 */
    asOf: string;
    /** 距上次训练几天（0 = 今天跑过） */
    daysSinceAnchor: number;
  };
  prediction: {
    bestSec: number;
    lowSec: number;
    highSec: number;
    basis: string;
    factors: { label: string; effect: string; tone: "good" | "warn" | "neutral" }[];
    confidence: string;
    confidenceNote: string;
  } | null;
  pacing: {
    goalSec: number;
    openingAdjustmentSec: number;
    hrCapSource: "anchors" | "hr-max-ratio";
    hrCapNote: string;
    segments: {
      label: string;
      fromKm: number;
      toKm: number;
      targetPaceSec: number;
      targetHr: number | null;
      intent: string;
    }[];
    warnings: string[];
    strategySummary: string;
  } | null;
  daysToRace: number | null;
};

export type RaceBriefing = RaceDetail & { briefing: Briefing };

const fDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const fPace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const TONE_COLOR: Record<string, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  neutral: "var(--text-dim)",
};

/**
 * 成绩预测 —— 纯数据推导，不含 AI。
 *
 * 关键：这里必须把「目标」和「预测」讲清楚，否则两个数字并排放着会让人困惑。
 *   目标 = 你自己定的意图（想跑多少）
 *   预测 = 按现有数据算出来的期望（现在这个状态大概能跑多少）
 * 两者之间的差值就是「差距」，是需要靠训练补的部分 —— 也不是判你失败。
 */
function PredictionCard({ b, goalSec }: { b: Briefing; goalSec: number | null }) {
  const p = b.prediction;
  if (!p) {
    return (
      <div className="banner warn">
        还没有可用的比赛锚点 —— 预测需要至少一场 ≥42km 的真实成绩。
        <div style={{ marginTop: 6, fontSize: 12 }}>等完成一场全马后，这页会自动给出成绩预测。</div>
      </div>
    );
  }

  // 目标比预测快 = 有挑战；目标比预测慢 = 保守有余
  const gapSec = goalSec != null ? goalSec - p.bestSec : null;
  const reachable = gapSec != null && gapSec <= 0;
  const gapHard = gapSec != null && gapSec > 0 && gapSec <= 180;

  return (
    <>
      <div className="grid g3" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="label">你的目标</span>
          <span className="value num" style={{ fontSize: 24, color: "var(--text)" }}>
            {goalSec != null ? fDur(goalSec) : <span style={{ color: "var(--text-faint)" }}>未设定</span>}
          </span>
          <span className="hint">手动设定目标用时</span>
        </div>
        <div className="stat">
          <span className="label">当前预测</span>
          <span className="value num" style={{ color: "var(--accent)", fontSize: 24 }}>{fDur(p.bestSec)}</span>
          <span className="hint">已折算地形与海拔</span>
        </div>
        <div className="stat">
          <span className="label">距比赛</span>
          <span className="value num" style={{ fontSize: 24 }}>{b.daysToRace ?? "—"}<span className="unit">天</span></span>
          <span className="hint">置信度：{p.confidence} 级</span>
        </div>
      </div>

      {gapSec != null && (
        <div
          className="banner"
          style={{
            fontSize: 12,
            padding: "8px 12px",
            marginBottom: 10,
            background: reachable ? "var(--info-bg)" : "var(--warn-bg)",
            border: `1px solid ${reachable ? "var(--info-border)" : "var(--warn-border)"}`,
            lineHeight: 1.5,
          }}
        >
          {reachable ? (
            <>
              目标 <strong>{fDur(goalSec!)}</strong> 比当前预测 <strong>{fDur(p.bestSec)}</strong> 还快{" "}
              <strong>{fDur(Math.abs(gapSec))}</strong>。
              这在现阶段的体能之上，属于需要靠接下来 {b.daysToRace} 天训练去争取的目标 —— 不是判断你做不到。
            </>
          ) : gapHard ? (
            <>
              目标 <strong>{fDur(goalSec!)}</strong> 仅比当前预测 <strong>{fDur(p.bestSec)}</strong> 慢{" "}
              <strong>{fDur(Math.abs(gapSec))}</strong>（余量约 {(Math.abs(gapSec) / p.bestSec * 100).toFixed(1)}%），需稳定控速，容错较小。
            </>
          ) : (
            <>
              目标 <strong>{fDur(goalSec!)}</strong> 比当前预测 <strong>{fDur(p.bestSec)}</strong> 慢{" "}
              <strong>{fDur(Math.abs(gapSec))}</strong>，余量充裕，以当前状态跑进目标的把握较大。
            </>
          )}
        </div>
      )}

      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-dim)", userSelect: "none" }}>
          查看预测算法依据与关键影响因子
        </summary>
        <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.6 }}>{p.basis}</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ margin: "0 0 6px", fontSize: 11.5, color: "var(--text-dim)", fontWeight: 500 }}>关键影响因子</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {p.factors.map((f, i) => (
                <span key={i} className="pill" style={{ color: TONE_COLOR[f.tone], fontSize: 11, padding: "2px 8px" }}>
                  {f.label}：{f.effect}
                </span>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-faint)" }}>{p.confidenceNote}</div>
        </div>
      </details>
    </>
  );
}

function TrainingStateCard({ training: t }: { training: Briefing["training"] }) {
  return (
    <>
      <div className="grid g2" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="label">近 4 周周均</span>
          <span className="value num">{t.weeklyKm4}<span className="unit">km</span></span>
          <span className="hint">
            {t.trendPct != null
              ? `较前4周 ${t.trendPct > 0 ? "+" : ""}${t.trendPct}%`
              : `8周均 ${t.weeklyKm8} km`}
          </span>
        </div>
        <div className="stat">
          <span className="label">当前负荷比</span>
          <span className="value num" style={{ color: (t.loadRatio ?? 1) > 1.4 ? "var(--warn)" : "var(--good)" }}>
            {t.loadRatio ?? "—"}
          </span>
          <span className="hint">
            {(t.loadRatio ?? 1) > 1.4 ? "偏高 · 需防疲劳" : (t.loadRatio ?? 1) < 0.75 ? "偏低 · 刺激不足" : "负荷处于安全区间"}
          </span>
        </div>
        <div className="stat">
          <span className="label">基础有氧占比</span>
          <span className="value num" style={{ color: (t.easyPct ?? 100) < 75 ? "var(--warn)" : "var(--good)" }}>
            {t.easyPct ?? "—"}<span className="unit">%</span>
          </span>
          <span className="hint">合理基准 75%–80%</span>
        </div>
        <div className="stat">
          <span className="label">长距离储备</span>
          <span className="value num" style={{ color: t.longRun.ready ? "var(--good)" : "var(--warn)" }}>
            {(t.longRun.ready?.km ?? t.longRun.max?.km) ?? "—"}<span className="unit">km</span>
          </span>
          <span className="hint">
            {t.longRun.ready
              ? `近4周有 ≥28km 实测`
              : t.longRun.max
                ? `最长单次 ${t.longRun.max.km} km`
                : "近4周无 ≥25km 训练"}
          </span>
        </div>
      </div>

      <div
        className="banner info"
        style={{
          fontSize: 12,
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          lineHeight: 1.5,
        }}
      >
        <span>统计窗口：截至 <strong>{t.asOf}</strong></span>
        {t.daysSinceAnchor > 0 && (
          <span style={{ color: t.daysSinceAnchor >= 3 ? "var(--warn)" : "var(--text-dim)" }}>
            距上次训练 {t.daysSinceAnchor} 天{t.daysSinceAnchor >= 3 ? "（建议尽快同步新数据）" : ""}
          </span>
        )}
      </div>

      {t.loadAsOf && (
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4, paddingLeft: 2 }}>
          负荷比计算基准日：{t.loadAsOf}
        </div>
      )}
    </>
  );
}

function PacingCard({ b }: { b: Briefing }) {
  const p = b.pacing;
  if (!p) return null;
  return (
    <>
      <p className="card-sub" style={{ marginTop: 0, marginBottom: 10 }}>{p.strategySummary}</p>
      <div className="table-scroll-wrap">
        <div className="table-scroll briefing-table-scroll">
          <table>
            <thead>
              <tr><th>阶段</th><th>里程</th><th>建议配速</th><th>心率上限</th><th>战术执行意图</th></tr>
            </thead>
            <tbody>
              {p.segments.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{s.label}</td>
                  <td className="num">{s.fromKm}–{s.toKm} km</td>
                  <td className="num" style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {fPace(s.targetPaceSec)}<span style={{ color: "var(--text-faint)" }}> /km</span>
                  </td>
                  <td className="num" style={{ color: s.targetHr ? "var(--hr)" : "var(--text-faint)" }}>
                    {s.targetHr ? `≤ ${s.targetHr} bpm` : "不限"}
                  </td>
                  <td className="cell-text" style={{ textAlign: "left", fontSize: 12, color: "var(--text-dim)" }}>
                    {s.intent}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        心率上限设定依据：{p.hrCapSource === "anchors" ? "历史实测比赛心率" : "最大心率储备比例"} —— {p.hrCapNote}
      </div>
      {p.warnings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {p.warnings.map((w, i) => (
            <div key={i} className="banner warn" style={{ marginBottom: 6, fontSize: 12 }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * 比赛锚点表。
 *
 * 「是否计入基准」是**可纠正的**：自动判定只看数据形态，不推断原因，
 * 而原因只有本人知道；规则也不一定适用于每个人。所以每一行都给一个开关：
 *   排除 → 手动移出基准（可写原因）
 *   纳入 → 强制纳入，覆盖自动判定
 *   撤销 → 交回自动判定
 */
function AnchorTable({ anchors, onChanged }: { anchors: RaceAnchor[]; onChanged?: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (labelId: string, excluded: boolean | null, reason?: string) => {
    setBusy(labelId);
    setErr(null);
    try {
      await api.setAnchorExclusion(labelId, excluded, reason);
      setEditing(null);
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (anchors.length === 0) return null;
  return (
    <>
      {err && <div className="banner error" style={{ marginBottom: 6, fontSize: 12 }}>{err}</div>}
      <div className="table-scroll-wrap">
        <div className="table-scroll briefing-table-scroll">
          <table>
            <thead>
              <tr><th>日期</th><th>赛事</th><th>实测</th><th>海平面等效</th><th>爬升</th><th>海拔</th><th>前后半</th><th>状态与操作</th></tr>
            </thead>
            <tbody>
              {anchors.map((a, i) => (
                <tr key={a.labelId || i} style={{ opacity: a.excluded ? 0.55 : 1 }}>
                  <td>{a.date}</td>
                  <td style={{ textAlign: "left" }}>{a.label}</td>
                  <td className="num">{fDur(a.seconds)}</td>
                  <td className="num" style={{ color: "var(--accent)", fontWeight: 600 }}>{fDur(a.seaLevelSec)}</td>
                  <td className="num">{a.climbRate} m/km</td>
                  <td className="num" style={{ color: a.altitudeSource === "unknown" ? "var(--warn)" : undefined }}
                      title={a.altitudeSource === "fit"
                        ? "来自手环气压计实测（最准）"
                        : a.altitudeSource === "city-table"
                          ? "来自城市海拔兜底表（按城市中心点）"
                          : "未知：这场没折算海拔，跨比赛比较可能偏差"}>
                    {a.altitude >= 1000
                      ? `${Math.round(a.altitude)} m ⚠`
                      : a.altitudeSource === "unknown" ? "未知" : `${Math.round(a.altitude)} m`}
                  </td>
                  <td className="num" style={{ color: (a.fadePct ?? 0) < 0 ? "var(--good)" : "var(--warn)" }}>
                    {a.fadePct != null ? `${a.fadePct > 0 ? "+" : ""}${a.fadePct}%` : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {a.excluded ? (
                        <span className="pill warn" style={{ fontSize: 10.5 }} title={a.excludeReason}>
                          {a.excludeSource === "manual" ? "已排除·手动" : "已排除·自动"}
                        </span>
                      ) : a.excludeSource === "included" ? (
                        <span className="pill good" style={{ fontSize: 10.5 }} title="自动判定为异常，但你要求纳入基准">
                          有效·手动纳入
                        </span>
                      ) : (
                        <span className="pill good" style={{ fontSize: 10.5 }}>有效</span>
                      )}
                      {editing === a.labelId ? (
                        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") run(a.labelId, true, draft);
                              if (e.key === "Escape") setEditing(null);
                            }}
                            placeholder="排除原因（仅本地记账）"
                            style={{ width: 180, fontSize: 11.5, padding: "2px 6px" }}
                            autoFocus
                          />
                          <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                            disabled={busy === a.labelId}
                            onClick={() => run(a.labelId, true, draft)}>确定</button>
                          <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                            onClick={() => setEditing(null)}>取消</button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          {a.excluded ? (
                            <>
                              <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                                disabled={busy === a.labelId}
                                title="强制纳入基准，覆盖自动判定"
                                onClick={() => run(a.labelId, false)}>纳入</button>
                              {a.excludeSource === "manual" && (
                                <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                                  disabled={busy === a.labelId}
                                  title="撤销人工设定，交回自动判定"
                                  onClick={() => run(a.labelId, null)}>撤销</button>
                              )}
                            </>
                          ) : (
                            <>
                              <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                                disabled={busy === a.labelId}
                                title="移出能力基准"
                                onClick={() => { setDraft(""); setEditing(a.labelId); }}>排除</button>
                              {a.excludeSource === "included" && (
                                <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }}
                                  disabled={busy === a.labelId}
                                  title="撤销人工纳入，交回自动判定"
                                  onClick={() => run(a.labelId, null)}>撤销</button>
                              )}
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <details className="briefing-explain-details" style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-dim)", userSelect: "none", padding: "4px 2px" }}>
          💡 什么是「海平面等效」与「基准调控」？<span style={{ fontSize: 10.5, color: "var(--text-faint)", marginLeft: 4 }}>（点击展开说明）</span>
        </summary>
        <div
          style={{
            marginTop: 6,
            padding: "9px 12px",
            background: "var(--surface)",
            borderRadius: 7,
            border: "1px solid var(--border)",
            fontSize: 11.5,
            color: "var(--text-dim)",
            lineHeight: 1.55,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
            <span className="pill" style={{ fontSize: 10, padding: "1px 5px", flexShrink: 0 }}>海平面等效</span>
            <span>扣除赛道爬升代价与高原惩罚后的标准成绩，是跨赛事公平横向对标能力的唯一基准。</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span className="pill" style={{ fontSize: 10, padding: "1px 5px", flexShrink: 0 }}>基准调控</span>
            <span>
              系统会自动识别后程掉速且心率反常下降的异常场次并默认移出基准。你可以通过表格中的按钮随时手动「纳入 / 排除 / 撤销」，定制符合个人真实水平的基准池。
            </span>
          </div>
        </div>
      </details>
    </>
  );
}

/**
 * 备赛简报 —— 动态层。
 *
 * 和 RouteProfileCard 的分工：
 *   RouteProfileCard  = 赛道长什么样（静态，缓存）
 *   本组件            = 你现在能不能跑到（动态，每次同步重算）
 */
export default function RaceBriefingCard({ d, onChanged }: { d: RaceBriefing; onChanged?: () => void }) {
  const b = d.briefing;

  const [pacingOpen, setPacingOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = sessionStorage.getItem("race_pacing_open");
    if (saved !== null) return saved === "true";
    return window.innerWidth > 900;
  });
  const [anchorsOpen, setAnchorsOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = sessionStorage.getItem("race_anchors_open");
    if (saved !== null) return saved === "true";
    return window.innerWidth > 900;
  });

  const togglePacing = () => {
    setPacingOpen(prev => {
      const next = !prev;
      sessionStorage.setItem("race_pacing_open", String(next));
      return next;
    });
  };

  const toggleAnchors = () => {
    setAnchorsOpen(prev => {
      const next = !prev;
      sessionStorage.setItem("race_anchors_open", String(next));
      return next;
    });
  };

  const distKm = d.race?.distanceKm || (b.pacing?.segments.length ? b.pacing.segments[b.pacing.segments.length - 1].toKm : 42.195);
  const avgPaceSec = b.pacing ? b.pacing.goalSec / distKm : null;
  const validAnchorsCount = b.anchors.filter(a => !a.excluded).length;
  const excludedAnchorsCount = b.anchors.length - validAnchorsCount;

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      {/* 头部标题与定位 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <h3 className="card-title" style={{ margin: 0 }}>备赛简报</h3>
          <p className="card-sub" style={{ margin: "3px 0 0" }}>
            数据驱动的赛前状态客观推导，战术策略供备赛参考，实际执行以教练方案为准
          </p>
        </div>
        <span className="pill" style={{ fontSize: 11 }}>随训练数据自动重算</span>
      </div>

      {/* 第一层：双列指标看板（左右完全对称） */}
      <div className="grid g2" style={{ alignItems: "stretch", marginBottom: 18 }}>
        <div className="card" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", margin: 0, padding: 14 }}>
          <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-dim)", display: "flex", justifyContent: "space-between" }}>
            <span>成绩预测与目标</span>
            <span style={{ fontSize: 11, fontWeight: "normal" }}>折算地形与海拔</span>
          </h4>
          <PredictionCard b={b} goalSec={d.race.goalSec} />
        </div>

        <div className="card" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", margin: 0, padding: 14 }}>
          <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-dim)", display: "flex", justifyContent: "space-between" }}>
            <span>备赛体能状态</span>
            <span style={{ fontSize: 11, fontWeight: "normal" }}>近 4 周动态窗口</span>
          </h4>
          <TrainingStateCard training={b.training} />
        </div>
      </div>

      {/* 第二层：配速策略（可折叠，移动端省空间） */}
      {b.pacing && (
        <div className="card briefing-collapsible-card" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", margin: "0 0 18px", padding: 14 }}>
          <div
            className="briefing-collapse-header"
            onClick={togglePacing}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                togglePacing();
              }
            }}
            title={pacingOpen ? "点击收起各阶段配速策略" : "点击展开各阶段配速策略"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
                各阶段配速策略
              </h4>
              <span className="pill" style={{ fontSize: 11 }}>{b.pacing.segments.length} 个阶段</span>
              <span className="pill accent" style={{ fontSize: 11 }}>
                目标 {fDur(b.pacing.goalSec)}（均速 {avgPaceSec ? fPace(avgPaceSec) : "--"}/km）
              </span>
              {b.pacing.warnings.length > 0 && (
                <span className="pill warn" style={{ fontSize: 11 }}>⚠ {b.pacing.warnings.length} 条提醒</span>
              )}
            </div>
            <div className="briefing-toggle-btn">
              <span>{pacingOpen ? "收起" : "展开"}</span>
              <span style={{ fontSize: 10, transition: "transform 0.18s", transform: pacingOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </div>
          </div>
          {pacingOpen && (
            <div style={{ marginTop: 12 }}>
              <PacingCard b={b} />
            </div>
          )}
        </div>
      )}

      {/* 第三层：历史比赛锚点基准（可折叠，移动端省空间） */}
      {b.anchors.length > 0 && (
        <div className="card briefing-collapsible-card" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", margin: 0, padding: 14 }}>
          <div
            className="briefing-collapse-header"
            onClick={toggleAnchors}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleAnchors();
              }
            }}
            title={anchorsOpen ? "点击收起能力基准锚点" : "点击展开能力基准锚点"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
                能力基准锚点（历史赛事记录）
              </h4>
              <span className="pill" style={{ fontSize: 11 }}>收录 {b.anchors.length} 场</span>
              <span className="pill good" style={{ fontSize: 11 }}>{validAnchorsCount} 场有效基准</span>
              {excludedAnchorsCount > 0 && (
                <span className="pill warn" style={{ fontSize: 11 }}>
                  {excludedAnchorsCount} 场已排除
                </span>
              )}
            </div>
            <div className="briefing-toggle-btn">
              <span>{anchorsOpen ? "收起" : "展开"}</span>
              <span style={{ fontSize: 10, transition: "transform 0.18s", transform: anchorsOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </div>
          </div>
          {anchorsOpen && (
            <div style={{ marginTop: 12 }}>
              <AnchorTable anchors={b.anchors} onChanged={onChanged} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}