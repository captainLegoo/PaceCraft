/**
 * 线性图标集。统一 1.6 描边、currentColor 填充，
 * 所以换主题时不需要任何额外处理。
 */

type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/** 跑步的人 —— 品牌主图形 */
export function IconRun({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="15.5" cy="4.2" r="2" />
      <path d="M13.2 8.2 9.6 10.4l1.3 3.6-3.1 5.3" />
      <path d="m10.9 14 3.5.7 2.4 4.4" />
      <path d="m12.1 7.6 3.4 2.1 3.1-.6" />
      <path d="M6.2 10.9 3.6 12" />
    </svg>
  );
}

/** 跑鞋 */
export function IconShoe({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M2.8 16.2c0-1 .3-2 .8-2.6l1.7-2 3.4 1.5 3-2.4 1.9 1.4 3.2 1.5c1.6.7 2.6 1.6 2.6 2.6v1.4a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1z" />
      <path d="M6.4 12.2 8 9.4l2.6 1.6" />
      <path d="M2.8 19.6h18" />
    </svg>
  );
}

/** 秒表 */
export function IconStopwatch({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.8v3.7l2.4 1.5" />
      <path d="M9.6 2.6h4.8" />
      <path d="m18.6 6.9 1.6-1.6" />
    </svg>
  );
}

/** 路线 / 里程（带节点的路线路径）*/
export function IconRoute({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M5.5 3.5v5.2c0 1.6 1.3 2.9 2.9 2.9h7.2c1.6 0 2.9 1.3 2.9 2.9v2.5" />
      <circle cx="5.5" cy="3.5" r="1.6" />
      <circle cx="18.5" cy="19" r="1.6" />
    </svg>
  );
}

/** 配速（速度表） */
export function IconGauge({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3.4 16.5a9 9 0 1 1 17.2 0" />
      <path d="m12 12.8 3.6-3.3" />
      <circle cx="12" cy="13.4" r="1.3" />
    </svg>
  );
}

/** 心率 */
export function IconHeart({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 20.2s-7.6-4.5-7.6-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.6 2.8c0 4.9-7.6 9.4-7.6 9.4Z" />
    </svg>
  );
}

/** 心率带脉冲 */
export function IconPulse({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M2.6 12.2h4l2-5.1 3.2 9.8 2.4-6.2 1.6 3.1h5.6" />
    </svg>
  );
}

/** 脚步 / 步频 */
export function IconSteps({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M7.4 4.2c1.5 0 2.2 1.1 2 2.6-.2 1.3-.9 2.2-2 2.2s-1.9-.9-2-2.2c-.1-1.5.6-2.6 2-2.6Z" />
      <path d="M7.2 10.2c1.2 0 1.9.8 1.9 2 0 1.6-.6 2.8-1.6 2.8-1.1 0-1.8-.9-1.8-2.4 0-1.5.5-2.4 1.5-2.4Z" />
      <path d="M16.6 8.2c1.5 0 2.2 1.1 2 2.6-.2 1.3-.9 2.2-2 2.2s-1.9-.9-2-2.2c-.1-1.5.6-2.6 2-2.6Z" />
      <path d="M16.4 14.2c1.2 0 1.9.8 1.9 2 0 1.6-.6 2.8-1.6 2.8-1.1 0-1.8-.9-1.8-2.4 0-1.5.5-2.4 1.5-2.4Z" />
    </svg>
  );
}

/** 海拔 */
export function IconMountain({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m2.8 18.5 6-11 4 6.4 2.4-3.4 6 8" />
      <path d="M2.8 18.5h18.4" />
    </svg>
  );
}

/** 训练负荷（柱状） */
export function IconLoad({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3 20.4h18" />
      <rect x="4.6" y="12" width="3.4" height="5.6" rx="0.8" />
      <rect x="10.3" y="7.4" width="3.4" height="10.2" rx="0.8" />
      <rect x="16" y="10.2" width="3.4" height="7.4" rx="0.8" />
    </svg>
  );
}

/** 预测 / 趋势 */
export function IconTrend({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M3 16.6 9 10.4l3.6 3.4L21 5.4" />
      <path d="M15.6 5.4H21v5.4" />
    </svg>
  );
}

/** 恢复 / 电池 */
export function IconRecovery({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="2.8" y="7.4" width="15.6" height="9.2" rx="2.2" />
      <path d="M21.4 11v2" />
      <path d="m6.6 12 1.8 1.8 3-3.4" />
    </svg>
  );
}

/** 睡眠（月亮 + 星） */
export function IconMoon({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M20 13.4A8.2 8.2 0 0 1 10.6 4 8.4 8.4 0 1 0 20 13.4Z" />
    </svg>
  );
}

export function IconSun({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.6v2.1M12 19.3v2.1M4.3 4.3l1.5 1.5M18.2 18.2l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.3 19.7l1.5-1.5M18.2 5.8l1.5-1.5" />
    </svg>
  );
}

/** 设置 */
export function IconGear({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.2 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9Z" />
    </svg>
  );
}

/** 同步 */
export function IconSync({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M20.4 11.2a8.4 8.4 0 0 0-14.6-4.3L2.8 9.8" />
      <path d="M3.6 12.8a8.4 8.4 0 0 0 14.6 4.3l3-2.9" />
      <path d="M2.8 5.4v4.4h4.4M21.2 18.6v-4.4h-4.4" />
    </svg>
  );
}

/** 返回箭头 */
export function IconBack({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

/** 右箭头（表格行点击提示） */
export function IconChevron({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  );
}

/** 奖杯（成绩预测） */
export function IconTrophy({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M7.4 3.6h9.2v5.2a4.6 4.6 0 0 1-9.2 0z" />
      <path d="M7.4 5.2H4.9a2.1 2.1 0 0 0 2.5 4.1M16.6 5.2h2.5a2.1 2.1 0 0 1-2.5 4.1" />
      <path d="M12 13.4v3.4M8.6 20.4h6.8l-.7-3.6H9.3z" />
    </svg>
  );
}

/** 日历 */
export function IconCalendar({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="3.4" y="5" width="17.2" height="15.4" rx="2.2" />
      <path d="M3.4 9.6h17.2M8.2 3v4M15.8 3v4" />
    </svg>
  );
}

/** 数据库 / 同步数据 */
export function IconDatabase({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <ellipse cx="12" cy="6.2" rx="7.4" ry="2.8" />
      <path d="M4.6 6.2v11.6c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8V6.2" />
      <path d="M4.6 12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8" />
    </svg>
  );
}

/** 分段 / 逐圈 */
export function IconLayers({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="m12 3 9 4.6-9 4.6-9-4.6z" />
      <path d="m3.4 12.4 8.6 4.4 8.6-4.4" />
      <path d="m3.4 16.9 8.6 4.4 8.6-4.4" />
    </svg>
  );
}

/** 终点旗 */
export function IconFlag({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M5.4 21V3.4" />
      <path d="M5.4 4.2h11.8l-2.2 3.6 2.2 3.6H5.4" />
    </svg>
  );
}

/** 对话 */
export function IconChat({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M20.4 12.4a7.6 7.6 0 0 1-8 7.6c-1 0-2-.2-2.9-.6L4 21l1.4-4.2a7.4 7.4 0 0 1-1-4.4 7.6 7.6 0 0 1 8-7.6 7.6 7.6 0 0 1 8 7.6Z" />
      <path d="M9 11.4h6M9 14.4h4" />
    </svg>
  );
}

/** 靶心 */
export function IconTarget({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r={0.9} fill="currentColor" />
    </svg>
  );
}
