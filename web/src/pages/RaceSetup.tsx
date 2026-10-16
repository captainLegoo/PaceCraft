import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Activity, type RaceDetail } from "../api";
import RouteProfileCard from "./RaceRouteProfile";
import RaceBriefingCard, { type RaceBriefing } from "./RaceBriefing";
import { fmtPace } from "../charts";

/** 秒 → h:mm:ss 或 m:ss。必须处理秒的进位（见 format.ts 的说明）。 */
const fmtDurInput = (s: number) => {
  let h = Math.floor(s / 3600);
  let m = Math.floor((s % 3600) / 60);
  let sec = Math.round(s % 60);
  if (sec >= 60) { m += 1; sec -= 60; }
  if (m >= 60) { h += 1; m -= 60; }
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

/**
 * 解析用户输入的目标成绩。
 *
 * 关键歧义："3:00" 到底是 3 分 0 秒 还是 3 小时？
 * 用户显然是想填 3 小时。按「第一段是否 > 24」判别：
 * 超 24 的一定是分钟（185:37），不超的按小时（3:00、4:15）。
 * 同时按赛段距离做合理性校验，荒谬值直接拒绝而不是存进去算错配速。
 */
const parseDur = (t: string, km: number): number | null => {
  const v = t.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) { const n = Number(v); return n > 60 ? n : null; }

  const parts = v.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;

  let sec: number;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) {
    sec = parts[0] > 24 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60;
  } else return null;

  if (km > 0 && (sec < km * 150 || sec > km * 540)) return null; // 2:30/km ~ 9:00/km
  if (sec <= 0 || sec > 86400) return null;
  return Math.round(sec);
};

/**
 * 赛事设置 + 路线画像。
 *
 * 路线来源只有两条路：
 *  - 传 GPX（准，自带实测海拔）
 *  - 选内置路书（粗，DEM 估算）
 *
 * 刻意不做「自动搜路线」——搜出来的坐标无法保证准确，
 * 一个错的起点会让整条剖面失真，比没有更糟。
 */
export default function RaceSetup({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<RaceDetail | null>(null);
  const [briefing, setBriefing] = useState<RaceBriefing | null>(null);
  /** 全部已登记赛事，用于「同一天已有赛事」预检 */
  const [allRaces, setAllRaces] = useState<{ id: number; date: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // 新建赛事。默认值保持中性 —— 不要预填任何具体赛事，
  // 否则新用户会看到一个跟他无关的目标赛事，还以为是自己的。
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [dist, setDist] = useState("42.195");
  const [goal, setGoal] = useState("");
  const [useGpx, setUseGpx] = useState(false);
  const [gpxText, setGpxText] = useState("");
  // 关联的训练 + 主观体感备注
  const [labelId, setLabelId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  // 选比赛用：历史训练候选
  const [acts, setActs] = useState<Activity[]>([]);

  const loadBriefing = (id: number) =>
    fetch(`/api/races/${id}/briefing`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBriefing)
      .catch(() => setBriefing(null));

  const load = () => {
    setLoading(true);
    api
      .races()
      .then((list) => {
        if (list.length === 0) return null;
        const last = list[list.length - 1];
        return Promise.all([api.race(last.id).then(setDetail), loadBriefing(last.id)]);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    api.races().then(setAllRaces).catch(() => {});
    api.activities({ limit: "120" }).then(setActs).catch(() => {});
    // 只在挂载时拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 打开表单。编辑已登记的赛事时必须把已有值回填，
   * 否则用户改一个字段保存，别的字段全被空值冲掉。
   */
  const openForm = () => {
    if (detail) {
      const r = detail.race;
      setDate(r.date);
      setName(r.name);
      setCity(r.city ?? "");
      setDist(String(r.distanceKm));
      setGoal(r.goalSec ? fmtDurInput(r.goalSec) : "");
      setLabelId(r.labelId ?? null);
      setNotes(r.notes ?? "");
    }
    setErr(null);
    setOpen(true);
  };

  /**
   * 保存赛事。
   *
   * 分两种语义，不能混：
   *  - 已有 detail → 修改，走 PUT /api/races/:id，明确按 id 更新
   *  - 没有 detail → 新建，走 POST /api/races，由服务端按 (日期,名称) 判断插或改
   *
   * 为什么不一律走 POST 让服务端猜：改赛事名时（"XX马拉松" → "XX马拉松 全程"），
   * 服务端会认为这是新赛事而插一条，留下两条同日期记录。
   * 前端明确知道自己在编辑哪一条，就该按 id 更新。
   */
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const goalSec = parseDur(goal, Number(dist));
      if (goal.trim() && goalSec === null) {
        setErr(`无法识别目标成绩「${goal}」。请用 3:00（时:分）、3:05:37（时:分:秒）或直接填秒数`);
        return;
      }

      // 同一天只能参加一场 —— 保存前先提示，别让用户白填一遍
      const sameDay = allRaces.find((r) => r.date === date && r.id !== detail?.race.id);
      if (sameDay) {
        const okToReplace = confirm(
          `${date} 已经登记过「${sameDay.name}」。\n\n` +
          `同一天只能参加一场。\n` +
          `点「确定」用当前设置覆盖它，点「取消」返回修改日期。`,
        );
        if (!okToReplace) { setBusy(false); return; }
      }

      const payload = {
        date,
        name,
        city: city || null,
        distanceKm: Number(dist),
        goalSec,
        gpx: useGpx ? gpxText : null,
        useLibraryRoute: !useGpx,
        labelId,
        notes: notes.trim() || null,
      };

      const d = detail
        ? await api.uploadRaceRoute(detail.race.id, payload)
        : await api.createRace(payload);

      setDetail(d);
      setOpen(false);
      void loadBriefing(d.race.id);
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadGpx = async (file: File) => {
    if (!detail) return;
    setBusy(true);
    setErr(null);
    try {
      const text = await file.text();
      const d = await api.uploadRaceRoute(detail.race.id, { gpx: text });
      setDetail(d);
      void loadBriefing(d.race.id);
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteRace(detail.race.id);
      setDetail(null);
      setBriefing(null);
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    // 路线分析要查 DEM 高程，可能耗时几秒 —— 必须给占位，
    // 否则用户看到的是一片空白，会以为功能坏了
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">目标赛事</h3>
        <div className="hint" style={{ marginTop: 8 }}>正在载入赛事与路线数据…</div>
        <div className="skeleton" style={{ marginTop: 12, height: 22, width: "55%" }} />
        <div className="skeleton" style={{ marginTop: 10, height: 14, width: "35%" }} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">目标赛事</h3>
        <p className="card-sub">设置你要参加的比赛，系统会自动分析赛道爬升并给出配速方案。</p>
        {err && <div className="banner error" style={{ marginTop: 10 }}>{err}</div>}
        <button className="sync-btn" style={{ marginTop: 10, maxWidth: 200 }} onClick={openForm}>
          + 添加赛事
        </button>
        {open && <Form />}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 className="card-title" style={{ marginBottom: 2 }}>{detail.race.name}</h3>
          <p className="card-sub" style={{ margin: 0 }}>
            {detail.race.date} · {detail.race.distanceKm} km
            {detail.race.goalSec ? ` · 目标 ${fmtDurInput(detail.race.goalSec)}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label className="pill" style={{ cursor: "pointer" }}>
            上传 GPX
            <input
              ref={fileRef}
              type="file"
              accept=".gpx"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadGpx(f);
                e.target.value = "";
              }}
            />
          </label>
          <button className="pill" onClick={openForm} style={{ cursor: "pointer", border: "none", background: "none" }}>
            修改
          </button>
          <button
            className="pill"
            onClick={() => { if (confirm("删除这场赛事设定？")) void remove(); }}
            style={{ cursor: "pointer", border: "none", background: "none", color: "var(--warn)" }}
          >
            删除
          </button>
        </div>
      </div>

      {err && <div className="banner error" style={{ marginTop: 10 }}>{err}</div>}
      {busy && <div className="banner info" style={{ marginTop: 10 }}>处理中…</div>}

      {open && <Form />}

      <RouteProfileCard d={detail} />

      {briefing ? (
        <RaceBriefingCard d={briefing} />
      ) : (
        <div className="spin" style={{ display: "block", margin: "18px 0" }} />
      )}
    </div>
  );

  function Form() {
    // 历史训练候选：比赛当天在手表里就是一次普通训练，从这里选最省事
    const candidates = useMemo(
      () =>
        acts
          .filter((a) => !a.dateLabel || a.dateLabel <= date)
          .slice(0, 60),
      [acts, date],
    );
    const picked = candidates.find((a) => a.labelId === labelId);

    return (
      <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ marginBottom: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>从已同步的训练里选比赛</div>
          {candidates.length === 0 ? (
            <div className="hint">还没有可选择的训练记录。请先在「设置」页同步数据，或直接在下方手填日期。</div>
          ) : (
            <select
              value={labelId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) { setLabelId(null); return; }
                const a = candidates.find((x) => x.labelId === v);
                setLabelId(v);
                if (a) {
                  // 自动带出当天的距离与日期，省得手填
                  setDate(a.dateLabel);
                  if (a.distanceKm) setDist(String(a.distanceKm));
                  if (!name) setName(`${a.dateLabel} 比赛`);
                }
              }}
              style={{ width: "100%" }}
            >
              <option value="">— 不关联，手填日期（适用于未来的比赛）—</option>
              {candidates.map((a) => (
                <option key={a.labelId} value={a.labelId}>
                  {a.dateLabel} · {(a.distanceKm ?? 0).toFixed(2)} km · {fmtPace(a.avgPaceSec)}/km · 均心率 {a.avgHr ?? "—"}
                </option>
              ))}
            </select>
          )}
          {picked && (
            <div className="hint" style={{ marginTop: 6 }}>
              已关联 {picked.dateLabel} 的训练（{(picked.distanceKm ?? 0).toFixed(2)} km，均配速 {fmtPace(picked.avgPaceSec)}/km）。
              关联后这场比赛就能用那天的真实分段数据做复盘，而不是只有赛前填的目标成绩。
            </div>
          )}
        </div>

        <div className="grid g4" style={{ marginBottom: 10 }}>
          <label className="stat">
            <span className="label">比赛日期</span>
            <input value={date} onChange={(e) => setDate(e.target.value)} type="date" />
          </label>
          <label className="stat">
            <span className="label">赛事名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="2026 XX 马拉松" />
          </label>
          <label className="stat">
            <span className="label">城市</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="城市，如 上海" />
          </label>
          <label className="stat">
            <span className="label">距离 km</span>
            <input value={dist} onChange={(e) => setDist(e.target.value)} placeholder="42.195" />
          </label>
        </div>
        <div className="grid g4" style={{ marginBottom: 10 }}>
          <label className="stat">
            <span className="label">目标成绩</span>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="3:00 或 3:05:37" />
          </label>
          <div className="stat" style={{ justifyContent: "flex-end" }}>
            <span className="label">路线来源</span>
            <select value={useGpx ? "gpx" : "lib"} onChange={(e) => setUseGpx(e.target.value === "gpx")} style={{ marginTop: 4 }}>
              <option value="lib">内置路书库（DEM 估算）</option>
              <option value="gpx">我上传 GPX（实测海拔）</option>
            </select>
          </div>
        </div>

        <label className="stat" style={{ display: "block" }}>
          <span className="label">主观体感备注</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={"跑完后的真实感受，AI 复盘时会读这段：\n例：前 10km 状态不错；15-18km 右侧小腿抽筋；最后 5km 靠意志撑住，明显掉速。\n全程六成累 / 后半程呼吸变浅。"}
            style={{ minHeight: 84, fontSize: 12.5, lineHeight: 1.7 }}
          />
          <span className="hint">
            这类信息 COROS 完全不会记录，只有你知道，而它往往是解释客观数据的关键 ——
            配速掉了到底是疲劳、上坡、还是抽筋。写在这里，AI 分析这场比赛时会参考它。
          </span>
        </label>

        {useGpx ? (
          <label className="stat" style={{ display: "block" }}>
            <span className="label">粘贴 GPX 内容</span>
            <textarea
              value={gpxText}
              onChange={(e) => setGpxText(e.target.value)}
              placeholder="把 .gpx 文件内容粘贴到这里，或直接在卡片右上角上传文件"
              style={{ minHeight: 90, fontFamily: "ui-monospace, monospace", fontSize: 11 }}
            />
            <span className="hint">格式：3:00 = 3 小时；185:37 = 3:05:37</span>
          </label>
        ) : (
          <div className="stat" style={{ display: "block" }}>
            <span className="label">路线来源</span>
            <div className="hint" style={{ marginTop: 5, lineHeight: 1.6 }}>
              保存时按<strong>赛事全名 + 日期</strong>去内置路线库查找，不会按城市匹配 ——
              同一城市可能有多场不同赛事（主赛事 / 另一场同名系列赛），按城市找必然选错。<br />
              找不到就明确报错，不会拿同城其它赛事的路线顶替。
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="sync-btn" style={{ maxWidth: 160 }} onClick={() => void save()} disabled={busy}>
            {busy ? "保存中…" : detail ? "保存修改" : "创建赛事"}
          </button>
          <button className="sync-btn" style={{ maxWidth: 120 }} onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      </div>
    );
  }
}