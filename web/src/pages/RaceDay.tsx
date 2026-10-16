import { useEffect, useRef, useState } from "react";
import { fmtP, fmtT, Markdown, useWidth } from "../charts";
import { IconChat, IconFlag, IconRun, IconTarget } from "../icons";

type Split = {
  km: number; cumulativeSec: number; paceSec: number; hr: number; maxHr: number;
  cadence: number; vsGoalSec: number;
};
type Quarter = { paceSec: number; hr: number; km: number };

type Analysis = {
  mode: "result" | "plan";
  date: string; daysAway: number; goalSec: number | null; goalPaceSec: number | null;
  found: boolean;
  actual: { seconds: number; distanceKm: number; paceSec: number; avgHr: number } | null;
  predicted: { seconds: number; paceSec: number } | null;
  deltaVsGoalSec: number | null;
  deltaVsPredictedSec: number | null;
  halves: {
    first: { paceSec: number; hr: number; km: number } | null;
    second: { paceSec: number; hr: number; km: number } | null;
    paceDriftSec: number | null; hrDrift: number | null;
  };
  quarters: Quarter[];
  splits: Split[];
  verdict: string; verdictReason: string;
  prep: any; fadePattern: { typicalFadeKm: number | null; sampleRuns: number; note: string } | null;
};

type Msg = { id: number; role: string; content: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const nextSunday = () => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() + ((7 - w) % 7 || 7)); return iso(d); };

export default function RaceDay({ aiConfigured, dataVersion = 0 }: { aiConfigured: boolean; dataVersion?: number }) {
  const [date, setDate] = useState(nextSunday());
  /**
   * `goalInput` = 输入框里正在敲的字（立刻回显，键盘手感不能有延迟）
   * `goal`      = 真正拿去算的值（去抖后才更新）
   *
   * 原来只有一个 `goal`，既是输入值又是请求参数，于是每敲一个字符就：
   *   setA(null) → 整块 UI 塌成骨架屏 → 请求回来 → 重新挂载
   * 「一闪一闪」就是这么来的。输入和取值拆开之后，敲字不再触发任何重排。
   */
  const [goalInput, setGoalInput] = useState("");
  const [goal, setGoal] = useState("");
  const [a, setA] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRace, setLastRace] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState("");

  // 停手 400ms 才真的去算。改日期不走这里（日期改动量小、必须立即响应）。
  useEffect(() => {
    const t = setTimeout(() => setGoal(goalInput.trim()), 400);
    return () => clearTimeout(t);
  }, [goalInput]);

  /**
   * 重新拉取。
   *
   * 关键：**不再 `setA(null)`**。日期/目标变化时保留旧数据、只把 `loading`
   * 置上，界面用半透明提示「正在重算」。骨架屏方案（卸载整块再挂回来）
   * 在这种高频刷新场景下就是肉眼可见的闪烁。
   *
   * `seq` 用来丢弃过期响应：连点几个快捷日期时，先发的请求可能后到，
   * 不加这道闸门会出现「选了 11/08，界面却显示 10/12」。
   */
  const seq = useRef(0);
  const reload = () => {
    const my = ++seq.current;
    setLoading(true);
    const gs = encodeURIComponent(goal);
    return fetch(`/api/race?date=${date}${goal ? `&goal=${gs}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (my !== seq.current) return; // 已有更新的请求在路上，丢弃
        if (j.error) setErr(j.error);
        else { setA(j); setErr(null); }
      })
      .catch((e) => { if (my === seq.current) setErr(String(e)); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  };

  useEffect(() => { reload(); }, [date, goal]);

  useEffect(() => {
    fetch(`/api/race/thread?date=${date}`).then((r) => r.json()).then(setMsgs).catch(() => {});
  }, [date, dataVersion]);

  // 「上场比赛」：最近一次长距离（≥15km），复盘时一键跳过去
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((list: any[]) => {
        const cand = list.filter((s) => s.totals.distanceKm >= 15)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (cand) setLastRace(cand.date);
      })
      .catch(() => {});
  }, []);

  const analyze = async () => {
    setBusy(true); setErr(null);
    try {
      await fetch("/api/ai/race", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, goal: goalInput.trim() || null }),
      }).then(async (r) => { const j = await r.json(); if (j.error) throw new Error(j.error); return j; });
      await reload();
      const th = await fetch(`/api/race/thread?date=${date}`).then((r) => r.json());
      setMsgs(th);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const ask = async () => {
    if (!q.trim()) return;
    setAsking(true); setErr(null);
    try {
      const r = await fetch("/api/ai/race/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, goal: goalInput.trim() || null, question: q }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setQ("");
      const th = await fetch(`/api/race/thread?date=${date}`).then((x) => x.json());
      setMsgs(th);
    } catch (e) { setErr((e as Error).message); }
    finally { setAsking(false); }
  };

  const clear = async () => {
    await fetch(`/api/race/thread?date=${date}`, { method: "DELETE" });
    setMsgs([]);
  };

  const hasReport = msgs.some((m) => m.role === "assistant");

  return (
    <>
      <div className="banner info">
        填比赛日期，<strong>日期过了就自动做赛后复盘，日期没到就自动做赛前方案</strong>。
        不用跟 AI 描述你要什么 —— 数据会自己拉全，一次给你一份完整分析；
        看完想钻进去再追问。
      </div>

      {/* 比赛设置 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title"><IconFlag size={14} />比赛</h3>
        <div className="prep-controls">
          <div>
            <span className="ctl-label">比赛日期</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} />
            <div className="quick">
              <button onClick={() => setDate(addDays(0))}>今天</button>
              <button onClick={() => setDate(addDays(-1))}>昨天</button>
              <button onClick={() => setDate(addDays(-7))}>7 天前</button>
              {lastRace && (
                <button className="accent" onClick={() => setDate(lastRace)}>上场比赛 {lastRace.slice(5)}</button>
              )}
              <button onClick={() => setDate(nextSunday())}>下周日</button>
            </div>
          </div>
          <div>
            <span className="ctl-label">目标成绩（可选）</span>
            <input
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="如 3:10:00 或 3:05"
              style={{ maxWidth: 160 }}
            />
            <div className="hint">填了才能算「离目标差多少」和分段配速计划</div>
          </div>
          <div className="prep-dday">
            {a?.daysAway != null && (
              a.daysAway > 0
                ? <><span className="dday-num">{a.daysAway}</span><span className="hint">天后比赛</span></>
                : <span className="pill accent">比赛日分析</span>
            )}
          </div>
        </div>
      </div>

      {err && <div className="banner error" style={{ marginBottom: 14 }}>{err}</div>}
      {!aiConfigured && <div className="banner info" style={{ marginBottom: 14 }}>还没有配置 AI 模型，请到「设置」页填写。</div>}

      {/*
        重算期间保留上一份结果，只做轻微降透明 + 顶部一条细进度条。
        早先的 `setA(null)` 会把这一整块卸成骨架屏，日期或目标一变就
        塌下去再弹回来 —— 高频操作下就是肉眼看到的闪烁。
      */}
      {loading && <div className="top-progress" />}

      <div className={loading ? "results-wrap is-reloading" : "results-wrap"}>
        {a && <KeyStats a={a} />}

        {a?.mode === "result" && a.found && <ResultDetail a={a} goal={goalInput} />}
      </div>

      {/* 一键分析 */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 className="card-title">
          {a?.mode === "result" ? "赛后复盘" : "赛前方案"}
        </h3>
        <p className="card-sub">
          {a?.mode === "result"
            ? "把这场真实的逐公里数据、你的历史掉速规律、当前预测一起交给模型，诊断执行问题"
            : "把最近几周的训练体检、你的习惯性掉速点、当前预测一起交给模型，给出配速分段计划"}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: hasReport ? 16 : 0 }}>
          <button className="btn primary" disabled={!aiConfigured || busy} onClick={analyze}>
            {busy ? <><span className="spin" /> 分析中…</> : hasReport ? "重新分析" : "一键分析"}
          </button>
          {hasReport && <button className="btn" onClick={clear}>清空对话</button>}
        </div>

        {/* 报告 + 追问 */}
        {msgs.length > 0 && (
          <div className="thread">
            {msgs.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <div className="msg-role">{m.role === "user" ? "你" : "教练"}</div>
                {m.role === "assistant" ? <Markdown text={m.content} /> : <div className="msg-text">{m.content}</div>}
              </div>
            ))}
          </div>
        )}

        {hasReport && (
          <div className="followup">
            <input
              placeholder="接着问，比如：第 25km 那段为什么会掉速？"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !asking) ask(); }}
              disabled={asking}
            />
            <button className="btn" onClick={ask} disabled={asking || !q.trim()}>
              {asking ? <><span className="spin" /> 思考中</> : <><IconChat size={15} />追问</>}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function KeyStats({ a }: { a: Analysis }) {
  const plan = a.mode === "plan";
  return (
    <div className="grid g4" style={{ marginBottom: 14 }}>
      {plan ? (
        <>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconTarget size={15} />目标配速</span>
              <span className="value num" style={{ color: "var(--accent)" }}>{a.goalSec ? fmtP(a.goalPaceSec) : "—"}</span>
              <span className="hint">{a.goalSec ? fmtT(a.goalSec) : "先填目标成绩，或用预测值"}</span>
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconRun size={15} />模型预测</span>
              <span className="value num">{a.predicted ? fmtT(a.predicted.seconds) : "—"}</span>
              <span className="hint">{a.predicted ? fmtP(a.predicted.paceSec) + "/km" : "数据不足"}</span>
              <span className="hint">自建模型 · 未含本场地形折算</span>
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconFlag size={15} />距离比赛</span>
              <span className="value num">{a.daysAway}</span>
              <span className="hint">天</span>
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconRun size={15} />习惯掉速点</span>
              <span className="value num" style={{ color: "var(--warn)" }}>
                {a.fadePattern?.typicalFadeKm ? `第 ${a.fadePattern.typicalFadeKm} km` : "无明显"}
              </span>
              <span className="hint">{a.fadePattern ? `${a.fadePattern.sampleRuns} 次长距离统计` : "样本不足"}</span>
            </div>
          </div>
        </>
      ) : a.found && a.actual ? (
        <>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconTarget size={15} />实际成绩</span>
              <span className="value num" style={{ color: "var(--accent)" }}>{fmtT(a.actual.seconds)}</span>
              <span className="hint">{a.actual.distanceKm} km · {fmtP(a.actual.paceSec)}/km</span>
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconRun size={15} />对比目标</span>
              <span className="value num" style={{ color: deltaColor(a.deltaVsGoalSec) }}>
                {a.deltaVsGoalSec == null ? "—" : `${a.deltaVsGoalSec <= 0 ? "−" : "+"}${fmtT(Math.abs(a.deltaVsGoalSec))}`}
              </span>
              <span className="hint">{a.goalSec ? `目标 ${fmtT(a.goalSec)}` : "未填目标"}</span>
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconRun size={15} />配速漂移</span>
              <span className="value num" style={{ color: (a.halves.paceDriftSec ?? 0) > 8 ? "var(--bad)" : "var(--good)" }}>
                {a.halves.paceDriftSec == null ? "—" : `${a.halves.paceDriftSec > 0 ? "+" : ""}${a.halves.paceDriftSec}s`}
              </span>
              <span className="hint">后半程比前半程</span>
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat">
              <span className="label"><IconFlag size={15} />心率漂移</span>
              <span className="value num" style={{ color: (a.halves.hrDrift ?? 0) > 5 ? "var(--bad)" : "var(--good)" }}>
                {a.halves.hrDrift == null ? "—" : `${a.halves.hrDrift >= 0 ? "+" : ""}${a.halves.hrDrift}`}
              </span>
              <span className="hint">bpm · {a.halves.paceDriftSec != null && a.halves.hrDrift != null && a.halves.paceDriftSec > 8 && a.halves.hrDrift > 5 ? "疲劳型掉速" : "配速型掉速"}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="banner warn" style={{ margin: 0 }}>
            {a.date} 没有找到训练记录。如果比赛就在今天，先到「设置」页同步一次数据。
          </div>
        </div>
      )}
    </div>
  );
}

function ResultDetail({ a, goal }: { a: Analysis; goal: string }) {
  const hasGoal = !!goal.trim();
  return (
    <>
      {a.quarters.length === 4 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">四分段表现</h3>
          <p className="card-sub">时间通常丢在后两个分段，看它们和前两段的差</p>
          <div className="quarters">
            {a.quarters.map((q, i) => {
              const base = a.quarters[0].paceSec;
              const slower = q.paceSec - base;
              return (
                <div className="quarter" key={i}>
                  <div className="q-name">第 {i + 1} 段</div>
                  <div className="q-km">{q.km} km</div>
                  <div className="q-pace">{fmtP(q.paceSec)}<span>/km</span></div>
                  <div className="q-hr">心率 {q.hr}</div>
                  {hasGoal && (
                    <div className="q-goal" style={{ color: slower > 5 ? "var(--warn)" : "var(--good)" }}>
                      比首段{slower > 0 ? "慢" : "快"} {Math.abs(slower)}s
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {a.splits.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">逐公里明细</h3>
          <p className="card-sub">灰底的是累计时间，蓝色是心率{hasGoal ? "，最右列是相对目标配速的偏差" : ""}</p>
          <SplitChart splits={a.splits} hasGoal={hasGoal} />
          <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 12 }}>
            <table>
              <thead>
                <tr><th>公里</th><th>累计</th><th>配速</th><th>心率</th><th>最大</th><th>步频</th>{hasGoal && <th>对目标</th>}</tr>
              </thead>
              <tbody>
                {a.splits.map((s) => (
                  <tr key={s.km}>
                    <td>{s.km}</td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>{fmtT(s.cumulativeSec)}</td>
                    <td className="num">{fmtP(s.paceSec)}</td>
                    <td className="num">{s.hr}</td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>{s.maxHr}</td>
                    <td className="num">{s.cadence || "—"}</td>
                    {hasGoal && (
                      <td className="num" style={{ color: s.vsGoalSec > 6 ? "var(--bad)" : s.vsGoalSec > 2 ? "var(--warn)" : s.vsGoalSec < -2 ? "var(--hr)" : "var(--good)" }}>
                        {s.vsGoalSec > 0 ? "+" : ""}{s.vsGoalSec}s
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {a.verdict && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">执行判定</h3>
          <div className="verdict">
            <span className={`verdict-tag ${a.verdict.includes("掉速") ? "bad" : a.verdict.includes("匀速") ? "good" : "warn"}`}>
              {a.verdict}
            </span>
            <p className="verdict-text">{a.verdictReason}</p>
          </div>
          {a.halves.first && a.halves.second && (
            <div className="half-compare">
              <div>
                <span>前半（{a.halves.first.km}km）</span>
                <strong>{fmtP(a.halves.first.paceSec)}/km</strong>
                <em>心率 {a.halves.first.hr}</em>
              </div>
              <div className="arrow">→</div>
              <div>
                <span>后半（{a.halves.second.km}km）</span>
                <strong>{fmtP(a.halves.second.paceSec)}/km</strong>
                <em>心率 {a.halves.second.hr}</em>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SplitChart({ splits, hasGoal }: { splits: Split[]; hasGoal: boolean }) {
  // 用实测像素宽度：preserveAspectRatio="none" 会把圆点横向拉成横线
  const [ref, w] = useWidth<HTMLDivElement>();
  const H = 170, padT = 10, padB = 8, padX = 12;
  const iw = Math.max(10, w - padX * 2);
  const ih = H - padT - padB;
  const maxSec = Math.max(...splits.map((s) => s.paceSec), 1);
  const minSec = Math.min(...splits.map((s) => s.paceSec), maxSec);
  const span = maxSec - minSec || 1;
  const maxHr = Math.max(...splits.map((s) => s.hr), 1);
  const minHr = Math.min(...splits.map((s) => s.hr), maxHr);
  const hrSpan = maxHr - minHr || 1;
  const n = splits.length;
  const cx = (i: number) => padX + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yPace = (v: number) => padT + ih - ((v - minSec) / span) * ih;
  const yHr = (v: number) => padT + ih - ((v - minHr) / hrSpan) * ih;

  return (
    <div className="split-chart" ref={ref}>
      <svg height={H} style={{ display: "block", width: "100%" }}>
        {hasGoal && splits[0]?.vsGoalSec !== 0 && (
          <line
            x1={padX} x2={padX + iw} y1={yPace(splits[0].paceSec - splits[0].vsGoalSec)}
            y2={yPace(splits[0].paceSec - splits[0].vsGoalSec)}
            stroke="var(--good)" strokeWidth={1.4} strokeDasharray="5 4"
          />
        )}
        <polyline
          points={splits.map((s, i) => `${cx(i)},${yPace(s.paceSec)}`).join(" ")}
          fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
        <polyline
          points={splits.map((s, i) => `${cx(i)},${yHr(s.hr)}`).join(" ")}
          fill="none" stroke="var(--hr)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round"
        />
        {splits.map((s, i) => (
          <circle key={s.km} cx={cx(i)} cy={yHr(s.hr)} r={3} fill="var(--hr)" stroke="var(--surface)" strokeWidth={1} />
        ))}
      </svg>
      <div className="split-axis">
        {[1, Math.ceil(n / 2), n].map((k) => <span key={k}>{k} km</span>)}
      </div>
      <div className="legend">
        <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--accent)" }} />配速（越往下越慢）</div>
        <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--hr)" }} />心率（越往下越高）</div>
        {hasGoal && <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--good)" }} />目标配速</div>}
      </div>
    </div>
  );
}

function deltaColor(d: number | null) {
  if (d == null) return "var(--text)";
  if (Math.abs(d) < 60) return "var(--good)";
  return d <= 0 ? "var(--good)" : "var(--bad)";
}
