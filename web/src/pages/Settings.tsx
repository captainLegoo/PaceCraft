import { useEffect, useState } from "react";
import { api, type SyncSportsPayload } from "../api";
import { IconDatabase, IconGear, IconHeart, IconSync } from "../icons";

const PRESETS = [
  { name: "OpenAI 兼容", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", provider: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "Kimi / 月之暗面", provider: "openai", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "通义千问", provider: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Anthropic", provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
];

export default function Settings({ onStatus }: { onStatus: () => void }) {
  const [cfg, setCfg] = useState<any>({
    provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "",
    model: "gpt-4o-mini", temperature: 0.7, maxTokens: 8000,
  });
  const [status, setStatus] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDays, setSyncDays] = useState(120);

  // 同步哪些运动类型：编码表由服务端下发，这里只存选中的 code
  const [sports, setSports] = useState<SyncSportsPayload | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [sportsMsg, setSportsMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [sportsSaving, setSportsSaving] = useState(false);

  // 心率档案：maxHr / restingHr 可空（空 = 交回自动推算）
  const [hr, setHr] = useState<{
    maxHr: number | null; restingHr: number | null;
    observedMaxHr?: number;
    zones: { zone: string; label: string; hrLo: number; hrHi: number; pctLabel: string }[];
    saving?: boolean; msg?: { kind: "ok" | "error"; text: string } | null;
  }>({ maxHr: null, restingHr: null, zones: [] });

  /** 读档案 + 从当前数据推算的 HRmax + 生效中的区间边界 */
  const loadHr = async () => {
    try {
      const p = await api.profile();
      setHr((h) => ({ ...h, maxHr: p?.maxHr ?? null, restingHr: p?.restingHr ?? null }));
      // 用任意一次有分段的训练取回当前区间，让用户看到自己填的值产生了什么结果
      const acts = await api.activities({ limit: "1" });
      if (acts.length > 0) {
        const detail = await api.activity(acts[0].labelId);
        setHr((h) => ({
          ...h,
          zones: detail.zones?.zones ?? [],
          observedMaxHr: detail.zones?.maxHr,
        }));
      }
    } catch { /* 还没同步过数据时忽略 */ }
  };

  const saveHr = async () => {
    setHr((h) => ({ ...h, saving: true, msg: null }));
    try {
      await api.saveHrProfile({ maxHr: hr.maxHr, restingHr: hr.restingHr });
      await loadHr();
      setHr((h) => ({ ...h, msg: { kind: "ok", text: "已保存。所有心率区间会按新值重算。" } }));
      onStatus();
    } catch (e) {
      setHr((h) => ({ ...h, msg: { kind: "error", text: (e as Error).message } }));
    } finally {
      setHr((h) => ({ ...h, saving: false }));
    }
  };

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    api.aiSettings().then((s) => {
      if (s.configured) setCfg((c: any) => ({ ...c, ...s }));
    }).catch(() => {});
    api.syncSports().then((s) => {
      setSports(s);
      setPicked(s.selected);
    }).catch(() => {});
    loadHr();
  }, []);

  /** 切换一个运动类型 */
  const toggleSport = (code: number) =>
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  /** 按分组全选 / 清空 */
  const setGroup = (types: { code: number }[], on: boolean) =>
    setPicked((p) => {
      const codes = types.map((t) => t.code);
      const rest = p.filter((c) => !codes.includes(c));
      return on ? [...rest, ...codes] : rest;
    });

  const saveSports = async () => {
    setSportsSaving(true);
    setSportsMsg(null);
    try {
      const r = await api.saveSyncSports(picked);
      setPicked(r.codes);
      setSportsMsg({
        kind: "ok",
        text: `已保存：下次同步会拉取 ${r.codes.length} 种运动类型。现在点「立即同步」就会把历史记录补回来。`,
      });
      onStatus();
    } catch (e) {
      setSportsMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSportsSaving(false);
    }
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.saveAiSettings(cfg);
      setMsg({ kind: "ok", text: "已保存。之后在任意一次训练的详情页点「开始分析」即可。" });
      onStatus();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally { setSaving(false); }
  };

  const doSync = async () => {
    setSyncing(true); setMsg(null);
    try {
      const r = await api.sync(syncDays);
      setMsg({
        kind: r.errors?.length ? "error" : "ok",
        text:
          `同步完成：${r.activities} 次活动、${r.details} 条详情、${r.lapRows} 行分圈、${r.loadDays} 天负荷、${r.healthDays} 天健康、${r.sleepDays} 天睡眠。` +
          (r.errors?.length ? ` 有 ${r.errors.length} 个错误：${r.errors.slice(0, 3).join("；")}` : "") +
          ` FIT 配额剩余 ${r.fitQuotaLeft}/50。`,
      });
      onStatus();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally { setSyncing(false); }
  };

  const applyPreset = (p: typeof PRESETS[number]) =>
    setCfg((c: any) => ({ ...c, provider: p.provider, baseUrl: p.baseUrl, model: p.model }));

  return (
    <>
      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title"><IconGear size={14} />AI 模型</h3>
          <p className="card-sub">
            任意 OpenAI 兼容接口或 Anthropic 均可。配置只保存在本机 SQLite，不会外传。
          </p>

          <div className="hint" style={{ marginBottom: 12 }}>快速填入</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {PRESETS.map((p) => (
              <button key={p.name} className="btn sm" onClick={() => applyPreset(p)}>{p.name}</button>
            ))}
          </div>

          <label className="field">
            <span>接口协议</span>
            <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}>
              <option value="openai">OpenAI 兼容（/chat/completions）</option>
              <option value="anthropic">Anthropic（/v1/messages）</option>
            </select>
          </label>

          <label className="field">
            <span>Base URL</span>
            <input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
            <div className="hint">
              {cfg.provider === "openai"
                ? "需包含到 /v1 这一层，程序会自动拼 /chat/completions"
                : "填到域名即可，程序会自动拼 /v1/messages"}
            </div>
          </label>

          <label className="field">
            <span>API Key</span>
            <input
              type="password" value={cfg.apiKey} autoComplete="off"
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
              placeholder={status?.aiConfigured ? "已保存（留空则不修改）" : "sk-..."}
            />
          </label>

          <label className="field">
            <span>模型名</span>
            <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder="gpt-4o-mini" />
          </label>

          <div className="grid g2">
            <label className="field">
              <span>温度</span>
              <input type="number" step="0.1" value={cfg.temperature} onChange={(e) => setCfg({ ...cfg, temperature: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>最大输出 token</span>
              <input type="number" step="500" value={cfg.maxTokens} onChange={(e) => setCfg({ ...cfg, maxTokens: Number(e.target.value) })} />
              <div className="hint">
                用推理模型（如 agnes / o-series / 带 thinking 的模型）时至少给 8000：
                它们的「思考」和「正文」共用这一个预算，思考烧光了正文就是空的。
              </div>
            </label>
          </div>

          <button className="btn primary" onClick={save} disabled={saving || !cfg.apiKey || !cfg.baseUrl || !cfg.model}>
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>

        <div>
          {/* 心率档案：分区边界的唯一来源，必须让用户自己填 */}
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title"><IconHeart size={14} />心率档案</h3>
            <p className="card-sub">
              心率区间的边界由这两个值算出来（按储备心率 HRR 百分比）。
              同样 140 bpm，对静息 49 的人是有氧中段，对静息 75 的人已经是高强度 ——
              所以这里必须是你自己的数值，而不是某个通用常数。
            </p>
            <div className="grid g2">
              <label className="field">
                <span>实测最大心率</span>
                <input
                  type="number" value={hr.maxHr ?? ""} placeholder="留空 = 自动推算"
                  onChange={(e) => setHr({ ...hr, maxHr: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <div className="hint">
                  留空则从你的历史分圈推算（只取高强度且持续够久的分圈），再兜底到 Tanaka 公式
                  {hr.observedMaxHr ? <>。当前数据推算值约 <strong>{hr.observedMaxHr}</strong></> : null}
                </div>
              </label>
              <label className="field">
                <span>实测静息心率</span>
                <input
                  type="number" value={hr.restingHr ?? ""} placeholder="留空 = 用 55"
                  onChange={(e) => setHr({ ...hr, restingHr: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <div className="hint">
                  早晨未起床时测量的那种。这个值是 HRR 的分母，<strong>对分区结果影响最大</strong>。
                  留空则用生理中位数 55。
                </div>
              </label>
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              当前生效区间：
              {hr.zones.length > 0 ? (
                <> {hr.zones.map((z) => `${z.zone} ${z.hrLo}–${z.hrHi}`).join("　")}</>
              ) : "（保存后显示）"}
            </div>
            <button className="btn primary" onClick={saveHr} disabled={hr.saving}>
              {hr.saving ? "保存中…" : "保存心率档案"}
            </button>
            {hr.msg && (
              <div className={`banner ${hr.msg.kind === "ok" ? "info" : "error"}`} style={{ marginTop: 12, marginBottom: 0 }}>
                {hr.msg.text}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title"><IconSync size={14} />数据同步</h3>
            <p className="card-sub">
              COROS 没有提供推送通知，只能主动拉取。建议每天或每次训练后手动同步一次。
            </p>

            <div className="hint" style={{ marginBottom: 6 }}>同步哪些运动类型</div>
            <p className="card-sub" style={{ marginBottom: 10 }}>
              决定「立即同步」会拉回哪些训练。没勾选的类别即使手表上有记录也不会出现在看板里 ——
              之前版本把这份名单写死在代码里，只认跑步，室内有氧之类的会被丢掉。
            </p>

            {sports && (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="hint" style={{ marginTop: 0 }}>
                    已选 <strong>{picked.length}</strong> 项
                    {picked.length !== sports.selected.length && "（未保存）"}
                  </span>
                  <button className="sport-link" onClick={() => setPicked(sports.defaults)}>恢复默认</button>
                  <button className="sport-link" onClick={() => setPicked([])}>清空</button>
                </div>

                {sports.groups.map((g) => {
                  const allOn = g.types.every((t) => picked.includes(t.code));
                  return (
                    <div className="sport-group" key={g.key}>
                      <div className="sport-group-head">
                        <span className="sport-group-name">{g.label}</span>
                        <button className="sport-link" onClick={() => setGroup(g.types, !allOn)}>
                          {allOn ? "清空" : "全选"}
                        </button>
                      </div>
                      <div className="sport-chips">
                        {g.types.map((t) => (
                          <button
                            key={t.code}
                            className={`sport-chip ${picked.includes(t.code) ? "on" : ""}`}
                            onClick={() => toggleSport(t.code)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <button
                  className="btn primary"
                  onClick={saveSports}
                  disabled={sportsSaving || picked.length === 0}
                  style={{ marginTop: 4 }}
                >
                  {sportsSaving ? "保存中…" : "保存运动类型"}
                </button>
                {picked.length === 0 && (
                  <div className="hint" style={{ color: "var(--warn-text)" }}>至少要选一种，否则同步不到任何数据。</div>
                )}
                {sportsMsg && (
                  <div className={`banner ${sportsMsg.kind === "ok" ? "info" : "error"}`} style={{ marginTop: 12, marginBottom: 0 }}>
                    {sportsMsg.text}
                  </div>
                )}
                <div className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
                  勾选只影响<strong>之后</strong>的同步，不会删除库里已有的记录。
                  骑行和游泳虽然也能勾，但本看板的配速/坡度图表按跑步口径画，
                  混进来数字意义有限 —— 所以默认没勾。
                </div>
              </>
            )}

            <div className="hint" style={{ margin: "18px 0 6px" }}>回溯天数</div>
            <label className="field">
              <input type="number" value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))} />
              <div className="hint">活动多时同步耗时较长（拉取分圈是主要开销），首次建议设小一点。</div>
            </label>
            <button className="btn" onClick={doSync} disabled={syncing}>
              {syncing ? <><span className="spin" /> 同步中，约需 1–2 分钟…</> : "立即同步"}
            </button>
            {msg && (
              <div className={`banner ${msg.kind === "ok" ? "info" : "error"}`} style={{ marginTop: 14, marginBottom: 0 }}>
                {msg.text}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="card-title"><IconDatabase size={14} />当前数据状态</h3>
            <p className="card-sub">
              {status?.lastSync
                ? `上次同步：${new Date(status.lastSync.startedAt * 1000).toLocaleString("zh-CN")}（${status.lastSync.status === "ok" ? "成功" : "有错误"}）`
                : "尚未同步过"}
            </p>
            {status && (
              <table>
                <tbody>
                  <tr><td>活动记录</td><td className="num">{status.counts.activities}</td></tr>
                  <tr><td>分圈数据</td><td className="num">{status.counts.laps}</td></tr>
                  <tr><td>训练负荷</td><td className="num">{status.counts.loadDays} 天</td></tr>
                  <tr><td>每日健康</td><td className="num">{status.counts.healthDays} 天</td></tr>
                  <tr><td>睡眠记录</td><td className="num">{status.counts.sleepDays} 天</td></tr>
                  <tr><td>最近训练</td><td className="num">{status.latestActivityDate ?? "—"}</td></tr>
                  <tr><td>AI 模型</td><td>{status.aiConfigured ? <span className="pill good">已配置</span> : <span className="pill">未配置</span>}</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">关于数据来源</h3>
        <p className="card-sub">本看板所有数据均来自 COROS 官方 MCP（mcp.coros.com，中国区），未使用任何非官方接口。</p>
        <ul style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.9, paddingLeft: 18, margin: 0 }}>
          <li>授权通过 OAuth 2.0 动态客户端注册 + PKCE 完成，无需审批，token 仅存本机。</li>
          <li>概览类接口返回的是可读文本、时序类返回 JSON，解析层已针对两者分别处理并用真实数据校验。</li>
          <li>分圈距离原始单位为厘米，已在多次活动上与记录距离交叉验证一致。</li>
          <li>心率区间由本看板按 Tanaka 公式推算（COROS 未提供分区字段），不是官方数据。</li>
          <li>FIT 原始文件每天限 50 次下载，当前看板不自动拉取，仅在你需要时再考虑。</li>
        </ul>
      </div>
    </>
  );
}
