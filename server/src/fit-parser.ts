import { readFileSync } from "node:fs";
import FitParser from "fit-file-parser";

export type FitLap = {
  lapIndex: number;
  distanceM: number;
  timeSec: number;
  totalLengthSec: number;
  avgPaceSec: number | null;
  avgSpeedRaw: number | null;
  avgPower: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgStrideM: number | null;
  elevGain: number | null;
  totalDescent: number | null;
};

export type FitAltitudeSummary = {
  samples: number;
  altMin: number;
  altMax: number;
  altAvg: number;
  gainFromFit: number;
  latSemicircle: number;
  lonSemicircle: number;
};

/**
 * 纯 JS/TS FIT 文件解码器，完全脱离 Python / fitparse 外部依赖。
 * 在桌面客户端（macOS / Windows / Linux）单文件打包中 100% 自包含运行。
 */
export async function parseFitFile(bufferOrPath: Buffer | string): Promise<any> {
  const buf: Buffer = typeof bufferOrPath === "string" ? readFileSync(bufferOrPath) : bufferOrPath;
  return new Promise((resolve) => {
    try {
      const parser = new (FitParser as any)({
        force: true,
        speedUnit: "m/s",
        lengthUnit: "m",
        temperatureUnit: "celsius",
        elapsedRecordField: true,
      });
      parser.parse(buf, (err: any, data: any) => {
        if (err || !data) {
          resolve(null);
        } else {
          resolve(data);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * 从 FIT 文件中解析分圈数据（Laps）
 * 包含步频（单脚->双脚自动归一化）与步幅修正
 */
export async function parseLapsFromFit(fitPath: string): Promise<FitLap[]> {
  try {
    const data = await parseFitFile(fitPath);
    if (!data || !Array.isArray(data.laps) || data.laps.length === 0) {
      return [];
    }

    const laps: FitLap[] = [];
    let idx = 1;
    let cumTime = 0.0;

    for (const m of data.laps) {
      const dist = m.total_distance;
      const time = m.total_timer_time ?? m.total_elapsed_time;
      if (dist == null || time == null || time <= 0) continue;

      const distF = Number(dist);
      const timeF = Number(time);
      cumTime += timeF;

      let cadence = m.avg_cadence ?? m.avg_running_cadence;
      if (cadence != null && cadence > 0 && cadence < 120) {
        cadence = cadence * 2; // 单脚 rpm 归一化为双脚 spm
      }

      let maxCadence = m.max_cadence;
      if (maxCadence != null && maxCadence > 0 && maxCadence < 120) {
        maxCadence = maxCadence * 2;
      }

      let stride: number | null = null;
      if (m.avg_stride_length != null && Number(m.avg_stride_length) > 0) {
        const val = Number(m.avg_stride_length);
        // FIT 规范中步幅可能以米(1.2)或毫米(1200)为单位
        stride = val > 10 ? +(val / 1000).toFixed(2) : +val.toFixed(2);
      } else if (cadence && cadence > 0 && timeF > 0 && distF > 0) {
        const totalSteps = cadence * (timeF / 60.0);
        if (totalSteps > 0) {
          stride = +(distF / totalSteps).toFixed(2);
        }
      }

      const avgPaceSec = distF > 0 ? +(timeF / (distF / 1000.0)).toFixed(2) : null;
      const avgSpeed = m.avg_speed != null ? Number(m.avg_speed) : null;

      laps.append = undefined as any; // safety
      laps.push({
        lapIndex: idx,
        distanceM: distF,
        timeSec: timeF,
        totalLengthSec: +cumTime.toFixed(2),
        avgPaceSec,
        avgSpeedRaw: avgSpeed,
        avgPower: m.avg_power != null ? Math.round(m.avg_power) : null,
        avgHr: m.avg_heart_rate != null ? Math.round(m.avg_heart_rate) : null,
        maxHr: m.max_heart_rate != null ? Math.round(m.max_heart_rate) : null,
        avgCadence: cadence ? Math.round(cadence) : null,
        maxCadence: maxCadence ? Math.round(maxCadence) : null,
        avgStrideM: stride,
        elevGain: m.total_ascent != null ? Math.round(m.total_ascent) : null,
        totalDescent: m.total_descent != null ? Math.round(m.total_descent) : null,
      });
      idx++;
    }

    return laps;
  } catch (err) {
    console.error("[FitParser] Error parsing laps:", err);
    return [];
  }
}

/**
 * 从 FIT 文件中解析采样点，提取绝对海拔、滞回滤波累计爬升及 GPS 坐标
 */
export async function parseAltitudeFromFit(fitPath: string): Promise<FitAltitudeSummary | null> {
  try {
    const data = await parseFitFile(fitPath);
    if (!data || !Array.isArray(data.records) || data.records.length === 0) {
      return null;
    }

    const alts: number[] = [];
    const lats: number[] = [];
    const lons: number[] = [];

    for (const r of data.records) {
      if (r.altitude != null && !Number.isNaN(r.altitude)) {
        alts.push(Number(r.altitude));
      }
      if (r.position_lat != null && !Number.isNaN(r.position_lat)) {
        lats.push(Number(r.position_lat));
      }
      if (r.position_long != null && !Number.isNaN(r.position_long)) {
        lons.push(Number(r.position_long));
      }
    }

    if (alts.length === 0) {
      return {
        samples: 0,
        altMin: 0,
        altMax: 0,
        altAvg: 0,
        gainFromFit: 0,
        latSemicircle: lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
        lonSemicircle: lons.length > 0 ? lons.reduce((a, b) => a + b, 0) / lons.length : 0,
      };
    }

    // ±3 采样点滑动平均滤波，消除气压计逐秒微扰
    const win = 7;
    let sm: number[] = alts;
    if (alts.length >= win) {
      const half = Math.floor(win / 2);
      sm = [];
      for (let i = 0; i < alts.length; i++) {
        const lo = Math.max(0, i - half);
        const hi = Math.min(alts.length, i + half + 1);
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += alts[j];
        sm.push(sum / (hi - lo));
      }
    }

    // 滞回阈值滤波累加
    const th = 1.2;
    let gain = 0.0;
    let ref = sm[0];
    for (const x of sm) {
      if (x - ref > th) {
        gain += x - ref;
        ref = x;
      } else if (ref - x > th) {
        ref = x;
      }
    }

    // 滞回滤波削峰补偿因子（中位比值 0.90）
    gain = gain / 0.9;

    const altMin = Math.min(...alts);
    const altMax = Math.max(...alts);
    const altAvg = alts.reduce((a, b) => a + b, 0) / alts.length;

    return {
      samples: alts.length,
      altMin: +altMin.toFixed(1),
      altMax: +altMax.toFixed(1),
      altAvg: +altAvg.toFixed(1),
      gainFromFit: Math.round(gain),
      latSemicircle: lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
      lonSemicircle: lons.length > 0 ? lons.reduce((a, b) => a + b, 0) / lons.length : 0,
    };
  } catch (err) {
    console.error("[FitParser] Error parsing altitude:", err);
    return null;
  }
}
