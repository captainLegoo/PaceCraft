/**
 * 轨迹文件解析自测 —— GPX / KML / 坏文件的 12 组用例。
 *
 * 沿用仓库现状：`bun run src/cli/test-*.ts` 独立脚本，不引测试框架
 * （本项目就一个 Bun 进程跑服务端，引框架的成本大于收益）。
 *
 * fixture 全部是**文件里现写的合成字符串**，坐标一律用 120.0, 30.0 一带的假值：
 * 仓库做过开源脱敏，真实赛事名/真实轨迹坐标/真实城市组合不能进来。
 *
 * 有两条用例是为"最容易写反"的地方准备的，别删：
 *  - 用例 7 显式断言 KML 第一个点的经纬度 —— KML 是「经度 纬度」，GPX 是 lat/lon 属性，
 *    写反了剖面图看着还挺像，但完全是另一个地方，纯靠肉眼看图发现不了；
 *  - 用例 6 断言 trkseg 之间的 5km 跳跃不计入距离 —— 自动暂停会切段，
 *    算进去会让一场半马凭空多出 5km。
 */
import {
  accumulateElevation,
  COARSE_SPACING_M,
  haversineM,
  pickForDisplay,
  parseGpx,
  smoothByDistance,
  summarizeTrack,
  type RawPoint,
} from "../gpx.ts";
import { parseKml } from "../kml.ts";
import { parseRouteFile, sniffRouteFile } from "../route-file.ts";

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
  }
}

// ---------------- fixture ----------------

/** 造 n 个点的 GPX：lat 沿 0.0001 递增（约 11m/点），ele 线性上升 */
function makeGpx(n: number, opts?: { reversedAttrs?: boolean; extraAttr?: boolean; selfCloseLast?: boolean; withEle?: boolean }) {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const lat = 30 + i * 0.0001;
    const lon = 120 + i * 0.0001;
    const attrs = opts?.reversedAttrs
      ? `lon="${lon.toFixed(7)}" lat="${lat.toFixed(7)}"`
      : `lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"`;
    const attr = opts?.extraAttr ? `${attrs} hdop="1.2"` : attrs;
    if (opts?.withEle === false) {
      rows.push(`  <trkpt ${attr}/>`);
    } else if (opts?.selfCloseLast && i === n - 1) {
      rows.push(`  <trkpt ${attr}/>`);
    } else {
      rows.push(
        `  <trkpt ${attr}><ele>${(10 + i * 0.5).toFixed(3)}</ele>` +
          `<time>2030-01-01T00:${String(i % 60).padStart(2, "0")}:00Z</time></trkpt>`,
      );
    }
  }
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>合成轨迹</name><trkseg>\n${rows.join(
    "\n",
  )}\n</trkseg></trk></gpx>`;
}

const gpxNormal = makeGpx(200);

// ---------------- 1. GPX 正常 ----------------
console.log("\n▸ 1 GPX 正常（带 <ele>/<time>）");
{
  const t = parseGpx(gpxNormal);
  check("解析成功", t !== null);
  if (t) {
    check(`点数 = 200（实 ${t.points.length}）`, t.points.length === 200, t.points.length);
    check("hasElevation = true", t.hasElevation === true);
    check(`距离 > 1000m（实 ${t.distanceM}）`, t.distanceM > 1000, t.distanceM);
    check(`爬升 > 0（实 ${t.gainM}）`, t.gainM > 0, t.gainM);
    check(`海拔最低 10（实 ${t.eleMin}）`, Math.abs(t.eleMin - 10) < 2, t.eleMin);
    check(`海拔最高 > 100（实 ${t.eleMax}）`, t.eleMax > 100, t.eleMax);
    check("首点带 time", typeof t.points[0].time === "string", t.points[0].time);
  }
}

// ---------------- 2. 属性顺序反了 ----------------
console.log("\n▸ 2 属性顺序反了（lon 在前）");
{
  const t = parseGpx(makeGpx(50, { reversedAttrs: true }));
  check("仍能解析出 50 个点", t?.points.length === 50, t?.points.length);
  // 顺序反了但值不能反：首点 lat 必须还是 30 附近
  check("首点 lat 仍在 30 附近（值没被读串）", Math.abs((t?.points[0].lat ?? 0) - 30) < 1e-6, t?.points[0]);
}

// ---------------- 3. 多余属性 + 自闭合 ----------------
console.log("\n▸ 3 多余属性 / 自闭合 <trkpt/>");
{
  const t = parseGpx(makeGpx(60, { extraAttr: true, selfCloseLast: true }));
  check("带额外属性仍解析出 60 个点", t?.points.length === 60, t?.points.length);
  check("自闭合那一点保留（不被丢弃）", t?.points.length === 60);
  check("整体仍判为有高程", t?.hasElevation === true, t?.hasElevation);
}

// ---------------- 4. 命名空间前缀 ----------------
console.log("\n▸ 4 命名空间前缀 <gpx:trkpt>");
{
  const ns = gpxNormal.replace(/<trkpt /g, "<gpx:trkpt ").replace(/<\/trkpt>/g, "</gpx:trkpt>")
    .replace(/<trkseg>/g, "<gpx:trkseg>").replace(/<\/trkseg>/g, "</gpx:trkseg>");
  const t = parseGpx(ns);
  check("仍解析出 200 个点", t?.points.length === 200, t?.points.length);
  check("仍判为有高程", t?.hasElevation === true);
}

// ---------------- 5. GPX 无 <ele> ----------------
console.log("\n▸ 5 GPX 无 <ele>");
{
  const t = parseGpx(makeGpx(80, { withEle: false }));
  check("仍解析出 80 个点（不静默丢点）", t?.points.length === 80, t?.points.length);
  check("hasElevation = false", t?.hasElevation === false, t?.hasElevation);
  check("爬升为 0（代表没数据，不代表路面平）", t?.gainM === 0, t?.gainM);
  const parsed = parseRouteFile(makeGpx(80, { withEle: false }));
  check("parseRouteFile 返回可读错误", parsed.error !== null && /没有高程/.test(parsed.error!), parsed.error);
}

// ---------------- 6. 多 trkseg，段间相距 5km ----------------
console.log("\n▸ 6 多 <trkseg>，段间跳跃不计距离");
{
  const seg = (startLat: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const lat = startLat + i * 0.0001;
      return `  <trkpt lat="${lat.toFixed(7)}" lon="120.0000000"><ele>${(10 + i).toFixed(1)}</ele></trkpt>`;
    }).join("\n");
  // 两段之间纬度差 0.05° ≈ 5.5km，自动暂停造成的
  const xml = `<?xml version="1.0"?><gpx><trk><trkseg>\n${seg(30, 30)}\n</trkseg><trkseg>\n${seg(
    30.05,
    30,
  )}\n</trkseg></trk></gpx>`;
  const t = parseGpx(xml);
  const single = parseGpx(`<?xml version="1.0"?><gpx><trk><trkseg>\n${seg(30, 30)}\n</trkseg></trk></gpx>`);
  check("点数 = 60", t?.points.length === 60, t?.points.length);
  check("点带段号（两段是不同 seg）", t !== null && t.points[0].seg !== t.points[30].seg,
    { first: t?.points[0].seg, thirtieth: t?.points[30].seg });
  // 段间那一跳约 5.5km。若被算进去，总距离会是 6000+ m；
  // 正确结果是"两段各自累加" = 2 × 单段，且远小于 5km
  check(`段间 5km 跳跃未计入（${t?.distanceM}m，两段之和 ≈ ${(single?.distanceM ?? 0) * 2}m）`,
    t !== null && single !== null && Math.abs(t.distanceM - single.distanceM * 2) < 30,
    { multi: t?.distanceM, expect: (single?.distanceM ?? 0) * 2 });
  check("总距离远小于含跳跃时的 6km+", (t?.distanceM ?? 9999) < 1000, t?.distanceM);
}

// ---------------- 7. KML gx:Track（防经纬度写反） ----------------
console.log("\n▸ 7 KML gx:Track");
{
  const coords = Array.from({ length: 40 }, (_, i) => {
    const lon = 120 + i * 0.0001;
    const lat = 30 + i * 0.0002;
    return `<gx:coord>${lon.toFixed(7)} ${lat.toFixed(7)} ${(20 + i).toFixed(2)}</gx:coord>`;
  }).join("\n      ");
  const xml = `<?xml version="1.0"?>
<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
  <Placemark><name>轨迹</name><gx:Track>
      ${coords}
  </gx:Track></Placemark>
  <Folder><Placemark><name>地标A</name><Point><coordinates>120.9,30.9,0</coordinates></Point></Placemark></Folder>
</Document></kml>`;
  const t = parseKml(xml);
  check("解析成功", t !== null);
  if (t) {
    check(`点数 = 40（实 ${t.points.length}）`, t.points.length === 40, t.points.length);
    // ★ 关键断言：KML 是「经度 纬度」。写反了这里立刻炸
    check(`首点 lon = 120（实 ${t.points[0].lon}）`, Math.abs(t.points[0].lon - 120) < 1e-6, t.points[0]);
    check(`首点 lat = 30（实 ${t.points[0].lat}）`, Math.abs(t.points[0].lat - 30) < 1e-6, t.points[0]);
    check("首点高程 = 20", Math.abs((t.points[0].ele ?? -1) - 20) < 0.01, t.points[0].ele);
    check("hasElevation = true", t.hasElevation === true);
    check(`爬升 > 0（实 ${t.gainM}）`, t.gainM > 0, t.gainM);
    check("兴趣点 <Point> 没混进轨迹", t.points.length === 40);
  }
  const routed = parseRouteFile(xml);
  check("嗅探为 kml", routed.kind === "kml", routed.kind);
}

// ---------------- 8. KML LineString（换行/tab 分隔） ----------------
console.log("\n▸ 8 KML LineString（元组间换行与 tab）");
{
  const xml = `<?xml version="1.0"?>
<kml><Placemark><LineString><coordinates>
  120.0000,30.0000,12.5\t120.0010,30.0010,13.0
  120.0020,30.0020,14.25
</coordinates></LineString></Placemark></kml>`;
  const t = parseKml(xml);
  check(`点数 = 3（实 ${t?.points.length}）`, t?.points.length === 3, t?.points.length);
  check("首点 lon/lat 未写反", t !== null && Math.abs(t.points[0].lon - 120) < 1e-9 && Math.abs(t.points[0].lat - 30) < 1e-9, t?.points[0]);
  check("第三点高程 14.25", t !== null && Math.abs((t.points[2].ele ?? -1) - 14.25) < 1e-6, t?.points[2]);
  check("hasElevation = true", t?.hasElevation === true);
}

// ---------------- 9. 只有 2 个坐标值 / clampToGround ----------------
console.log("\n▸ 9 KML 无高度 与 clampToGround");
{
  const noAlt = `<kml><Placemark><LineString><coordinates>120.0,30.0 120.001,30.001 120.002,30.002</coordinates></LineString></Placemark></kml>`;
  const t1 = parseKml(noAlt);
  check("两点式坐标仍能解析出 3 个点", t1?.points.length === 3, t1?.points.length);
  check("但 hasElevation = false", t1?.hasElevation === false, t1?.hasElevation);

  const clamped = `<kml><Document><Style><altitudeMode>clampToGround</altitudeMode></Style>
    <Placemark><LineString><coordinates>120.0,30.0,0 120.001,30.001,0 120.002,30.002,0</coordinates></LineString></Placemark>
    </Document></kml>`;
  const t2 = parseKml(clamped);
  check("clampToGround 的高度视为不可信 → hasElevation = false", t2?.hasElevation === false, t2?.hasElevation);
  const routed = parseRouteFile(clamped);
  check("parseRouteFile 给出可读错误", routed.error !== null && /没有高程/.test(routed.error!), routed.error);
}

// ---------------- 10. KMZ ----------------
console.log("\n▸ 10 KMZ（zip 头）");
{
  // PK\x03\x04 —— 二进制读成文本后仍是这四个字节
  const kmz = "PK\u0003\u0004\u0014\u0000\u0000\u0000\u0008\u0000";
  check("嗅探为 kmz", sniffRouteFile(kmz) === "kmz");
  const parsed = parseRouteFile(kmz, "gpx");
  check("报错文案包含「GPX」指引", /GPX/.test(parsed.error ?? ""), parsed.error);
  check("报错文案提到压缩包", /压缩包/.test(parsed.error ?? ""), parsed.error);
}

// ---------------- 11. 少于 2 个点 ----------------
console.log("\n▸ 11 少于 2 个点 / 空文件 / 未知格式");
{
  check("单点 → parseGpx 返回 null", parseGpx('<gpx><trk><trkseg><trkpt lat="30" lon="120"><ele>1</ele></trkpt></trkseg></trk></gpx>') === null);
  const one = parseRouteFile('<gpx><trk><trkseg><trkpt lat="30" lon="120"><ele>1</ele></trkpt></trkseg></trk></gpx>');
  check("parseRouteFile 给出可读错误（区分于格式错）", one.error !== null && /轨迹点/.test(one.error!), one.error);
  const empty = parseRouteFile("   ");
  check("空文件有专门提示", empty.error !== null && /空的/.test(empty.error!), empty.error);
  const junk = parseRouteFile("这不是一个轨迹文件，只是一段文字");
  check("未知格式有专门提示", junk.kind === "unknown" && /认不出/.test(junk.error ?? ""), junk.error);
  check("未知格式提示里点名 GPX 与 KML", /GPX/.test(junk.error ?? "") && /KML/.test(junk.error ?? ""));
}

// ---------------- 12. 平坦轨迹 + ±0.4m 噪声 ----------------
console.log("\n▸ 12 平坦轨迹注入 ±0.4m 噪声，爬升不虚增");
{
  // 确定性伪随机，保证每次跑结果一致（测试不能靠运气）
  let seed = 42;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) - 0.5) * 0.8; // ±0.4m
  };
  const rows: string[] = [];
  for (let i = 0; i < 600; i++) {
    rows.push(
      `  <trkpt lat="${(30 + i * 0.0001).toFixed(7)}" lon="120.0000000"><ele>${(50 + noise()).toFixed(3)}</ele></trkpt>`,
    );
  }
  const t = parseGpx(`<?xml version="1.0"?><gpx><trk><trkseg>\n${rows.join("\n")}\n</trkseg></trk></gpx>`);
  check("解析成功", t !== null);
  // 真值是 0m 爬升。若阈值滤波失效，600 点的噪声能虚增出几十米
  check(`爬升 < 10m（实 ${t?.gainM}m）`, (t?.gainM ?? 999) < 10, t?.gainM);
  check(`下降 < 10m（实 ${t?.lossM}m）`, (t?.lossM ?? 999) < 10, t?.lossM);
  check(`海拔极值贴近 50m（${t?.eleMin}~${t?.eleMax}）`,
    Math.abs((t?.eleMin ?? 0) - 50) < 1 && Math.abs((t?.eleMax ?? 0) - 50) < 1,
    { min: t?.eleMin, max: t?.eleMax });
}

// ---------------- 附：抽稀、平滑窗口与兼容性 ----------------
console.log("\n▸ 附：pickForDisplay / 平滑窗口 / summarizeTrack 复用");
{
  const big = parseGpx(makeGpx(5000));
  check("原始 5000 点", big?.points.length === 5000, big?.points.length);
  const draw = big ? pickForDisplay(big.points) : [];
  check(`展示序列 <= 901 点（实 ${draw.length}）`, draw.length <= 901, draw.length);
  const lastOf = (p: { lat: number; lon: number }[]) => p[p.length - 1];
  check(
    "展示序列终点被保留",
    big !== null && lastOf(draw).lat === lastOf(big.points).lat &&
      lastOf(draw).lon === lastOf(big.points).lon,
  );
  check("pickForDisplay 返回点数组而非 GpxTrack（结构上杜绝喂回计算）", Array.isArray(draw));
}

/*
 * 回归 ①：展示用的抽稀不许改变任何统计量。
 *
 * 这条曾经以「抽稀后爬升仍是有限数」的形式存在 —— 而"有限数"永远抓不到
 * "偏了 50%"。真实案例：同一条赛道，预检说 181m，存库后变成 91m，
 * 页面显示的就是那个偏小的数，还顺带把 AI 简报里的赛道判断带歪了。
 */
console.log("\n▸ 回归①：抽稀只影响展示，不影响统计");
{
  /*
   * ⚠️ 下面是**合成 fixture**，不是任何真实轨迹 —— 它的绝对爬升值（约 620m）
   * 只在这套造数参数下有意义，不能和真实赛道的爬升数字互相比较。
   * 这里要验的是**性质**（换采样密度后数值稳不稳），不是具体数值。
   * 真实文件的验证靠 `bun run src/cli/verify-elevation.ts`（读 docs/ 下的 GPX）。
   *
   * 地形：波长 620/310/155m 的三组正弦
   * 噪声：波长 47/83/131m 的气压高度计噪声（都远大于最粗采样率 30m，不会混叠）
   */
  function terrainGpx(stepM: number): string {
    const n = Math.round((42.195 * 1000) / stepM);
    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      const d = i * stepM;
      const terrain = 9 * Math.sin(d / 620) + 6 * Math.sin(d / 310 + 0.7) + 4.5 * Math.sin(d / 155 + 2.1);
      // 噪声波长都远大于 30m 的最粗采样率，模拟真实的可采样噪声（不会混叠）
      const noise = 1.8 * Math.sin(d / 47) + 1.4 * Math.sin(d / 83 + 0.9) + 1.0 * Math.sin(d / 131 + 2.3);
      rows.push(
        `<trkpt lat="${(31.86 + d / 111320).toFixed(7)}" lon="117.28">` +
          `<ele>${(50 + terrain + noise).toFixed(3)}</ele></trkpt>`,
      );
    }
    return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${rows.join("")}</trkseg></trk></gpx>`;
  }

  const dense = parseGpx(terrainGpx(4));
  check("真实地形轨迹解析成功", dense !== null);
  if (dense) {
    // 4m 间隔的采样间隔应当被正确识别
    check(`采样间隔识别为 ~4m（实 ${dense.sampleSpacingM}）`, dense.sampleSpacingM <= 5, dense.sampleSpacingM);

    const draw = pickForDisplay(dense.points);
    check(`展示序列确实变稀了（${dense.points.length} → ${draw.length}）`, draw.length < dense.points.length / 5);

    // 关键：统计量必须来自完整序列。pickForDisplay 根本不返回 GpxTrack，
    // 所以这里断言的是「入库路径不再对它做任何重算」。
    const stored = JSON.parse(JSON.stringify(dense)) as typeof dense;
    check("入库（序列化再读回）的爬升与解析时逐米相等", stored.gainM === dense.gainM, {
      parsed: dense.gainM,
      stored: stored.gainM,
    });
    check("入库的下降同样守恒", stored.lossM === dense.lossM, {
      parsed: dense.lossM,
      stored: stored.lossM,
    });
    check("入库保留完整点数（不做抽稀）", stored.points.length === dense.points.length, stored.points.length);
  }

  /*
   * 回归 ②：平滑窗口按「米」定义，不是按「点数」。
   *
   * 同样是 7 个点，4m 间隔的表是 28m 窗口，30m 间隔的表是 210m 窗口 ——
   * 后者会把 60~150m 波段的真实起伏整段抹平。同一段路、同一套算法，
   * 换个设备导出就少算 27%，而用户完全无从察觉。
   */
  console.log("\n▸ 回归②：爬升不应随采样密度漂移");
  {
    const gains = [2, 4, 8, 15, 30].map((stepM) => {
      const t = parseGpx(terrainGpx(stepM));
      return { stepM, gain: t?.gainM ?? 0 };
    });
    for (const g of gains) {
      const drift = ((g.gain - gains[0].gain) / gains[0].gain) * 100;
      console.log(`     ${String(g.stepM).padStart(2)}m 采样 → ${String(g.gain).padStart(4)}m（相对 2m 基准 ${drift >= 0 ? "+" : ""}${drift.toFixed(1)}%）`);
    }
    const worst = Math.max(...gains.map((g) => Math.abs(g.gain - gains[0].gain) / gains[0].gain));
    check(
      `15 倍采样密度差异下爬升漂移 < 10%（实 ${(worst * 100).toFixed(1)}%）`,
      worst < 0.1,
    );
    // 旧写法（7 点窗口）在 30m 采样下会掉到 73%，这里留个下限防止悄悄退回
    const coarse = gains[gains.length - 1];
    check(`30m 间隔那份没被抹平（${coarse.gain}m ≥ 基准的 90%）`, coarse.gain >= gains[0].gain * 0.9);
  }

  /*
   * 回归 ③：窗口按**真实累计距离**取，不是"中位间隔换算成点数再按索引平均"。
   *
   * GPS 点间距极少均匀 —— 隧道、树荫、记录仪漂移都能让相邻间距差好几倍。
   * 按中位间隔算一个固定点数、再按索引平均，等于假设间距处处均匀：
   * 同一条路上慢速段窗口可能只有几十米，漂移段能拉到几百米。
   * 这里造一条间距摆动 5 倍的轨迹，爬升不该因此跑偏。
   */
  console.log("\n▸ 回归③：点间距不均匀时仍按真实距离平滑");
  {
    /** 按可变步长真实地"走"一条轨迹：步长在 baseStepM*(1±amp) 之间摆动 */
    function jitterGpx(baseStepM: number, amp: number, totalM = 20000): string {
      const rows: string[] = [];
      let d = 0;
      while (d < totalM) {
        d += baseStepM * (1 + amp * Math.sin(d / (baseStepM * 9)));
        const terrain = 9 * Math.sin(d / 620) + 6 * Math.sin(d / 310 + 0.7) + 4.5 * Math.sin(d / 155 + 2.1);
        const noise = 1.8 * Math.sin(d / 47) + 1.4 * Math.sin(d / 83 + 0.9);
        rows.push(
          `<trkpt lat="${(31.86 + d / 111320).toFixed(7)}" lon="117.28">` +
            `<ele>${(50 + terrain + noise).toFixed(3)}</ele></trkpt>`,
        );
      }
      return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${rows.join("")}</trkseg></trk></gpx>`;
    }

    const even = parseGpx(jitterGpx(20, 0));
    const uneven = parseGpx(jitterGpx(20, 0.6));
    const gaps: number[] = [];
    for (let i = 1; i < (uneven?.points.length ?? 1); i++) {
      const a = uneven!.points[i - 1];
      const b = uneven!.points[i];
      gaps.push(
        Math.hypot(
          (b.lat - a.lat) * 111320,
          (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)),
        ),
      );
    }
    gaps.sort((a, b) => a - b);
    const swing = gaps.length ? gaps[gaps.length - 1] / Math.max(gaps[0], 0.01) : 0;
    console.log(
      `     间距摆动 ${swing.toFixed(1)}×（${gaps[0]?.toFixed(0)}~${gaps[gaps.length - 1]?.toFixed(0)}m），中位 ${uneven?.sampleSpacingM}m`,
    );
    check(`造出了明显不均匀的间距（${swing.toFixed(1)}× > 3）`, swing > 3);
    const diff = Math.abs((uneven?.gainM ?? 0) - (even?.gainM ?? 0)) / Math.max(even?.gainM ?? 1, 1);
    check(
      `间距大幅摆动后爬升漂移 < 15%（实 ${(diff * 100).toFixed(1)}%）`,
      diff < 0.15,
    );
  }

  /*
   * 回归 ④：trkseg 边界的高程跳变、距离跳跃都不该被算进去。
   *
   * 段边界是记录仪的自动暂停 —— 前后两点可能隔几百米（地下通道、隧道出口、
   * 被楼挡住重定位）。高程不连续，距离也不该累加。
   * 把这一跳当爬升累加，人为在段间抬 50m 就会凭空多出 50m；
   * 把跳跃当距离累加，一场半马能凭空多出 5km。这是既有 bug，不是新引入的。
   */
  console.log("\n▸ 回归④：段间跳变（高程 / 距离）都不计入");
  {
    const half = Math.floor((dense?.points.length ?? 0) / 2);
    const JUMP_LAT = 0.045; // ≈ 5km 的瞬移
    const single = dense!.points.map((p) => ({
      lat: p.lat, lon: p.lon, seg: 0, ele: p.ele as number,
    }));
    // 第二段整体瞬移 5km 北边，并整体抬高 50m —— 两段之间同时有距离跳变和高程跳变
    const split = dense!.points.map((p, i) => ({
      lat: p.lat + (i < half ? 0 : JUMP_LAT),
      lon: p.lon,
      seg: i < half ? 0 : 1,
      ele: (p.ele as number) + (i < half ? 0 : 50),
    }));
    const a = summarizeTrack(single);
    const b = summarizeTrack(split);
    check(`单段 baseline：${a?.distanceM}m / ${a?.gainM}m`, a !== null);
    check(
      `段间 5km 瞬移不计入距离（${a?.distanceM} → ${b?.distanceM}）`,
      Math.abs((a?.distanceM ?? 0) - (b?.distanceM ?? 0)) < 50,
      { single: a?.distanceM, split: b?.distanceM },
    );
    check(
      `段间 50m 高程跳变不计入爬升（${a?.gainM} → ${b?.gainM}）`,
      Math.abs((a?.gainM ?? 0) - (b?.gainM ?? 0)) <= 2,
      { single: a?.gainM, split: b?.gainM },
    );
  }

  /*
   * 回归 ⑤：平滑必须在**密度变化下保持不变**（这才是 A / B 的分水岭）。
   *
   * A（按距离选点 + 点等权平均）与 B（距离域积分平均）在**间距均匀**时等价 ——
   * 每个点代表同样的距离，两种加权自然一样。所以「窗口长度变化下是否稳定」
   * 区分不了它们（实测两者在均匀合成数据上分别漂 2.4% 和 8.5%，A 反而更稳）。
   *
   * 真正的分水岭是**速度变化**：GPS 按时间间隔记录，跑得慢的单位距离内点更多
   * （上坡、拥堵、步行段天然更密）。A 让这些区段占更大权重，于是同一条路
   * 只是"哪一段跑得慢"不同，爬升就跟着变。
   */
  console.log("\n▸ 回归⑤：平滑不受采样密度影响（跑快跑慢给出同一个数）");
  {
    /** 同一条海拔-距离曲线，按可变步长采样：指定区段加密/抽稀 factor 倍 */
    function speedGpx(stepM: number, slowFrom: number, slowTo: number, factor: number): string {
      const rows: string[] = [];
      let d = 0;
      while (d < 42000) {
        const slow = d >= slowFrom && d < slowTo;
        d += slow ? stepM / factor : stepM;
        const terrain = 9 * Math.sin(d / 620) + 6 * Math.sin(d / 310 + 0.7) + 4.5 * Math.sin(d / 155 + 2.1);
        const noise = 1.8 * Math.sin(d / 47) + 1.4 * Math.sin(d / 83 + 0.9);
        rows.push(
          `<trkpt lat="${(31.86 + d / 111320).toFixed(7)}" lon="117.28">` +
            `<ele>${(50 + terrain + noise).toFixed(3)}</ele></trkpt>`,
        );
      }
      return `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${rows.join("")}</trkseg></trk></gpx>`;
    }

    const uniform = parseGpx(speedGpx(10, 1e9, 2e9, 1))?.gainM ?? 0;
    const slow = parseGpx(speedGpx(10, 10000, 20000, 5))?.gainM ?? 0;
    const fast = parseGpx(speedGpx(10, 10000, 20000, 1 / 5))?.gainM ?? 0;
    console.log(`     全段匀速 10m        → ${uniform}m`);
    console.log(`     10-20km 跑慢（密 5×）→ ${slow}m`);
    console.log(`     10-20km 跑快（稀 5×）→ ${fast}m`);
    const spread = (Math.max(uniform, slow, fast) - Math.min(uniform, slow, fast)) / uniform;
    // 点等权那种实现在这里会给出 592m（-3.6%）
    check(
      `把 1/3 路段的点密度改 5 倍，爬升漂移 < 2%（实 ${(spread * 100).toFixed(1)}%）`,
      spread < 0.02,
      { uniform, slow, fast },
    );
  }
}

// 粗采样源：算法补不回来，只能如实标记（UI 据此提示用户）
console.log("\n▸ 粗采样源标记");
{
  const dense = parseGpx(makeGpx(5000));
  check(`密集源（~11m/点）不算粗：${dense?.sampleSpacingM}m`, (dense?.sampleSpacingM ?? 999) <= COARSE_SPACING_M);
}

{
  // KML 与 GPX 共用 summarizeTrack，保证产出的形状一致
  const raw: RawPoint[] = Array.from({ length: 5 }, (_, i) => ({
    lat: 30 + i * 0.001,
    lon: 120,
    ele: 10 + i * 2,
    seg: 0,
  }));
  const t = summarizeTrack(raw);
  /*
   * 这里期望的不是 8 而是 6，是有意的：
   * 这 5 个点间隔 111m，按物理长度换算出的窗口是 3 个点（= 330m）而不是 7 个点
   * （= 777m）。居中滑动平均在两端只有半个窗口，会把单调上升的首尾点往下拉，
   * 于是爬升从 8 变成 6。真实轨迹上这个边缘效应可以忽略 ——
   * 10000 点的 40km 单调上升，平滑前后都是 9.5m。
   * 旧写法（固定 7 点窗口）在这里恰好因为窗口 > 点数而跳过了平滑，才得到 8。
   */
  check(`summarizeTrack 可用（短轨迹受边缘效应影响，爬升 ${t?.gainM}）`, (t?.gainM ?? 0) > 0 && (t?.gainM ?? 99) <= 8, t?.gainM);
  check("单点 → summarizeTrack 返回 null", summarizeTrack(raw.slice(0, 1)) === null);
}

console.log(
  failures === 0 ? "\n✅ 全部通过\n" : `\n❌ ${failures} 项失败\n`,
);
process.exit(failures === 0 ? 0 : 1);
