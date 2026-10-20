import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const fmtPace = (sec: number | null | undefined) => {
  if (sec == null || !Number.isFinite(sec)) return "—";
  // 先四舍五入秒，再处理进位，否则 299.6s 会显示成非法的 "4:60"
  let m = Math.floor(sec / 60);
  let s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const fmtDur = (sec: number | null | undefined) => {
  if (sec == null || !Number.isFinite(sec)) return "—";
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  if (m === 60) { h += 1; m = 0; }
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

export const fmtDate = (d: string) => (d ? d.slice(5) : "—");

/** 与服务端 prediction/engine.ts 同名的别名，方便对照阅读 */
export const fmtT = fmtDur;
export const fmtP = fmtPace;

/**
 * 配速 → 颜色：越快越偏青，越慢越偏红。
 * 用 color-mix() 而不是算好的 rgb()，这样端点色跟随主题变量自动切换。
 */
export const paceColor = (sec: number, fast: number, slow: number) => {
  if (!Number.isFinite(sec) || slow === fast) return "var(--text-faint)";
  const t = Math.max(0, Math.min(1, (sec - fast) / (slow - fast)));
  return `color-mix(in oklab, var(--pace-fast) ${((1 - t) * 100).toFixed(1)}%, var(--pace-slow))`;
};

/** 散点/渐变用的双色混合，同样交给 CSS 做，保证换肤一致 */
export const mixColor = (t: number, from: string, to: string) =>
  `color-mix(in oklab, ${from} ${((1 - t) * 100).toFixed(1)}%, ${to})`;

// ---------- 容器宽度自适应 ----------
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ---------- tooltip ----------
type TipState = { x: number; y: number; node: ReactNode } | null;

export function useChartTooltip() {
  const [tip, setTip] = useState<TipState>(null);
  const show = (e: { clientX: number; clientY: number }, node: ReactNode) =>
    setTip({ x: e.clientX, y: e.clientY, node });
  const hide = () => setTip(null);
  const el = tip ? (
    <TooltipBox tip={tip} onClose={hide} />
  ) : null;
  return { show, hide, el };
}

/**
 * tooltip 跟着指针走，但它自己是 fixed 定位 —— 宽屏上放在指针右下角很自然，
 * 窄屏上「刚好点在图表右上角」就会有一半跑到屏幕外，看起来像没弹出来。
 * 这里按可视区把位置夹回来，并且点一下就关掉：手指没有「离开」这个动作，
 * 不主动收的话 tooltip 会一直挂在屏幕上。
 */
function TooltipBox({ tip, onClose }: { tip: NonNullable<TipState>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 首次渲染拿不到自己的尺寸（还没量出来），先不定位，量完再摆，
  // 否则第一帧会用估算值闪一下位置
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const M = 10, GAP = 12;
    let left = tip.x + GAP;
    let top = tip.y + GAP;
    if (left + r.width > innerWidth - M) left = tip.x - GAP - r.width; // 右边放不下就翻到左侧
    if (left < M) left = M;
    if (top + r.height > innerHeight - M) top = tip.y - GAP - r.height; // 下方放不下就翻到上方
    if (top < M) top = M;
    setPos({ left, top });
  }, [tip.x, tip.y, tip.node]);

  return (
    <div ref={ref} className="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
      <div onPointerDown={(e) => { e.stopPropagation(); onClose(); }}>{tip.node}</div>
    </div>
  );
}

const TipRows = ({ title, rows }: { title: string; rows: [string, string][] }) => (
  <>
    <div className="t-title">{title}</div>
    {rows.map(([k, v]) => (
      <div className="t-row" key={k}>
        <span style={{ color: "var(--text-dim)" }}>{k}</span>
        <span className="num">{v}</span>
      </div>
    ))}
  </>
);

// ---------- 轴刻度 ----------

/**
 * 轴刻度：步长取 1/2/5 × 10^k 这类整齐值（读数是 0/20/40，而不是把区间
 * 三等分得到的 0/14.57/29.1），刻度全部落在 [lo, hi] 内。
 *
 * 有两条约束会打架，所以这里从小步长到大步长扫一遍候选，取「格式化后文字
 * 互不重复、且条数最接近 count」的那一档：
 *   步长太细 → 0.5 和 1 都被 Math.round 成 "1"，两个标签会叠在一起；
 *   步长太粗 → 区间起点不在整数倍上时只剩两个端点，网格线全挤在顶部。
 * 由粗到细遍历，条数一样接近时保留更粗的那档，读数更干净。
 */
function axisTicks(
  lo: number, hi: number, fmt: (n: number) => string, count = 4,
): { v: number; label: string }[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [{ v: lo, label: fmt(lo) }];

  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // 阈值取 1.5/3/7 而不是 1/2/5：后者在 norm≈2.3 这种边界上会直接跳到
  // 下一档，把 0–70 压成只剩 0/50 两个刻度。
  const base = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;

  let best: { v: number; label: string }[] | null = null;
  for (const step of [base * 4, base * 2, base, base / 2, base / 4]) {
    const vs = ticksWithStep(lo, hi, step);
    if (vs.length < 2) continue;
    const labels = vs.map(fmt);
    if (new Set(labels).size !== labels.length) continue;
    if (!best || Math.abs(vs.length - count) < Math.abs(best.length - count)) {
      best = vs.map((v, i) => ({ v, label: labels[i] ?? "" }));
    }
  }
  // 一档都不合格时退回首尾两点（极端窄区间，例如整段数据只有一个值）
  return best ?? [{ v: lo, label: fmt(lo) }, { v: hi, label: fmt(hi) }];
}

/** 取 [lo, hi] 内所有 step 的整数倍。 */
function ticksWithStep(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; ; i++) {
    const v = Math.ceil(lo / step - 1e-9) * step + i * step;
    if (v > hi + step * 1e-9) break;
    // 累加会漂（0.1+0.2 → 0.30000000000000004），按精度截一下
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

// ---------- 柱状图（可叠加第二条指标曲线）----------
export type BarDatum = { label: string; value: number; extra?: number; tip?: [string, string][] };

export function BarChart({
  data, height = 190, color = "var(--chart-accent)", overlayColor, overlayLabel, valueFmt = (n: number) => String(Math.round(n * 10) / 10),
  onSelect, selectedIndex,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  overlayColor?: string;
  overlayLabel?: string;
  valueFmt?: (n: number) => string;
  onSelect?: (i: number) => void;
  selectedIndex?: number | null;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useChartTooltip();
  // 有叠加曲线时右边要放它的刻度，先让出右边距
  const padL = 34, padR = overlayColor ? 38 : 10, padT = 12, padB = 22;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;

  const maxV = Math.max(...data.map((d) => d.value), 1);
  const maxO = Math.max(...data.map((d) => d.extra ?? 0), 1);
  const bw = iw / Math.max(data.length, 1);
  const barW = Math.min(bw * 0.62, 34);

  const y = (v: number, max: number) => padT + ih - (v / max) * ih;
  const ticks = axisTicks(0, maxV, (n) => String(Math.round(n)), 4);
  // 叠加曲线走的是自己的量纲（例如心率），以前只有 legend 没有刻度，
  // 绝对数值读不出来 —— 这里给它补一条右轴，颜色与曲线、legend 一致。
  const oTicks = overlayColor ? axisTicks(0, maxO, (n) => String(Math.round(n)), 4) : [];

  const overlayPts = data
    .map((d, i) => `${padL + bw * i + bw / 2},${y(d.extra ?? 0, maxO)}`)
    .join(" ");

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart-svg" height={height} role="img">
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid-line" x1={padL} x2={w - padR} y1={y(t.v, maxV)} y2={y(t.v, maxV)} />
            {/* 只有两条量纲并存时才给刻度上色，否则纯属噪点 */}
            <text
              className="axis-label" x={padL - 6} y={y(t.v, maxV) + 3} textAnchor="end"
              fill={overlayColor ? color : undefined}
            >
              {t.label}
            </text>
          </g>
        ))}
        {oTicks.map((t, i) => (
          <text
            key={`o${i}`} className="axis-label" x={w - padR + 6} y={y(t.v, maxO) + 3}
            textAnchor="start" fill={overlayColor}
          >
            {t.label}
          </text>
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.value / maxV) * ih, d.value > 0 ? 2 : 0);
          const x = padL + bw * i + (bw - barW) / 2;
          return (
            <g key={i}>
              {/* 不选中时保持不透明，柱子颜色与 legend 色块完全一致（以前是 0.82，对不上） */}
              <rect
                x={x} y={padT + ih - h} width={barW} height={h}
                rx={3}
                fill={color}
                opacity={selectedIndex == null || selectedIndex === i ? 1 : 0.3}
                style={{ cursor: onSelect ? "pointer" : "default" }}
                onPointerMove={(e) => tip.show(e, <TipRows title={d.label} rows={[[valueFmt(d.value), d.tip?.[0]?.[1] ?? ""], ...(d.tip?.slice(1) ?? [])].filter((r) => r[1] !== "") as [string, string][]} />)}
                onPointerLeave={tip.hide}
                onClick={() => onSelect?.(i)}
              />
              {bw > 26 && (
                <text className="axis-label" x={padL + bw * i + bw / 2} y={height - 6} textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        {overlayColor && (
          <>
            <polyline points={overlayPts} fill="none" stroke={overlayColor} strokeWidth={1.8} strokeLinejoin="round" />
            {data.map((d, i) => (
              <circle key={i} cx={padL + bw * i + bw / 2} cy={y(d.extra ?? 0, maxO)} r={2.6} fill={overlayColor} />
            ))}
          </>
        )}
        <line className="axis-line" x1={padL} x2={w - padR} y1={padT + ih} y2={padT + ih} />
      </svg>
      {overlayColor && (
        <div className="legend">
          <div className="legend-item"><span className="legend-swatch" style={{ background: color }} />主指标</div>
          <div className="legend-item"><span className="legend-swatch" style={{ background: overlayColor }} />{overlayLabel}</div>
        </div>
      )}
      {tip.el}
    </div>
  );
}

// ---------- 折线图（多序列 + 面积）----------
export type Series = { key: string; label: string; color: string; values: (number | null)[]; axis?: "right" };

export function LineChart({
  labels, series, height = 200, yFmt = (n: number) => String(Math.round(n)), yFmtRight, bands, yMin, yMax, fill = true,
  xValues, xFmt, xTickEvery, yInvert = false,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  yFmt?: (n: number) => string;
  yFmtRight?: (n: number) => string;
  /** 背景参考带，例如心率区间的着色 */
  bands?: { from: number; to: number; color: string }[];
  yMin?: number;
  yMax?: number;
  fill?: boolean;
  /**
   * 左轴翻转：值小的在上。
   *
   * 专给配速轴用。默认映射是「值大在上」，对配速就成了「慢的在上、快的在下」，
   * 与跑步圈的惯例（Strava / Garmin 都是越快越高）相反；而且配速图基本都配一条
   * 右轴心率，翻转之后两条线统一成「往上 = 更用力」，读图只需要一个方向。
   * 只影响左轴 —— 右轴（心率/负荷）保持原样。
   */
  yInvert?: boolean;
  /**
   * 按数值定位横轴（例如训练次详情里的「累计秒」）。
   * 不传时按索引等距排布。传入后 labels 仅用于 tooltip 标题。
   */
  xValues?: number[];
  xFmt?: (n: number) => string;
  xTickEvery?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useChartTooltip();
  const hasRight = series.some((s) => s.axis === "right");
  // 某一侧只有一条线时，把该侧刻度染成线的颜色。双轴图里光看刻度数字
  // 分不清哪边属于哪条线，尤其是通道图那种「左轴配速、右轴心率」。
  const leftSeries = series.filter((s) => s.axis !== "right");
  const rightSeries = series.filter((s) => s.axis === "right");
  const leftTickColor = leftSeries.length === 1 ? leftSeries[0]?.color : undefined;
  const rightTickColor = rightSeries.length === 1 ? rightSeries[0]?.color : undefined;
  const padL = 34, padR = hasRight ? 38 : 10, padT = 12, padB = 22;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const n = Math.max(labels.length, 1);

  const leftVals = series.filter((s) => s.axis !== "right").flatMap((s) => s.values.filter((v): v is number => v != null));
  const rightVals = series.filter((s) => s.axis === "right").flatMap((s) => s.values.filter((v): v is number => v != null));
  if (leftVals.length === 0 && rightVals.length === 0) return <div className="chart-wrap" ref={ref} style={{ height }} />;

  const rangeOf = (vals: number[], min?: number, max?: number) => {
    const lo = min ?? Math.min(...vals);
    const hi = max ?? Math.max(...vals);
    return { lo, hi, span: hi - lo || 1 };
  };
  const L = rangeOf(leftVals.length ? leftVals : [0, 1], yMin, yMax);
  const R = rangeOf(rightVals.length ? rightVals : [0, 1]);
  const lTicks = axisTicks(L.lo, L.hi, yFmt, 4);
  const rTicks = hasRight ? axisTicks(R.lo, R.hi, yFmtRight ?? yFmt, 4) : [];

  // 横轴：给定 xValues 时按数值缩放，否则按索引等距
  const X = useMemo(() => {
    if (!xValues || xValues.length === 0) return null;
    const lo = Math.min(...xValues), hi = Math.max(...xValues);
    return { lo, span: hi - lo || 1 };
  }, [xValues]);

  const x = (i: number) => {
    if (X && xValues) return padL + ((xValues[i] - X.lo) / X.span) * iw;
    return padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  };
  const yFor = (s: Series, v: number) => {
    const r = s.axis === "right" ? R : L;
    const t = (v - r.lo) / r.span;
    return padT + (yInvert && s.axis !== "right" ? t : 1 - t) * ih;
  };
  const y = (v: number) => {
    const t = (v - L.lo) / L.span;
    return padT + (yInvert ? t : 1 - t) * ih;
  };
  const bottom = padT + ih;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart-svg" height={height} role="img">
        {bands?.map((b, bi) => (
          <rect key={bi} x={padL} y={y(Math.min(Math.max(b.to, L.lo), L.hi))} width={iw}
            height={Math.abs(y(Math.min(Math.max(b.from, L.lo), L.hi)) - y(Math.min(Math.max(b.to, L.lo), L.hi)))}
            fill={b.color} opacity={0.1} />
        ))}

        {lTicks.map((t, i) => (
          <g key={`l${i}`}>
            <line className="grid-line" x1={padL} x2={padL + iw} y1={y(t.v)} y2={y(t.v)} />
            <text className="axis-label" x={padL - 6} y={y(t.v) + 3} textAnchor="end" fill={leftTickColor}>
              {t.label}
            </text>
          </g>
        ))}
        {rTicks.map((t, i) => (
          <text key={`r${i}`} className="axis-label" x={padL + iw + 6} y={padT + ih - ((t.v - R.lo) / R.span) * ih + 3} textAnchor="start" fill={rightTickColor}>
            {t.label}
          </text>
        ))}

        {series.map((s) => {
          // 连续的非空点各自成段。null 必须真的把线切断 —— 若只是跳过该点再首尾相连，
          // 就会跨过空档画出一条「数据并不存在」的假线（例如两条记录之间的休息段）。
          const runs: { i: number; v: number }[][] = [];
          for (let i = 0; i < s.values.length; i++) {
            const v = s.values[i];
            if (v == null) {
              if (runs.length && runs[runs.length - 1].length) runs.push([]);
            } else {
              if (!runs.length) runs.push([]);
              runs[runs.length - 1].push({ i, v });
            }
          }
          const segs = runs.filter((r) => r.length > 0);
          if (segs.length === 0) return null;
          const ptsOf = (r: { i: number; v: number }[]) => r.map((p) => `${x(p.i)},${yFor(s, p.v)}`).join(" ");
          return (
            <g key={s.key}>
              {/* 面积填充的语义是「线以下到基线」，只在常规方向下成立。翻转后它会变成
                  一整块「比这条线更慢的配速」的色带，盖住大半个图，是错的 —— 所以不画。 */}
              {fill && !yInvert && s.axis !== "right" && segs.map((r, ri) => (
                <polygon
                  key={`f${ri}`}
                  points={`${ptsOf(r)} ${x(r[r.length - 1].i)},${bottom} ${x(r[0].i)},${bottom}`}
                  fill={s.color} opacity={0.07}
                />
              ))}
              {segs.map((r, ri) => (
                <polyline
                  key={`p${ri}`} points={ptsOf(r)} fill="none"
                  stroke={s.color} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round"
                />
              ))}
              {s.values.map((v, i) => v == null ? null : (
                <circle key={i} cx={x(i)} cy={yFor(s, v)} r={s.values.length > 40 ? 0 : 2.4} fill={s.color}>
                  <title>{`${labels[i]} ${s.label} ${(yFmtRight ?? yFmt)(v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* 透明热区：hover 显示所有序列在该点的值 */}
        {labels.map((l, i) => (
          <rect
            key={i} x={padL + (i / n) * iw - iw / n / 2} y={padT} width={iw / n} height={ih} fill="transparent"
            onPointerMove={(e) => tip.show(e, (
              <TipRows title={l} rows={series.map((s) => [s.label, s.values[i] == null ? "—" : (s.axis === "right" ? yFmtRight ?? yFmt : yFmt)(s.values[i] as number)] as [string, string])} />
            ))}
            onPointerLeave={tip.hide}
          />
        ))}

        {tickIndexes(n, iw).map((i) => (
          <text
            key={i}
            className="axis-label"
            x={x(i)}
            y={height - 6}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {X && xValues && xFmt ? xFmt(xValues[i]) : String(labels[i]).slice(5)}
          </text>
        ))}
        <line className="axis-line" x1={padL} x2={padL + iw} y1={bottom} y2={bottom} />
      </svg>
      <div className="legend">
        {series.map((s) => (
          <div className="legend-item" key={s.key}>
            <span className="legend-swatch" style={{ background: s.color }} />{s.label}
          </div>
        ))}
      </div>
      {tip.el}
    </div>
  );
}

/**
 * 横轴刻度下标。
 *
 * 刻度密度必须跟着「可用像素宽」走，不能只看数据点数：
 * 90 个点画在 1600px 和 350px（手机）上，标签要留的物理间距是同一个 50px，
 * 但每点分到多少像素差了 4 倍多。只按点数定档时，手机上会出现
 * 「10-10」和「10-19」两个标签叠在一起糊成一团。
 */
function tickIndexes(n: number, innerW: number): number[] {
  if (n <= 1) return [0];
  // 标签形如 "09-14"，10px 字号下约 32px 宽，留 50px 间距才不会挤
  const maxByWidth = Math.max(2, Math.floor(innerW / 50) + 1);
  const count = Math.min(8, maxByWidth, Math.max(2, Math.round(n / 6)));
  const step = Math.max(1, Math.floor((n - 1) / (count - 1)));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  const last = out[out.length - 1];
  // 补末刻度前先看够不够远，否则会出现「10-020-0」这种两个标签叠在一起
  if (n - 1 - last >= Math.ceil(step / 2)) out.push(n - 1);
  else out[out.length - 1] = n - 1;
  return out;
}

// ---------- 散点图（配速 vs 心率）----------
export function ScatterPlot({
  points, height = 260, xLabel, yLabel, xFmt, yFmt, colorBy = "y", invertColor = false,
}: {
  points: { x: number; y: number; label: string; tip: [string, string][] }[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xFmt: (n: number) => string;
  yFmt: (n: number) => string;
  colorBy?: "x" | "y";
  invertColor?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useChartTooltip();
  const padL = 38, padR = 14, padT = 14, padB = 30;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  if (points.length === 0) return <div className="chart-wrap" ref={ref} style={{ height }} />;

  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xlo = Math.min(...xs), xhi = Math.max(...xs);
  const ylo = Math.min(...ys), yhi = Math.max(...ys);
  const padX = (xhi - xlo) * 0.08 || 1, padY = (yhi - ylo) * 0.12 || 1;
  const x = (v: number) => padL + ((v - xlo + padX) / (xhi - xlo + padX * 2 || 1)) * iw;
  const y = (v: number) => padT + ih - ((v - ylo + padY) / (yhi - ylo + padY * 2 || 1)) * ih;

  const valLo = colorBy === "x" ? xlo : ylo;
  const valHi = colorBy === "x" ? xhi : yhi;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart-svg" height={height} role="img">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={w - padR} y1={padT + ih * t} y2={padT + ih * t} />
            <line className="grid-line" x1={padL + iw * t} x2={padL + iw * t} y1={padT} y2={padT + ih} />
          </g>
        ))}
        {points.map((p, i) => {
          const v = colorBy === "x" ? p.x : p.y;
          const t = (v - valLo) / (valHi - valLo || 1);
          const c = colorBy === "x"
            ? mixColor(t, "var(--pace-fast)", "var(--pace-slow)")
            : mixColor(t, "var(--pace-slow)", "var(--pace-fast)");
          return (
            <circle
              key={i} cx={x(p.x)} cy={y(p.y)} r={5} fill={c} opacity={0.85}
              stroke="var(--bg)" strokeWidth={1.5}
              onPointerMove={(e) => tip.show(e, <TipRows title={p.label} rows={p.tip} />)}
              onPointerLeave={tip.hide}
            />
          );
        })}
        <text className="axis-label" x={padL + iw / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
        <text className="axis-label" x={10} y={padT + ih / 2} textAnchor="middle" transform={`rotate(-90 10 ${padT + ih / 2})`}>{yLabel}</text>
        <line className="axis-line" x1={padL} x2={w - padR} y1={padT + ih} y2={padT + ih} />
        <line className="axis-line" x1={padL} x2={padL} y1={padT} y2={padT + ih} />
      </svg>
      {tip.el}
    </div>
  );
}

// ---------- 配速-心率残差（发散条形图）----------
/**
 * 为什么用残差而不是散点：
 * 散点要求读者自己在脑子里做「找趋势线 → 估偏差」两步，且图上不画趋势线时无从读起。
 * 残差把这个减法算完了直接画成条：零线以上 = 心率比这个配速该有的高（靠心率硬顶），
 * 零线以下 = 心率比该有的低（身体有余量）。横轴按段序而非配速，保住时间顺序，
 * 于是「越到后面越往下」这种后程衰减能一眼看出来。
 */
export type ResidualRow = {
  label: string;
  /** 该段实际配速（秒/km），仅用于 tooltip 与副标题，不参与定位 */
  residual: number;
  tip: [string, string][];
};

export function paceHrResidual(rows: ResidualRow[], height = 240) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const tip = useChartTooltip();
  const padL = 40, padR = 12;
  // 留出上下各 12px 给「顶格」那根条的数值标签，否则最长条的标签会掉到轴外
  const padT = 26, padB = 30;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  if (rows.length === 0) return <div className="chart-wrap" ref={ref} style={{ height }} />;

  // 零线居中，上下等距，量纲只有 bpm 所以不需要另开右轴
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.residual)), 1);
  const n = rows.length;
  const slot = iw / Math.max(n, 1);
  const barW = Math.min(slot * 0.56, 30);
  const zero = padT + ih / 2;
  const yFor = (v: number) => zero - (v / maxAbs) * (ih / 2);
  // 段数多时横轴每 2 段一标，避免窄容器里标签挤成一团
  const xStep = slot < 26 ? 2 : 1;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg className="chart-svg" height={height} role="img">
        {/* 参考线：±maxAbs 的上下界 + 零线 */}
        {[-maxAbs, -maxAbs / 2, maxAbs / 2, maxAbs].map((t, i) => (
          <g key={i}>
            <line className="grid-line" x1={padL} x2={padL + iw} y1={yFor(t)} y2={yFor(t)} />
            <text className="axis-label" x={padL - 6} y={yFor(t) + 3} textAnchor="end">
              {t > 0 ? `+${Math.round(t)}` : Math.round(t)}
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          const up = r.residual >= 0;
          const cx = padL + slot * i + slot / 2;
          const top = up ? yFor(r.residual) : zero;
          const h = Math.max(Math.abs(yFor(r.residual) - zero), 1.5);
          const fill = up ? "var(--chart-bad)" : "var(--chart-good)";
          return (
            <g key={i}>
              <rect
                x={cx - barW / 2} y={top} width={barW} height={h} rx={2.5}
                fill={fill} opacity={1}
                onPointerMove={(e) => tip.show(e, <TipRows title={r.label} rows={r.tip} />)}
                onPointerLeave={tip.hide}
              />
              {/* 条数不多时直接把数值标出来，不用 hover 也能读 */}
              {n <= 14 && (
                <text
                  className="axis-label" x={cx}
                  y={up ? top - 5 : top + h + 11}
                  textAnchor="middle"
                  fill={fill}
                >
                  {up ? `+${Math.round(r.residual)}` : Math.round(r.residual)}
                </text>
              )}
            </g>
          );
        })}

        <line className="axis-line" x1={padL} x2={padL + iw} y1={zero} y2={zero} />
        {/* 条形是等距分槽，横轴标签按槽位列全标；折线用的 tickIndexes 会退化成只标首尾 */}
        {rows.map((r, i) => (
          i % xStep === 0 || i === n - 1 ? (
            <text
              key={i} className="axis-label"
              x={padL + slot * i + slot / 2}
              y={height - 8}
              textAnchor="middle"
            >
              {r.label.replace(/^第\s*/, "").replace(/\s*段$/, "")}
            </text>
          ) : null
        ))}
      </svg>
      <div className="legend">
        <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--chart-bad)" }} />心率高于该配速应有值（硬顶）</div>
        <div className="legend-item"><span className="legend-swatch" style={{ background: "var(--chart-good)" }} />心率低于该配速应有值（有余量）</div>
      </div>
      {tip.el}
    </div>
  );
}

/**
 * 配速与心率的最小二乘拟合 + Pearson r。
 * 配速的秒数越大代表越慢，所以耦合良好时 r 应为负（慢 → 心率低）。
 * 返回 null 表示点太少或配速无变化，不足以拟合。
 */
export function paceHrCoupling(
  rows: { paceSec: number; hr: number }[],
): { r: number; slope: number } | null {
  const pts = rows.filter((p) => Number.isFinite(p.paceSec) && Number.isFinite(p.hr));
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.paceSec, 0) / n;
  const my = pts.reduce((s, p) => s + p.hr, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) {
    const dx = p.paceSec - mx, dy = p.hr - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx };
}

/** 按拟合结果算残差：实际心率 − 该配速的预测心率 */
export function hrResiduals(
  rows: { paceSec: number; hr: number }[],
  fit: { slope: number },
) {
  const my = rows.reduce((s, p) => s + p.hr, 0) / rows.length;
  const mx = rows.reduce((s, p) => s + p.paceSec, 0) / rows.length;
  return rows.map((p) => p.hr - (my + fit.slope * (p.paceSec - mx)));
}

/** r 的绝对值分档，用于给一句人话结论 */
export function couplingVerdict(r: number) {
  const a = Math.abs(r);
  if (a < 0.3) return { level: "none" as const, text: "本次配速与心率没有明显关系" };
  if (a < 0.6) return { level: "weak" as const, text: "配速与心率关系较弱，参考价值有限" };
  return { level: "strong" as const, text: r < 0 ? "耦合良好：跑得慢心率就降" : "耦合良好：跑得快心率就升" };
}

// ---------- 心率区间条 ----------
export type ZoneInput = {
  zone: string; label: string; seconds: number; pct: number; color: string;
  hrLo?: number; hrHi?: number; pctLabel?: string;
};

export type ZoneBasis = {
  basis: number;
  maxHr?: number;
  restingHr?: number;
  reserve?: number;
  source?: string;
  method?: string;
  usedFallback?: boolean;
  belowZone1Seconds?: number;
  belowZone1Pct?: number;
};

export function ZoneBar({ zones, basis }: { zones: ZoneInput[]; basis: number | ZoneBasis }) {
  const total = zones.reduce((s, z) => s + z.seconds, 0) || 1;
  const b: ZoneBasis = typeof basis === "number" ? { basis } : basis;
  const hasHrRange = zones.some((z) => z.hrLo != null);
  const belowPct = b.belowZone1Pct ?? 0;

  return (
    <div>
      <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", gap: 1 }}>
        {/* 低于 Z1 下界（热身/走路）用灰色占位，避免百分比看起来对不上 */}
        {belowPct > 0 && (
          <div
            title={`区间外（< ${zones[0]?.hrLo ?? 136} bpm，热身/恢复）— ${belowPct}%`}
            style={{
              width: `${belowPct}%`,
              background: "var(--chart-muted)",
              opacity: 0.35,
              transition: "opacity .15s",
            }}
          />
        )}
        {zones.map((z) => (
          <div
            key={z.zone}
            title={`${z.zone} ${z.label}${z.hrLo ? ` ${z.hrLo}–${z.hrHi} bpm（${z.pctLabel ?? ""}）` : ""} — ${fmtDur(z.seconds)} (${z.pct}%)`}
            style={{
              width: `${(z.seconds / total) * 100}%`,
              background: `var(--chart-${z.zone.toLowerCase()})`,
              opacity: z.seconds > 0 ? 1 : 0.12,
              transition: "opacity .15s",
            }}
          />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {zones.map((z) => (
          <div className="legend-item" key={z.zone} style={{ opacity: z.seconds > 0 ? 1 : 0.4 }}>
            <span className="legend-swatch" style={{ background: `var(--chart-${z.zone.toLowerCase()})` }} />
            {z.zone} {z.label}
            {hasHrRange && z.hrLo != null && (
              <span className="num" style={{ color: "var(--text-faint)", fontSize: 11 }}>
                {z.hrLo}–{z.hrHi}{z.pctLabel ? ` (${z.pctLabel})` : ""}
              </span>
            )}
            <span className="num" style={{ color: "var(--text-faint)" }}>{z.pct}%</span>
          </div>
        ))}
        {belowPct > 0 && (
          <div className="legend-item" style={{ opacity: 0.7 }}>
            <span className="legend-swatch" style={{ background: "var(--chart-muted)", opacity: 0.35 }} />
            热身/恢复
            <span className="num" style={{ color: "var(--text-faint)", fontSize: 11 }}>
              &lt; {zones[0]?.hrLo ?? 136}
            </span>
            <span className="num" style={{ color: "var(--text-faint)" }}>{belowPct}%</span>
          </div>
        )}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        按<strong>五区间心率法</strong>划分（绝对心率判定）
        {b.restingHr ? `，最大心率 ${b.maxHr ?? b.basis} bpm − 静息 ${b.restingHr} bpm = 储备 ${b.reserve} bpm` : ""}。
        括号内百分比是对应的 HRR 占比。COROS 未提供分区字段，此处为自算。
      </div>
    </div>
  );
}

// ---------- Markdown 渲染（极简，覆盖 AI 报告常用语法）----------

/**
 * 拆一行 Markdown 表格行：`| a | b |` → ["a","b"]
 * 首尾的竖线是可选的，中间连续空单元格要保留（`| a || b |` 的中间是空值，不是缺列）。
 */
function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

/** 判断是不是表格分隔行：`|---|---|`、`| :-- | --: |` */
function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  let para: string[] = [];

  const flushList = (key: string) => {
    if (list.length === 0) return;
    blocks.push(<ul key={key}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  const flushPara = (key: string) => {
    if (para.length === 0) return;
    blocks.push(<p key={key}>{inline(para.join(" "))}</p>);
    para = [];
  };

  // 用 while 而不是 forEach：表格一行要连带吃掉分隔行和整个表体，
  // forEach 无法跳段，只能靠副作用改 lines，太脆。
  let i = 0;
  while (i < lines.length) {
    // 用 while + 索引取行，TS 的 noUncheckedIndexedAccess 会把 lines[i] 看成可能 undefined
    const t = (lines[i] ?? "").trim();

    // 表格：当前行是 `|...|`，且下一行是分隔行，才算一张表的表头。
    // 之前没有表格分支，表格行会掉进段落分支被 join(" ") 压成一行长文本。
    const next = lines[i + 1]?.trim() ?? "";
    if (/^\s*\|/.test(t) && isTableSep(next)) {
      flushList(`l${i}`); flushPara(`p${i}`);
      const header = splitRow(t);
      const aligns = splitRow(next).map((c): React.CSSProperties["textAlign"] =>
        c.endsWith(":") && c.startsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
      );
      // 从分隔行往下把所有 `|...|` 行收进表体，遇到空行或非表格行就停
      const body: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const b = lines[j].trim();
        if (!b.startsWith("|")) break;
        body.push(splitRow(b));
      }
      blocks.push(
        <div className="table-wrap" key={`tb${i}`}>
          <table>
            <thead>
              <tr>
                {header.map((h, c) => (
                  <th key={c} style={{ textAlign: aligns[c] ?? "left" }}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td key={c} style={{ textAlign: aligns[c] ?? "left" }}>{inline(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      // 整段跳过（含分隔行），交给外层 while 继续
      i = j;
      continue;
    }

    if (/^#{1,4}\s/.test(t)) {
      flushList(`l${i}`); flushPara(`p${i}`);
      const level = t.match(/^#+/)?.[0].length ?? 1;
      const content = t.replace(/^#+\s*/, "");
      if (level <= 2) blocks.push(<h2 key={i}>{inline(content)}</h2>);
      else blocks.push(<h3 key={i}>{inline(content)}</h3>);
    } else if (/^[-*]\s/.test(t)) {
      flushPara(`p${i}`);
      list.push(t.replace(/^[-*]\s/, ""));
    } else if (/^\d+\.\s/.test(t)) {
      flushPara(`p${i}`);
      list.push(t.replace(/^\d+\.\s/, ""));
    } else if (t === "") {
      flushList(`l${i}`); flushPara(`p${i}`);
    } else {
      flushList(`l${i}`);
      para.push(t);
    }
    i++;
  }
  flushList("lEnd"); flushPara("pEnd");

  return <div className="report">{blocks}</div>;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}
