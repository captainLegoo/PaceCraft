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
import { downsample, parseGpx, summarizeTrack, type RawPoint } from "../gpx.ts";
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

// ---------------- 附：抽稀与兼容性 ----------------
console.log("\n▸ 附：downsample / summarizeTrack 复用");
{
  const big = parseGpx(makeGpx(5000));
  check("原始 5000 点", big?.points.length === 5000, big?.points.length);
  const thin = big ? downsample(big) : null;
  check(`抽稀到 <= 901 点（实 ${thin?.points.length}）`, (thin?.points.length ?? 9999) <= 901, thin?.points.length);
  const lastOf = (t: { points: { lat: number; lon: number }[] }) => t.points[t.points.length - 1];
  check(
    "抽稀后终点被保留（按坐标比，因为 summarizeTrack 会重新建点对象）",
    thin !== null && big !== null &&
      lastOf(thin).lat === lastOf(big).lat && lastOf(thin).lon === lastOf(big).lon,
  );
  check("抽稀后 hasElevation 不翻车", thin?.hasElevation === true, thin?.hasElevation);
  check("抽稀后爬升仍是有限数", Number.isFinite(thin?.gainM ?? NaN), thin?.gainM);

  // KML 与 GPX 共用 summarizeTrack，保证产出的形状一致
  const raw: RawPoint[] = Array.from({ length: 5 }, (_, i) => ({
    lat: 30 + i * 0.001,
    lon: 120,
    ele: 10 + i * 2,
    seg: 0,
  }));
  const t = summarizeTrack(raw);
  check("summarizeTrack 直接可用", t?.gainM === 8, t?.gainM);
  check("单点 → summarizeTrack 返回 null", summarizeTrack(raw.slice(0, 1)) === null);
}

console.log(
  failures === 0 ? "\n✅ 全部通过\n" : `\n❌ ${failures} 项失败\n`,
);
process.exit(failures === 0 ? 0 : 1);
