import { useEffect, useState } from "react";
import { api, type Session, type SessionDetail } from "../api";
import { AerobicDecouplingCard, LineChart, Markdown, ZoneBar, fmtDur, fmtPace, paceColor } from "../charts";
import { IconBack, IconHeart, IconLoad, IconRoute, IconStopwatch as IconStopwatch2 } from "../icons";

export default function SessionView({
  sessionKey, onBack, aiConfigured, onOpenActivity,
}: {
  sessionKey: string;
  onBack: () => void;
  aiConfigured: boolean;
  onOpenActivity?: (labelId: string, sessionKey?: string) => void;
}) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const load = () => api.session(sessionKey).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); setErr(null); load(); }, [sessionKey]);

  if (err) return <div className="banner error">{err}</div>;
  if (!d) return <div><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>;

  const { session: s, activities, laps, zones, reports } = d;
  const multi = s.activityCount > 1;
  const setCount = s.sets.reduce((a, x) => a + x.reps, 0);

  // 整场连贯曲线：x 用累计时间，含组间休息。换记录处插一个空点，让休息段在曲线上真的断开
  // —— 否则两条记录会被一条直线连起来，看着像这段时间一直在跑。
  const chartLabels: string[] = [];
  const chartX: number[] = [];
  const paceSeries: (number | null)[] = [];
  const hrSeries: (number | null)[] = [];
  laps.forEach((l, i) => {
    const prev = laps[i - 1];
    if (prev && prev.labelId !== l.labelId) {
      chartLabels.push(`组间休息 ${fmtDur(l.elapsedSec - prev.elapsedSec)}`);
      chartX.push((prev.elapsedSec + l.elapsedSec) / 2);
      paceSeries.push(null);
      hrSeries.push(null);
    }
    chartLabels.push(`${l.labelId.slice(-4)}#${l.lapIndex}`);
    chartX.push(l.elapsedSec);
    paceSeries.push(l.distanceM >= 900 ? l.avgPaceSec : null);
    hrSeries.push(l.avgHr > 0 ? l.avgHr : null);
  });

  const runAnalyze = async () => {
    const currentFocus = focus.trim() || null;
    setBusy(true); setAiErr(null);
    setFocus("");
    try {
      await api.analyzeSession(sessionKey, currentFocus);
      await load();
    } catch (e) {
      setAiErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{s.date} 训练场次</h2>
          <div className="sub" style={{ wordBreak: "break-word" }}>
            <span className={`pill ${s.kind === "multi" ? "accent" : ""}`}>
              {s.kind === "multi" ? `${s.activityCount} 条记录合并` : "单次记录"}
            </span>
            {"  "}判定为 <strong style={{ color: "var(--accent)" }}>{s.classification}</strong> · {s.classificationReason}
          </div>
        </div>
        <button className="btn" style={{ flexShrink: 0 }} onClick={onBack}><IconBack size={15} />返回</button>
      </div>

      {multi && (
        <div className="banner info">
          这场训练被手表记录成 <strong>{s.activityCount} 条</strong>，已合并为一次整体分析。
          同一天里间隔超过 4 小时的记录会被判定为<strong>另一场</strong>独立训练，所以早晚各跑一次不会被混在一起。
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRoute size={15} />全场总距离</span>
            <span className="value num" style={{ color: "var(--accent)" }}>{s.totals.distanceKm}<span className="unit">km</span></span>
            <span className="hint">{s.activityCount} 条记录合计</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconStopwatch2 size={15} />全场总时长</span>
            <span className="value num">{fmtDur(s.totals.durationSec)}</span>
            <span className="hint">
              {multi
                ? `含记录间休息 ${fmtDur(s.maxGapSec)}`
                : `均配 ${fmtPace(s.totals.distanceKm ? s.totals.durationSec / s.totals.distanceKm : null)}/km`}
            </span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconHeart size={15} />平均心率</span>
            <span className="value num">{s.totals.avgHr ?? "—"}<span className="unit">bpm</span></span>
            <span className="hint">按时长加权</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconLoad size={15} />训练负荷合计</span>
            <span className="value num">{s.totals.trainingLoad || "—"}</span>
            <span className="hint">爬升 {s.totals.elevGain} m · {s.totals.calories} kcal</span>
          </div>
        </div>
      </div>

      {s.sets.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">组结构识别</h3>
          <p className="card-sub">
            从 {s.activityCount} 条记录中按距离与配速的一致性自动识别出 {s.sets.length} 组重复（共 {setCount} 组次）。
            这只是基于数据模式的推断，最终以你的实际安排为准。
          </p>
          <div className="table-scroll-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>组</th><th>单组距离</th><th>组数</th><th>平均单组用时</th>
                    <th>平均配速</th><th>平均心率</th><th>组间休息</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sets.map((set, i) => (
                    <tr key={i}>
                      <td>第 {i + 1} 组</td>
                      <td className="num" style={{ textAlign: "left", color: "var(--accent)" }}>{set.distanceLabel}</td>
                      <td className="num">× {set.reps}</td>
                      <td className="num">{fmtDur(set.avgDurationSec)}</td>
                      <td className="num">{fmtPace(set.avgPaceSec)}</td>
                      <td className="num">{set.avgHr ?? "—"}</td>
                      <td className="num" style={{ color: "var(--text-faint)" }}>
                        {set.restSec != null ? fmtDur(set.restSec) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {laps.length > 2 && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">整场连贯曲线</h3>
            <p className="card-sub">
              这张图回答的问题是：<strong>整场跑下来，状态是怎么变化的？</strong>
              手表常把间歇、放松、拉伸拆成多条记录，单看每条只看到片段；这里把它们并到同一条
              <strong>累计时间轴</strong>（含组间休息）上，配速起伏、心率漂移、组与组之间歇了多久，一眼可见。
              短于 900m 的分段不参与配速线，所以配速线常比心率线短。
            </p>
            <LineChart
              labels={chartLabels}
              xValues={chartX}
              xFmt={(n) => `${Math.floor(n / 60)}′${String(Math.round(n % 60)).padStart(2, "0")}″`}
              series={[
                { key: "pace", label: "配速（左轴）", color: "var(--chart-accent)", values: paceSeries },
                { key: "hr", label: "平均心率（右轴）", color: "var(--chart-hr)", axis: "right", values: hrSeries },
              ]}
              yFmt={fmtPace}
              yFmtRight={(n) => String(Math.round(n))}
              yInvert
              height={230}
              fill={false}
            />
          </div>

          <AerobicDecouplingCard
            laps={laps}
            options={{
              distanceKm: s.totals.distanceKm,
              durationSec: s.totals.durationSec,
              isInterval: s.classification === "间歇训练" || s.sets.length > 0,
              isCombo:
                s.classification === "组合训练" ||
                s.classification === "多次短距离" ||
                activities.some((a) => a.sportType != null && ![100, 102, 103, 104].includes(a.sportType)),
            }}
          />

          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="card">
              <h3 className="card-title">心率区间分布</h3>
              <p className="card-sub">把整场所有分段合并后计算</p>
              <div style={{ marginTop: 16 }}>
                <ZoneBar
                  zones={zones.zones.map((z) => ({ ...z, color: z.zone.toLowerCase() }))}
                  basis={zones}
                />
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">逐条记录</h3>
              <p className="card-sub">点单条可进入该条独立的分圈明细</p>
              <div className="table-scroll-wrap">
                <div className="table-scroll" style={{ maxHeight: 320, overflow: "auto" }}>
                  <table>
                    <thead>
                      <tr><th>开始</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th><th>步频</th><th>负荷</th></tr>
                    </thead>
                    <tbody>
                      {activities.map((a) => (
                        <tr key={a.labelId} className="clickable" onClick={() => onOpenActivity?.(a.labelId, sessionKey)}>
                          <td>{a.startTs ? new Date(a.startTs * 1000).toTimeString().slice(0, 5) : "—"}</td>
                          <td className="num">{a.distanceKm}</td>
                          <td className="num">{fmtDur(a.durationSec)}</td>
                          <td className="num">{fmtPace(a.avgPaceSec)}</td>
                          <td className="num">{a.avgHr ?? "—"}</td>
                          <td className="num">{a.detail?.avgCadence ?? "—"}</td>
                          <td className="num">{a.detail?.trainingLoad ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {laps.length > 2 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">全场分段明细</h3>
          <p className="card-sub">按累计时间排序，休息段不会出现数据点</p>
          <div className="table-scroll-wrap">
            <div className="table-scroll" style={{ maxHeight: 380, overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>累计时间</th><th>段</th><th>距离</th><th>配速</th>
                    <th>心率</th><th>最大</th><th>步频</th><th>步幅</th>
                    <th>爬升</th>
                  </tr>
                </thead>
                <tbody>
                  {laps.map((l) => (
                    <tr key={`${l.labelId}-${l.lapIndex}`}>
                      <td className="num" style={{ color: "var(--text-faint)" }}>{fmtDur(l.elapsedSec)}</td>
                      <td>{l.lapIndex}</td>
                      <td className="num">{(l.distanceM / 1000).toFixed(2)}</td>
                      <td className="num" style={{ color: paceColor(l.avgPaceSec, 270, 330) }}>{fmtPace(l.avgPaceSec)}</td>
                      <td className="num">{l.avgHr || "—"}</td>
                      <td className="num" style={{ color: "var(--text-faint)" }}>{l.maxHr || "—"}</td>
                      <td className="num">{l.avgCadence || "—"}</td>
                      <td className="num">{l.avgStrideM ? l.avgStrideM.toFixed(2) : "—"}</td>
                      <td className="num">{l.elevGain != null ? Math.round(l.elevGain) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">AI 场次分析</h3>
        <p className="card-sub">
          把这 {s.activityCount} 条记录作为<strong>一整场</strong>送进模型，而不是逐条点评。
          {multi && " 间歇训练会被当成一组整体结构来解读。"}
        </p>

        {!aiConfigured && (
          <div className="banner info">还没有配置 AI 模型，请到「设置」页填写模型地址、API Key 和模型名。</div>
        )}
        {aiErr && <div className="banner error">{aiErr}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14, minWidth: 0, width: "100%" }}>
          <input
            style={{ flex: 1, minWidth: 0 }}
            placeholder={multi ? "关注点（可选），例如：400m 组掉速，是不是组间休息不够？" : "关注点（可选），例如：这次长距离后程掉速，是不是强度太高了？"}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && aiConfigured && !busy) runAnalyze(); }}
          />
          <button className="btn primary" style={{ flexShrink: 0, whiteSpace: "nowrap" }} disabled={!aiConfigured || busy} onClick={runAnalyze}>
            {busy ? <><span className="spin" /> 分析中…</> : reports.length > 0 ? "重新分析" : "开始分析"}
          </button>
        </div>

        {reports.length === 0 ? (
          <div className="empty">还没有分析记录</div>
        ) : (
          reports.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                <span className="pill accent">{r.model}</span>
                <span className="hint">{new Date(r.createdAt * 1000).toLocaleString("zh-CN")}</span>
                <span className="pill">{r.activityCount} 条记录</span>
                {r.focus && <span className="pill">关注：{r.focus}</span>}
              </div>
              <Markdown text={r.report} />
            </div>
          ))
        )}
      </div>
    </>
  );
}
