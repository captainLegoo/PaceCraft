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
      <div className="grid g3" style={{ marginBottom: 10 }}>
        <div className="stat">
          <span className="label">你的目标</span>
          <span className="value num" style={{ fontSize: 24, color: "var(--text)" }}>
            {goalSec != null ? fDur(goalSec) : <span style={{ color: "var(--text-faint)" }}>未设定</span>}
          </span>
          <span className="hint">手动填写 · 不会因训练变化而改变</span>
        </div>
        <div className="stat">
          <span className="label">当前预测</span>
          <span className="value num" style={{ color: "var(--accent)", fontSize: 26 }}>{fDur(p.bestSec)}</span>
          <span className="hint">按现有数据算出 · 训练变了会跟着变</span>
          <span className="hint">已折算本场地形与海拔</span>
        </div>
        <div className="stat">
          <span className="label">距比赛</span>
          <span className="value num">{b.daysToRace ?? "—"}<span className="unit">天</span></span>
          <span className="hint">置信度 {p.confidence} · 区间 {fDur(p.lowSec)}~{fDur(p.highSec)}</span>
        </div>
      </div>

      {gapSec != null && (
        <div
          className="banner"
          style={{
            fontSize: 12.5,
            background: reachable ? "var(--info-bg)" : "var(--warn-bg)",
            border: `1px solid ${reachable ? "var(--info-border)" : "var(--warn-border)"}`,
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
              目标 <strong>{fDur(goalSec!)}</strong> 比当前预测 <strong>{fDur(p.bestSec)}</strong> 慢{" "}
              <strong>{fDur(Math.abs(gapSec))}</strong>，余量约 {(Math.abs(gapSec) / p.bestSec * 100).toFixed(1)}%。
              这是个偏保守的目标，适合赛前稳定发挥。
            </>
          ) : (
            <>
              目标 <strong>{fDur(goalSec!)}</strong> 比当前预测 <strong>{fDur(p.bestSec)}</strong> 慢{" "}
              <strong>{fDur(Math.abs(gapSec))}</strong>，余量较宽。以当前状态跑进这个成绩的把握较大。
            </>
          )}
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-dim)" }}>
          预测是怎么算出来的（纯数据，不含 AI）
        </summary>
        <div style={{ marginTop: 8 }}>
          <div className="hint" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{p.basis}</div>
          <div style={{ marginTop: 8 }}>
            <h4 style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--text-dim)" }}>影响因素</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {p.factors.map((f, i) => (
                <span key={i} className="pill" style={{ color: TONE_COLOR[f.tone], borderColor: "var(--border-strong)", fontSize: 11 }}>
                  {f.label}：{f.effect}
                </span>
              ))}
            </div>
          </div>
          <div className="hint" style={{ marginTop: 8, fontSize: 11.5 }}>{p.confidenceNote}</div>
        </div>
      </details>
    </>
  );
}

function PacingCard({ b }: { b: Briefing }) {
  const p = b.pacing;
  if (!p) return null;
  return (
    <>
      <p className="card-sub" style={{ marginTop: 0 }}>{p.strategySummary}</p>
      <table>
        <thead>
          <tr><th>阶段</th><th>里程</th><th>目标配速</th><th>心率上限</th><th>意图</th></tr>
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
                {s.targetHr ? `≤ ${s.targetHr}` : "不限"}
              </td>
              <td className="cell-text" style={{ textAlign: "left", fontSize: 11.5, color: "var(--text-dim)" }}>
                {s.intent}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 8 }}>
        心率上限来源：{p.hrCapSource === "anchors" ? "实测比赛" : "最大心率百分比"}
        —— {p.hrCapNote}
      </div>
      {p.warnings.length > 0 && (
        <div style={{ marginTop: 12 }}>
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
      <table>
        <thead>
          <tr><th>日期</th><th>赛事</th><th>实测</th><th>海平面等效</th><th>爬升</th><th>海拔</th><th>前后半</th><th>状态</th></tr>
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
                        placeholder="排除原因（只有你知道）"
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
  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <h3 className="card-title" style={{ margin: 0 }}>备赛简报</h3>
        <span className="hint">随训练数据自动更新 · 同步后重算</span>
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>
        以下全部是<strong>数据陈述</strong>，不是训练建议 —— 训练计划由你的教练负责。
      </div>

      <div className="grid g2" style={{ alignItems: "start" }}>
        <div>
          <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-dim)" }}>成绩预测</h4>
          <PredictionCard b={b} goalSec={d.race.goalSec} />

          <h4 style={{ margin: "20px 0 8px", fontSize: 13, color: "var(--text-dim)" }}>配速策略</h4>
          <PacingCard b={b} />
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-dim)" }}>训练状态</h4>
          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="stat">
              <span className="label">近 4 周周均</span>
              <span className="value num">{b.training.weeklyKm4}<span className="unit">km</span></span>
              <span className="hint">
                {b.training.trendPct != null
                  ? `趋势 ${b.training.trendPct > 0 ? "+" : ""}${b.training.trendPct}%`
                  : `8周均 ${b.training.weeklyKm8}km`}
              </span>
              <span className="hint">
                截至 {b.training.asOf} 的 28 天 · 同步新训练即更新
              </span>
              {b.training.daysSinceAnchor > 0 && (
                <span className="hint" style={b.training.daysSinceAnchor >= 3 ? { color: "var(--warn)" } : undefined}>
                  距上次训练 {b.training.daysSinceAnchor} 天
                  {b.training.daysSinceAnchor >= 3 ? "（数据可能已过时）" : ""}
                </span>
              )}
            </div>
            <div className="stat">
              <span className="label">负荷比</span>
              <span className="value num" style={{ color: (b.training.loadRatio ?? 1) > 1.4 ? "var(--warn)" : "var(--good)" }}>
                {b.training.loadRatio ?? "—"}
              </span>
              <span className="hint">
                {(b.training.loadRatio ?? 1) > 1.4 ? "偏高，有累积疲劳" : (b.training.loadRatio ?? 1) < 0.75 ? "偏低，刺激不足" : "处于合理区间"}
              </span>
              {b.training.loadAsOf && (
                <span className="hint">截至 {b.training.loadAsOf}</span>
              )}
            </div>
            <div className="stat">
              <span className="label">有氧占比</span>
              <span className="value num" style={{ color: (b.training.easyPct ?? 100) < 75 ? "var(--warn)" : "var(--good)" }}>
                {b.training.easyPct ?? "—"}<span className="unit">%</span>
              </span>
              <span className="hint">目标 75–80%</span>
            </div>
            <div className="stat">
              <span className="label">长距离准备</span>
              <span className="value num" style={{ fontSize: 20, color: b.training.longRun.ready ? "var(--good)" : "var(--warn)" }}>
                {(b.training.longRun.ready?.km ?? b.training.longRun.max?.km) ?? "—"}<span className="unit">km</span>
              </span>
              <span className="hint">
                {b.training.longRun.ready
                  ? `近 4 周有 ${b.training.longRun.ready.km}km（${b.training.longRun.ready.date}）`
                  : b.training.longRun.max
                    ? `近 4 周最长 ${b.training.longRun.max.km}km`
                    : "近 4 周无 ≥25km 训练"}
              </span>
            </div>
          </div>

          <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-dim)" }}>比赛锚点</h4>
          <AnchorTable anchors={b.anchors} onChanged={onChanged} />
          <div className="hint" style={{ marginTop: 6 }}>
            「海平面等效」= 扣掉爬升代价与高原惩罚后的成绩，是唯一能跨比赛比较的指标。
            自动判定会挑出<strong>异常场次</strong>（后程配速下降的同时心率反而下降，与正常疲劳相反）并移出基准 ——
            但这只看数据形态，不推断原因，也未必适用于每个人。
            每行都能<strong>手动排除 / 纳入 / 撤销</strong>，原因只有你清楚。
          </div>
        </div>
      </div>
    </div>
  );
}