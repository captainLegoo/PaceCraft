import { useEffect, useState } from "react";
import { apiUrl } from "../api";
import { fmtP, fmtT, useWidth } from "../charts";
import { IconFlag, IconPulse, IconTrophy } from "../icons";

type Weekly = {
  weekStart: string; distanceKm: number; sessions: number;
  longestRunKm: number; longRunDate: string | null; avgPaceSec: number;
  qualitySessions: number; loadShort: number | null; loadLong: number | null;
  loadRatio: number | null; volumeChangePct: number | null;
};

type Item = { key: string; label: string; status: "ok" | "warn" | "bad" | "unknown"; detail: string; value: string };

type Report = {
  weeks: number; raceDate: string | null; daysToRace: number | null;
  weekly: Weekly[];
  summary: {
    totalKm: number; avgWeeklyKm: number; peakWeeklyKm: number; avgSessionsPerWeek: number;
    longestRunKm: number; longestRunDate: string | null; qualityPerWeek: number;
    buildStreak: number; volatility: number; hasLoadSpike: boolean; spikeWeek: string | null;
  };
  checklist: Item[];
  prediction: { seconds: number; paceSec: number } | null;
};

const STATUS = {
  ok: { icon: "✓", label: "达标", cls: "good" },
  warn: { icon: "!", label: "注意", cls: "warn" },
  bad: { icon: "✕", label: "不足", cls: "bad" },
  unknown: { icon: "·", label: "未知", cls: "" },
} as const;

export default function RacePrep({ aiConfigured, dataVersion = 0 }: { aiConfigured: boolean; dataVersion?: number }) {
  const [weeks, setWeeks] = useState(8);
  const [raceDate, setRaceDate] = useState("");
  const [d, setD] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [report, setReport] = useState<{ text: string; model: string; at: number } | null>(null);

  const qs = `weeks=${weeks}${raceDate ? `&raceDate=${raceDate}` : ""}`;

  useEffect(() => {
    setReport(null);
    fetch(apiUrl("/api/race-prep?" + qs))
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : (setD(j), setErr(null))))
      .catch((e) => setErr(String(e)));
  }, [weeks, raceDate, dataVersion]);

  const runAnalyze = async () => {
    setBusy(true); setAiErr(null);
    try {
      const r = await fetch(apiUrl("/api/ai/race-prep"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks, raceDate: raceDate || null, focus: focus.trim() || null }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setReport({ text: j.report, model: j.model, at: Date.now() });
    } catch (e) {
      setAiErr((e as Error).message);
    } finally { setBusy(false); }
  };

  if (err) return <div className="banner error">{err}</div>;
  if (!d) return <div><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>;

  const s = d.summary;
  const bad = d.checklist.filter((c) => c.status === "bad").length;
  const warn = d.checklist.filter((c) => c.status === "warn").length;

  return (
    <>
      <div className="banner info">
        这里只看<strong>最近 {d.weeks} 周</strong>的数据 —— 备赛决策关心的是当前状态，
        半年前的跑量对「能不能跑进目标成绩」没有参考价值。
        点「AI 备赛分析」会把这些数据整理好交给模型，给出可执行的周计划。
      </div>

      {/* 比赛设置 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title"><IconFlag size={14} />比赛设置</h3>
        <p className="card-sub">填上比赛日期，体检项会按剩余周数切换视角（爬坡期 / 关键期 / 减量期）</p>
        <div className="prep-controls">
          <div>
            <span className="ctl-label">回溯周数</span>
            <div className="seg">
              {[4, 6, 8, 12, 16].map((w) => (
                <button key={w} className={weeks === w ? "active" : ""} onClick={() => setWeeks(w)}>{w} 周</button>
              ))}
            </div>
          </div>
          <div>
            <span className="ctl-label">比赛日期</span>
            <input
              type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)}
              style={{ maxWidth: 190 }}
            />
          </div>
          <div className="prep-dday">
            {d.daysToRace == null
              ? <span className="hint">未设定比赛日期</span>
              : d.daysToRace < 0
                ? <span className="pill">比赛已结束</span>
                : <><span className="dday-num">{d.daysToRace}</span><span className="hint">天后比赛</span></>}
          </div>
        </div>
      </div>

      {/* 概览 */}
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconPulse size={15} />周均跑量</span>
            <span className="value num">{s.avgWeeklyKm}<span className="unit">km</span></span>
            <span className="hint">峰值 {s.peakWeeklyKm} km｜共 {s.totalKm} km</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconFlag size={15} />最长单跑</span>
            <span className="value num">{s.longestRunKm}<span className="unit">km</span></span>
            <span className="hint">{s.longestRunDate ?? "—"}</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconTrophy size={15} />强度课密度</span>
            <span className="value num">{s.qualityPerWeek}<span className="unit">次/周</span></span>
            <span className="hint">周均 {s.avgSessionsPerWeek} 场训练</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconTrophy size={15} />当前全马预测</span>
            <span className="value num" style={{ color: "var(--accent)" }}>
              {d.prediction ? fmtT(d.prediction.seconds) : "—"}
            </span>
            <span className="hint">
              {d.prediction ? fmtP(d.prediction.paceSec) + "/km" : "数据不足"}
            </span>
            <span className="hint">自建模型 · 5 模型加权中位数</span>
          </div>
        </div>
      </div>

      {/* 体检清单 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">
          备赛体检
          {bad > 0 && <span className="pill bad">{bad} 项不足</span>}
          {bad === 0 && warn > 0 && <span className="pill warn">{warn} 项注意</span>}
          {bad === 0 && warn === 0 && <span className="pill good">全部达标</span>}
        </h3>
        <p className="card-sub">判定标准是马拉松备赛的通行经验值，不是官方标准，仅供参考</p>
        <div className="checklist">
          {d.checklist.map((c) => {
            const st = STATUS[c.status];
            return (
              <div className="check-item" key={c.key}>
                <span className={`check-mark ${st.cls}`}>{st.icon}</span>
                <div className="check-body">
                  <div className="check-head">
                    <span className="check-label">{c.label}</span>
                    <span className="check-value">{c.value}</span>
                  </div>
                  <div className="check-detail">{c.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 周跑量柱状图 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">逐周训练量与最长单跑</h3>
        <p className="card-sub">柱子是周跑量，线是最长单次跑量。两者都要稳步爬升，而不是忽高忽低。</p>
        <WeeklyChart weekly={d.weekly} />
      </div>

      {/* 逐周表格 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">逐周明细</h3>
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>周起始</th><th>跑量</th><th>场次</th><th>最长单跑</th><th>强度课</th>
                <th>均配速</th><th>短期/长期</th><th>负荷比</th><th>周环比</th>
              </tr>
            </thead>
            <tbody>
              {[...d.weekly].reverse().map((w) => {
                const ch = w.volumeChangePct;
                return (
                  <tr key={w.weekStart}>
                    <td>{w.weekStart}</td>
                    <td className="num">{w.distanceKm} km</td>
                    <td className="num">{w.sessions}</td>
                    <td className="num">{w.longestRunKm} km</td>
                    <td className="num" style={{ color: w.qualitySessions > 0 ? "var(--accent)" : "var(--text-faint)" }}>
                      {w.qualitySessions}
                    </td>
                    <td className="num">{fmtP(w.avgPaceSec)}</td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>{w.loadShort ?? "—"}/{w.loadLong ?? "—"}</td>
                    <td className="num">{w.loadRatio ?? "—"}</td>
                    <td className="num" style={{ color: ch == null ? undefined : ch > 20 ? "var(--bad)" : ch > 8 ? "var(--warn)" : ch < 0 ? "var(--text-faint)" : "var(--good)" }}>
                      {ch == null ? "—" : `${ch > 0 ? "+" : ""}${ch}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI 分析 */}
      <div className="card">
        <h3 className="card-title">AI 备赛分析</h3>
        <p className="card-sub">
          把最近 {d.weeks} 周的训练量、最长单跑、强度课、负荷波动和当前预测一起交给模型，
          让它回答「现在能不能跑出目标成绩、最大短板是什么、这周怎么练」。
        </p>

        {!aiConfigured && <div className="banner info">还没有配置 AI 模型，请到「设置」页填写模型地址、API Key 和模型名。</div>}
        {aiErr && <div className="banner error">{aiErr}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            placeholder="关注点（可选），例如：想在 12 周后的比赛跑进 3 小时，目前差距在哪？"
            value={focus} onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && aiConfigured && !busy) runAnalyze(); }}
          />
          <button className="btn primary" disabled={!aiConfigured || busy} onClick={runAnalyze}>
            {busy ? <><span className="spin" /> 分析中…</> : report ? "重新分析" : "AI 备赛分析"}
          </button>
        </div>

        {report ? (
          <>
            <div className="hint" style={{ marginBottom: 10 }}>{report.model} · {new Date(report.at).toLocaleString("zh-CN")}</div>
            <div className="report" dangerouslySetInnerHTML={{ __html: mdToHtml(report.text) }} />
          </>
        ) : (
          <div className="empty-run"><IconFlag size={40} /><span>还没有分析记录</span></div>
        )}
      </div>
    </>
  );
}

/** 极简 Markdown → HTML（与服务端 AI 报告同一套渲染规则） */
function mdToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const cells = (l: string): string[] => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  const isSep = (l: string): boolean => l.includes("-") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l);
  const alignOf = (c: string): "center" | "right" | "left" => (c.endsWith(":") && c.startsWith(":") ? "center" : c.endsWith(":") ? "right" : "left");

  const out: string[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  const flush = () => {
    if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; }
  };
  // 用 while 而非 for...of：表格一行要连带吃掉分隔行和整个表体
  let i = 0;
  while (i < lines.length) {
    // while + 索引取行，noUncheckedIndexedAccess 下 lines[i] 可能为 undefined
    const t = (lines[i] ?? "").trim();
    if (t.startsWith("|") && isSep(lines[i + 1]?.trim() ?? "")) {
      flush();
      const head = cells(t);
      const aligns = cells(lines[i + 1].trim()).map(alignOf);
      const body: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        if (!lines[j].trim().startsWith("|")) break;
        body.push(cells(lines[j].trim()));
      }
      out.push(
        `<div class="table-wrap"><table><thead><tr>` +
          head.map((h, c) => `<th style="text-align:${aligns[c] ?? "left"}">${inline(h)}</th>`).join("") +
          `</tr></thead><tbody>` +
          body
            .map((r) => "<tr>" + head.map((_, c) => `<td style="text-align:${aligns[c] ?? "left"}">${inline(r[c] ?? "")}</td>`).join("") + "</tr>")
            .join("") +
          `</tbody></table></div>`,
      );
      i = j;
      continue;
    }
    if (/^#{1,4}\s/.test(t)) {
      flush();
      const lv = t.match(/^#+/)?.[0].length ?? 1;
      const c = t.replace(/^#+\s*/, "");
      out.push(lv <= 2 ? `<h2>${inline(c)}</h2>` : `<h3>${inline(c)}</h3>`);
    } else if (/^[-*]\s/.test(t)) { list.push(t.replace(/^[-*]\s*/, "")); }
    else if (/^\d+\.\s/.test(t)) { list.push(t.replace(/^\d+\.\s*/, "")); }
    else if (!t) flush();
    else { flush(); out.push(`<p>${inline(t)}</p>`); }
    i++;
  }
  flush();
  return out.join("");
}

function WeeklyChart({ weekly }: { weekly: Weekly[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // 必须用实测像素宽度：早先用 preserveAspectRatio="none" 拉伸 viewBox，
  // 圆点会被横向拉成横线。
  const [ref, w] = useWidth<HTMLDivElement>();
  const maxKm = Math.max(...weekly.map((x) => x.distanceKm), 1);
  const maxLong = Math.max(...weekly.map((x) => x.longestRunKm), 1);
  const H = 210, padT = 14, padB = 26, padL = 10, padR = 10;
  const iw = Math.max(10, w - padL - padR);
  const ih = H - padT - padB;
  const n = weekly.length;
  const slot = iw / n;
  const bw = Math.min(slot * 0.56, 40);
  const cx = (i: number) => padL + slot * i + slot / 2;

  return (
    <div className="chart-wrap weekly-chart" ref={ref}>
      <svg height={H} style={{ display: "block", width: "100%" }}>
        {weekly.map((x, i) => {
          const h = (x.distanceKm / maxKm) * ih;
          const on = hover === i;
          return (
            <g key={x.weekStart} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + slot * i} y={0} width={slot} height={H - padB} fill="transparent" />
              <rect
                x={cx(i) - bw / 2} y={H - padB - h} width={bw} height={h} rx={3}
                fill={x.distanceKm >= maxKm * 0.9 ? "var(--chart-accent)" : "var(--chart-accent-dim)"}
                opacity={hover == null || on ? 0.9 : 0.4}
              />
            </g>
          );
        })}
        {/* 最长单跑：用右轴语义，固定占 0~0.78 的高度带，避免和柱子的量纲混淆 */}
        <polyline
          points={weekly.map((x, i) => `${cx(i)},${H - padB - (x.longestRunKm / maxLong) * ih * 0.78}`).join(" ")}
          fill="none" stroke="var(--chart-hr)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round"
        />
        {weekly.map((x, i) => (
          <circle
            key={x.weekStart} cx={cx(i)} cy={H - padB - (x.longestRunKm / maxLong) * ih * 0.78}
            r={hover === i ? 5 : 3.5} fill="var(--chart-hr)" stroke="var(--surface)" strokeWidth={1.5}
          />
        ))}
        <line x1={padL} x2={padL + iw} y1={H - padB} y2={H - padB} stroke="var(--border-strong)" strokeWidth={1} />
      </svg>
      <div className="weekly-labels">
        {weekly.map((w, i) => (
          <span
            key={w.weekStart}
            className={hover === i ? "on" : ""}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {w.weekStart.slice(5)}
            {hover === i && (
              <em>
                {w.distanceKm}km · 最长 {w.longestRunKm}km · {w.sessions}场
                {w.volumeChangePct != null && ` · 环比${w.volumeChangePct > 0 ? "+" : ""}${w.volumeChangePct}%`}
              </em>
            )}
          </span>
        ))}
      </div>
      <div className="legend">
        <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--chart-accent)" }} />周跑量</div>
        <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--chart-hr)", borderRadius: "50%" }} />最长单跑</div>
      </div>
    </div>
  );
}
