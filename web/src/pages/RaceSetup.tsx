import { useEffect, useMemo, useState } from "react";
import { api, type Activity, type RaceDetail, type RouteFilePreview, type Race } from "../api";
import RouteProfileCard from "./RaceRouteProfile";
import RaceBriefingCard, { type RaceBriefing } from "./RaceBriefing";
import { fmtPace } from "../charts";

/**
 * 距离预设。
 *
 * 为什么要预设而不是让用户手填：21.0975 和 42.195 这两个数**手打很难打对**
 * （少一位小数就变成半程，事后很难发现）。写成选项让用户点一下，
 * 写入时也保持原值不四舍五入 —— 官方距离就该是官方距离。
 * 其它项目的距离（越野、 trail、半程以外的自测）走「其他」手填。
 */
const DIST_PRESETS = [
  { key: "5", label: "5 公里", km: "5" },
  { key: "10", label: "10 公里", km: "10" },
  { key: "half", label: "半程马拉松 21.0975", km: "21.0975" },
  { key: "full", label: "全程马拉松 42.195", km: "42.195" },
] as const;

/** 路线来源的三种选择。默认是"先不填" */
type RouteMode = "none" | "file" | "lib";

/**
 * 北京时间今天（yyyy-mm-dd）。
 *
 * 为什么不能用 toISOString()：那是 UTC。北京时间凌晨 0 点到 8 点之间，
 * UTC 还停在前一天，于是"今天"会算成昨天 —— 表现为比赛日过了午夜却还显示，
 * 或者当天训练还没被算进来。差一天在这里就是错的。
 *
 * 用 Intl 按时区格式化，不引日期库（也就一行，还能正确处理夏令时规则）。
 */
const todayBeijing = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * 从 sourceNote 里取回导入时的文件名。
 *
 * 只认 routeSourceNote 自己写的那一种格式（"…｜来自 <文件名>"），
 * 解析不出来就返回 null 隐藏这行 —— 宁可少显示，也不要显示错名字：
 * 一个错的文件名会让人以为路线是另一场比赛的。
 */
const fileNameFromNote = (note: string | null | undefined): string | null => {
  const m = (note ?? "").match(/｜来自\s*([^｜\n]+?)\s*$/);
  return m ? m[1] : null;
};

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
/** 距离数值 → 预设 key；匹配不上就算「其他」 */
const presetKeyFor = (km: number | null | undefined): string => {
  if (km == null) return "other";
  const hit = DIST_PRESETS.find((p) => Math.abs(Number(p.km) - Number(km)) < 0.001);
  return hit ? hit.key : "other";
};

export default function RaceSetup({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<RaceDetail | null>(null);
  const [briefing, setBriefing] = useState<RaceBriefing | null>(null);
  /** 全部已登记赛事列表 */
  const [allRaces, setAllRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  // 新建赛事。默认值保持中性 —— 不要预填任何具体赛事，
  // 否则新用户会看到一个跟他无关的目标赛事，还以为是自己的。
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [dist, setDist] = useState("42.195");
  /** 当前选中的距离预设；选「其他」或从训练里带出非预设距离时置为 "other" */
  const [distPreset, setDistPreset] = useState<string>("full");
  const [goal, setGoal] = useState("");
  /** 路线来源。默认"先不填" —— 先登记赛事是正当需求，不该逼人先有轨迹 */
  const [routeMode, setRouteMode] = useState<RouteMode>("none");
  /** 轨迹文件全文（文件框与粘贴框写同一份，谁先填谁生效） */
  const [gpxText, setGpxText] = useState("");
  /** 选中的文件名，用于回显确认选对了哪条轨迹 */
  const [routeFileName, setRouteFileName] = useState<string | null>(null);
  /** 预检结果：让用户在保存前就看到"这份文件解析出来是什么样" */
  const [preview, setPreview] = useState<RouteFilePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // 关联的那次训练
  const [labelId, setLabelId] = useState<string | null>(null);
  // 选比赛用：历史训练候选
  const [acts, setActs] = useState<Activity[]>([]);

  // 历史训练候选移至顶层，保证无条件调用 hooks 且不会因局部组件重新声明导致重新挂载失焦
  const candidates = useMemo(
    () => acts.filter((a) => !a.dateLabel || !date || a.dateLabel <= date).slice(0, 60),
    [acts, date],
  );

  /** 按月调整比赛日期（+1 或 -1 个月），自动处理跨年和不同月份天数限制 */
  const adjustMonth = (delta: number) => {
    const cur = date || todayBeijing();
    const parts = cur.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return;
    let [y, m, d] = parts;
    m += delta;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    const maxDays = new Date(y, m, 0).getDate();
    const safeDay = Math.min(d, maxDays);
    setDate(`${y}-${String(m).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`);
  };

  const loadBriefing = (id: number) =>
    fetch(`/api/races/${id}/briefing`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBriefing)
      .catch(() => setBriefing(null));

  const selectRace = async (id: number) => {
    setLoading(true);
    setErr(null);
    try {
      const [d] = await Promise.all([api.race(id), loadBriefing(id)]);
      setDetail(d);
      if (open && formMode === "edit") {
        const r = d.race;
        setDate(r.date);
        setName(r.name);
        setCity(r.city ?? "");
        setDist(String(r.distanceKm));
        setDistPreset(presetKeyFor(r.distanceKm));
        setGoal(r.goalSec ? fmtDurInput(r.goalSec) : "");
        setLabelId(r.labelId ?? null);
        setRouteMode(r.routeSource === "gpx" ? "file" : r.routeSource === "waypoints" ? "lib" : "none");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const load = (preferredId?: number) => {
    setLoading(true);
    api
      .races()
      .then((list) => {
        setAllRaces(list);
        if (list.length === 0) {
          setDetail(null);
          setBriefing(null);
          return null;
        }

        const today = todayBeijing();
        const upcoming = list.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));

        let targetId: number;
        if (preferredId && list.some((r) => r.id === preferredId)) {
          targetId = preferredId;
        } else if (upcoming.length > 0) {
          // 优先取距离今天最近的那场未来赛事
          targetId = upcoming[0].id;
        } else {
          // 没有未来赛事时，倒序取最近一场往期赛事供回顾
          const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
          targetId = sorted[0].id;
        }

        return Promise.all([api.race(targetId).then(setDetail), loadBriefing(targetId)]);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.activities({ limit: "120" }).then(setActs).catch(() => {});
    // 只在挂载时拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 打开新建赛事表单 */
  const openCreateForm = () => {
    setDate("");
    setName("");
    setCity("");
    setDist("42.195");
    setDistPreset("full");
    setGoal("");
    setLabelId(null);
    setRouteMode("none");
    setGpxText("");
    setRouteFileName(null);
    setPreview(null);
    setErr(null);
    setFormMode("create");
    setOpen(true);
  };

  /**
   * 打开编辑表单。编辑已登记的赛事时必须把已有值回填，
   * 否则用户改一个字段保存，别的字段全被空值冲掉。
   */
  const openEditForm = () => {
    if (!detail) return;
    const r = detail.race;
    setDate(r.date);
    setName(r.name);
    setCity(r.city ?? "");
    setDist(String(r.distanceKm));
    setDistPreset(presetKeyFor(r.distanceKm));
    setGoal(r.goalSec ? fmtDurInput(r.goalSec) : "");
    setLabelId(r.labelId ?? null);
    // 路线来源要跟着库里已有的值回填，否则打开「修改」会看到"先不填"，
    // 用户随手一存就以为把已上传的轨迹弄丢了
    setRouteMode(r.routeSource === "gpx" ? "file" : r.routeSource === "waypoints" ? "lib" : "none");
    // 文件内容不进 state 回填（库里存的是抽稀后的剖面，不是原始文件）：
    // 编辑时不重新导入就保持原样，显式选新文件才算替换
    setGpxText("");
    setRouteFileName(null);
    setPreview(null);
    setErr(null);
    setFormMode("edit");
    setOpen(true);
  };

  /**
   * 保存赛事。
   *
   * 分两种语义，不能混：
   *  - edit 模式 → 修改，走 PUT /api/races/:id，明确按 id 更新
   *  - create 模式 → 新建，走 POST /api/races
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
      const targetId = formMode === "edit" ? detail?.race.id : undefined;
      const sameDay = allRaces.find((r) => r.date === date && r.id !== targetId);
      if (sameDay) {
        const okToReplace = confirm(
          `${date} 已经登记过「${sameDay.name}」。\n\n` +
          `同一天只能参加一场。\n` +
          `点「确定」用当前设置覆盖它，点「取消」返回修改日期。`,
        );
        if (!okToReplace) { setBusy(false); return; }
      }

      /*
       * 路线来源三选一 → 请求参数。
       *
       * "先不填路线"必须是**真的能存下来**（routeSource='none'），
       * 而不是让后端去查内置库然后报错 —— 先登记赛事、后补轨迹是正当需求。
       *
       * 编辑已有赛事时，如果用户选了"先不填"而库里本来有路线，
       * 那是一次**删除**，得先确认。其它情况一律保留原路线
       * （服务端也这么判：没提交路线字段就当"这次没提"）。
       */
      const clearingRoute =
        formMode === "edit" &&
        routeMode === "none" &&
        !!detail &&
        detail.race.routeSource !== "none" &&
        gpxText.trim().length === 0;
      if (clearingRoute) {
        const ok = confirm(
          `这场比赛已经有一份路线（${detail.race.routeSource === "gpx" ? "轨迹文件" : "路书"}）。\n\n` +
            `选「先不填路线」会把它清掉，之后只能重新导入才能恢复。\n` +
            `确定要清掉吗？`,
        );
        if (!ok) { setBusy(false); return; }
      }

      // 选了"上传/粘贴"却什么都没给：说清楚，别静默存成一条没路线的赛事
      const keepingExistingRoute =
        formMode === "edit" && !!detail && detail.race.routeSource === "gpx" && gpxText.trim().length === 0;
      if (routeMode === "file" && gpxText.trim().length === 0 && !keepingExistingRoute) {
        setErr(
          "你选了「上传/粘贴轨迹文件」，但还没有选文件。\n" +
            "点上面的框选一个 .gpx（或 .kml）文件，或者把内容直接粘进下面的文本框。\n" +
            "如果只是想先登记这场比赛、把路线留到之后补，把「路线来源」改成「先不填路线」就行。",
        );
        setBusy(false);
        return;
      }

      const payload = {
        date,
        name,
        city: city || null,
        distanceKm: Number(dist),
        goalSec,
        // routeText 走新字段，gpx 旧字段保留兼容（服务端以 routeText 为准）
        routeText: routeMode === "file" ? gpxText || null : null,
        routeKind: "auto",
        // 文件名跟着一起提交，服务端会写进 sourceNote，
        // 编辑时才能显示"来源文件：xxx.gpx"，确认自己没导错那一条
        routeFileName: routeFileName,
        gpx: null,
        useLibraryRoute: routeMode === "lib",
        clearRoute: clearingRoute,
        labelId,
      };

      const d = formMode === "edit" && detail
        ? await api.uploadRaceRoute(detail.race.id, payload)
        : await api.createRace(payload);

      setDetail(d);
      setOpen(false);
      void loadBriefing(d.race.id);
      api.races().then(setAllRaces).catch(() => {});
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 读一份轨迹文件：先做本地即时检查，再交给服务端预检。
   *
   * 分两步是有意的：
   *  - 本地能立刻判断的（空文件、选了 .kmz）先拦下来，**不产生任何网络请求**，
   *    用户点完文件就看到提示，不用等;
   *  - 真正判断"这份文件能不能用"必须问服务端（经纬度写反、段间跳跃、
   *    到底有没有高程这些都在服务端才判断得准），所以走 parse-route。
   *
   * 前端**不自己解析**轨迹：两份解析逻辑必然漂移，
   * 用户在预检里看到的数字必须和保存后算出来的完全一致。
   */
  const readRouteFile = async (file: File) => {
    setErr(null);
    setPreview(null);
    setPreviewing(true);
    try {
      // 后缀名的判断只用来提前给出**更具体**的提示，不能替代内容嗅探：
      // .gp 里装 KML、.kmz 改名成 .gpx 的情况都真实存在
      if (/\.kmz$/i.test(file.name)) {
        setRouteFileName(file.name);
        setGpxText("");
        setErr(
          `${file.name} 是 KMZ（压缩包），服务端读不了里面的内容。\n` +
            `请在两步路导出时改选「GPX格式」，或先解压出里面的 .kml 再选。`,
        );
        return;
      }
      if (/\.(fit|tcx|csv|zip)$/i.test(file.name)) {
        setRouteFileName(file.name);
        setGpxText("");
        setErr(
          `${file.name} 看起来不是轨迹文件（GPX/KML）。\n` +
            `请在两步路 / Strava / Garmin 里导出时选「GPX格式」。`,
        );
        return;
      }
      const text = await file.text();
      setRouteFileName(file.name);
      if (text.trim().length === 0) {
        setGpxText("");
        setErr(`${file.name} 是空文件，没有读到内容。请确认导出成功。`);
        return;
      }
      setGpxText(text);
      const p = await api.parseRouteFile({ text, fileName: file.name, routeKind: "auto" });
      setPreview(p);
      if (!p.ok) setErr(p.error ?? "这个文件解析失败");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  /** 粘贴框内容变化后同样做一次预检（只在内容够长时才查，避免每敲一个字打一次接口） */
  const onPasteChange = (text: string) => {
    setGpxText(text);
    setRouteFileName(null);
    setPreview(null);
    if (text.trim().length < 200) return;
    setPreviewing(true);
    void api
      .parseRouteFile({ text, routeKind: "auto" })
      .then((p) => {
        setPreview(p);
        if (!p.ok) setErr(p.error ?? "内容解析失败");
      })
      .catch(() => setErr("预检失败，请检查粘贴的内容是否完整"))
      .finally(() => setPreviewing(false));
  };

  const remove = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteRace(detail.race.id);
      const remaining = allRaces.filter((r) => r.id !== detail.race.id);
      setAllRaces(remaining);
      onChanged?.();
      if (remaining.length > 0) {
        const today = todayBeijing();
        const upcoming = remaining.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
        const nextId = upcoming.length > 0 ? upcoming[0].id : remaining[remaining.length - 1].id;
        await selectRace(nextId);
      } else {
        setDetail(null);
        setBriefing(null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  function renderForm() {
    const picked = candidates.find((a) => a.labelId === labelId);

    return (
      <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>
            {formMode === "create" ? "添加新赛事" : `修改赛事信息（${detail?.race.name ?? ""}）`}
          </strong>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 16 }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span className="label" style={{ margin: 0 }}>比赛日期</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="pill"
                  onClick={(e) => { e.preventDefault(); adjustMonth(-1); }}
                  title="上一个月（快捷键：在输入框内按键盘向下箭头）"
                  style={{ cursor: "pointer", padding: "1px 6px", fontSize: 11 }}
                >
                  ◀ 上月
                </button>
                <button
                  type="button"
                  className="pill"
                  onClick={(e) => { e.preventDefault(); adjustMonth(1); }}
                  title="下一个月（快捷键：在输入框内按键盘向上箭头）"
                  style={{ cursor: "pointer", padding: "1px 6px", fontSize: 11 }}
                >
                  下月 ▶
                </button>
              </div>
            </div>
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  adjustMonth(1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  adjustMonth(-1);
                }
              }}
              type="date"
              style={{ width: "100%" }}
            />
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
            <span className="label">距离</span>
            <select
              value={distPreset}
              onChange={(e) => {
                const key = e.target.value;
                setDistPreset(key);
                const hit = DIST_PRESETS.find((p) => p.key === key);
                // 选「其他」时保留当前值让用户接着改，不要清空
                if (hit) setDist(hit.km);
              }}
            >
              {DIST_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="other">其他（自定义）</option>
            </select>
            {distPreset === "other" && (
              <input
                value={dist}
                onChange={(e) => setDist(e.target.value)}
                placeholder="公里数，如 25"
                style={{ marginTop: 6 }}
              />
            )}
          </label>
        </div>
        <div className="grid g4" style={{ marginBottom: 10 }}>
          <label className="stat">
            <span className="label">目标成绩</span>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="3:00 或 3:05:37" />
            <span className="hint">格式：3:00 = 3 小时；185:37 = 3:05:37</span>
          </label>
          <label className="stat">
            <span className="label">路线来源</span>
            <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as RouteMode)}>
              <option value="none">先不填路线（之后可补）</option>
              <option value="file">上传 / 粘贴轨迹文件（实测海拔）</option>
              <option value="lib">内置路书库（DEM 估算）</option>
            </select>
          </label>
        </div>

        {routeMode === "file" && (
          <div className="stat" style={{ display: "block", marginBottom: 10 }}>
            {formMode === "edit" && detail && detail.race.routeSource === "gpx" && (
              <div className="banner info" style={{ marginBottom: 10, lineHeight: 1.7 }}>
                <strong>这场比赛已经有一份轨迹文件。</strong>
                {detail.profile && (
                  <>
                    {" "}当前这份：
                    {detail.profile.distanceKm != null ? `${detail.profile.distanceKm} km ／ ` : ""}
                    {detail.profile.gainM} m 爬升 ／ {detail.profile.profile?.length ?? 0} 个剖面点
                    {detail.profile.eleMin != null
                      ? ` ／ 海拔 ${detail.profile.eleMin}–${detail.profile.eleMax} m`
                      : ""}
                    。
                  </>
                )}
                {fileNameFromNote(detail.race.sourceNote) && (
                  <>来源文件：{fileNameFromNote(detail.race.sourceNote)}。</>
                )}
                {/KML/.test(detail.race.sourceNote ?? "") ? "格式：KML 轨迹。" : "格式：GPX。"}
                <br />
                <span style={{ color: "var(--text-dim)" }}>
                  库里只存了抽稀后的剖面（最多 900 个点），原始文件没有入库，所以这里回显不了全文。
                  <strong>什么都不选直接保存 = 保留现在这份</strong>；
                  选了新文件或粘了新内容 = 用它覆盖。
                </span>
              </div>
            )}
            <span className="label">导入轨迹文件</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label className="pill" style={{ cursor: "pointer" }}>
                选择文件…
                <input
                  type="file"
                  accept=".gpx,.kml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void readRouteFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {routeFileName && (
                <span style={{ fontSize: 12.5 }}>已选：<strong>{routeFileName}</strong></span>
              )}
              {previewing && <span className="hint">正在核对文件…</span>}
            </div>
            <div className="hint" style={{ marginTop: 6, lineHeight: 1.7 }}>
              <strong>两步路里怎么导：</strong>打开那条轨迹 → 导出 → 格式选「<strong>GPX格式</strong>」→
              得到一个 .gpx 文件（一条轨迹一个文件）→ 回到这里选中它。
              GPX 每个点都带实测海拔，是算爬升最准的一种。
            </div>

            {preview && preview.ok && (
              <div className="banner info" style={{ marginTop: 8, lineHeight: 1.7 }}>
                已解析：{preview.distanceKm} km ／ 累计爬升 {preview.gainM} m ／{" "}
                {preview.pointCount} 个点
                {preview.profilePointCount && preview.profilePointCount !== preview.pointCount
                  ? `（剖面图画 ${preview.profilePointCount} 个点）`
                  : ""}
                <br />
                海拔来源：{preview.kind === "kml" ? "KML 轨迹" : "GPX 实测"}（±5-10m）
                {preview.coarseSpacing && preview.sampleSpacingM ? (
                  <>
                    <br />
                    <strong style={{ color: "var(--warn, #d9a441)" }}>
                      这份轨迹采样较稀（平均每点 {preview.sampleSpacingM} 米）
                    </strong>
                    <br />
                    起伏落在采样点之间就丢了，上面的爬升很可能偏低。
                    能导出更密的轨迹最好（手表调到 1 秒或实时模式）。
                  </>
                ) : (
                  ""
                )}
                {dist && Number(dist) > 0 && preview.distanceKm != null &&
                  (() => {
                    const drift = Math.abs(preview.distanceKm - Number(dist)) / Number(dist);
                    if (drift <= 0.005) return null;
                    const big = drift > 0.05;
                    return (
                      <>
                        <br />
                        <span style={{ color: "var(--warn)" }}>
                          ⚠ 文件距离与官方距离差 {(drift * 100).toFixed(1)}%。
                          {big
                            ? `这已经「不是」 GPS 漂移能解释的范围（通常 ±0.5% 以内）——` +
                              `多半是选错了轨迹，比如导了另一天的记录，或只导了其中一段。` +
                              `请确认这个文件对应当天那一场再保存。`
                            : `属于 GPS 漂移的常见范围。`}
                          这里填的仍按官方距离 {dist} km 计算，剖面图的横轴用文件自己的距离。
                        </span>
                      </>
                    );
                  })()}
              </div>
            )}
            {preview && !preview.ok && (
              <div className="banner error" style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {preview.error}
              </div>
            )}

            <label className="stat" style={{ display: "block", marginTop: 10 }}>
              <span className="label">或粘贴 GPX / KML 内容</span>
              <textarea
                value={gpxText}
                onChange={(e) => onPasteChange(e.target.value)}
                placeholder={
                  formMode === "edit" && detail && detail.race.routeSource === "gpx"
                    ? "粘贴新的轨迹内容会覆盖现在这份。不粘贴就是保留。"
                    : "手机上只有文本、或者要排查解析问题时，可以直接把文件内容粘到这里"
                }
                style={{ minHeight: 90, fontFamily: "ui-monospace, monospace", fontSize: 11 }}
              />
              <span className="hint">
                文件框与粘贴框写的是同一份内容，谁先填谁生效。
                {formMode === "edit" && detail && detail.race.routeSource === "gpx" && gpxText.trim().length === 0 &&
                  "（这场赛事已有轨迹文件，不选新文件直接保存会保留原来的。）"}
              </span>
            </label>
          </div>
        )}

        {routeMode === "none" && (
          <div className="hint" style={{ margin: "0 0 10px", lineHeight: 1.7 }}>
            先把赛事登记下来就好，路线之后随时能补 ——
            到时候在卡片右上角点「上传轨迹文件」，或点「修改」回到这里导入。
            现在不填路线不影响其它功能，只是不会有赛道剖面与爬升。
          </div>
        )}

        {routeMode === "lib" && (
          <div className="stat" style={{ display: "block", marginBottom: 10 }}>
            <span className="label">路线来源</span>
            <div className="hint" style={{ marginTop: 5, lineHeight: 1.6 }}>
              保存时按<strong>赛事全名 + 日期</strong>去内置路线库查找，不会按城市匹配 ——
              同一城市可能有多场不同赛事（主赛事 / 另一场同名系列赛），按城市找必然选错。<br />
              本项目的内置库<strong>默认为空</strong>（刻意不预置任何赛事路线），
              所以这一项通常会报错，并给出「自己导入轨迹文件」的指引。<br />
              找不到就明确报错，不会拿同城其它赛事的路线顶替。
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="sync-btn" style={{ maxWidth: 160 }} onClick={() => void save()} disabled={busy}>
            {busy ? "保存中…" : formMode === "create" ? "创建赛事" : "保存修改"}
          </button>
          <button className="sync-btn" style={{ maxWidth: 120 }} onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      </div>
    );
  }

  if (loading && !detail) {
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
        <button className="sync-btn" style={{ marginTop: 10, maxWidth: 200 }} onClick={openCreateForm}>
          + 添加赛事
        </button>
        {open && renderForm()}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      {/* 顶部赛事切换器与操作栏 */}
      <div className="race-selector-bar">
        <div className="race-selector-left">
          <div className="race-selector-header">
            <span style={{ fontSize: 13, color: "var(--text-dim)", whiteSpace: "nowrap" }}>目标赛事：</span>
            <button
              type="button"
              className="pill accent mobile-only-btn"
              onClick={openCreateForm}
              style={{ cursor: "pointer", border: "none", fontWeight: 600 }}
            >
              + 添加赛事
            </button>
          </div>
          <select
            className="race-selector-select"
            value={detail.race.id}
            onChange={(e) => void selectRace(Number(e.target.value))}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            {allRaces.map((r) => {
              const isPast = r.date < todayBeijing();
              return (
                <option key={r.id} value={r.id}>
                  {r.date} · {r.name} ({r.distanceKm}km){isPast ? " (往期)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <button
          type="button"
          className="pill accent desktop-only-btn"
          onClick={openCreateForm}
          style={{ cursor: "pointer", border: "none", fontWeight: 600, flexShrink: 0 }}
        >
          + 添加赛事
        </button>
      </div>

      {/* 当前选中的具体赛事标题与操作（仅保留修改与删除，轨迹导入统一在修改表单中操作） */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 0 6px", borderTop: "1px solid var(--border)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="card-title" style={{ marginBottom: 2, wordBreak: "break-word" }}>{detail.race.name}</h3>
          <p className="card-sub" style={{ margin: 0 }}>
            {detail.race.date} · {detail.race.distanceKm} km
            {detail.race.goalSec ? ` · 目标 ${fmtDurInput(detail.race.goalSec)}` : ""}
          </p>
          {/* 未填路线要显式标出来：不标的话用户看到"没有剖面图"会以为功能坏了 */}
          {detail.race.routeSource === "none" && (
            <span className="pill" style={{ display: "inline-block", marginTop: 6, fontSize: 11 }}>
              未填路线 · 爬升还没算
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="pill" onClick={openEditForm} style={{ cursor: "pointer", border: "none", background: "none" }}>
            修改
          </button>
          <button
            className="pill"
            onClick={() => { if (confirm(`删除「${detail.race.name}」这场赛事设定？`)) void remove(); }}
            style={{ cursor: "pointer", border: "none", background: "none", color: "var(--warn)" }}
          >
            删除
          </button>
        </div>
      </div>

      {err && <div className="banner error" style={{ marginTop: 10 }}>{err}</div>}
      {busy && <div className="banner info" style={{ marginTop: 10 }}>处理中…</div>}

      {open && renderForm()}

      <RouteProfileCard d={detail} />

      {briefing ? (
        <RaceBriefingCard d={briefing} onChanged={() => loadBriefing(briefing.race.id)} />
      ) : (
        <div className="spin" style={{ display: "block", margin: "18px 0" }} />
      )}
    </div>
  );

}
