import { useEffect, useState } from "react";
import { api, type SyncSportsPayload } from "../api";
import { IconDatabase, IconGear, IconHeart, IconSync } from "../icons";
import WorkflowPanel from "./WorkflowPanel";

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
  const [aiMsg, setAiMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDays, setSyncDays] = useState(120);

  // 同步哪些运动类型：编码表由服务端下发，这里只存选中的 code
  const [sports, setSports] = useState<SyncSportsPayload | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [sportsMsg, setSportsMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [sportsSaving, setSportsSaving] = useState(false);

  type ZoneRow = { zone: string; label: string; hrLo: number | ""; hrHi: number | "" };

  // 心率档案：支持自动推算（HRR）与自定义五区间
  const [hr, setHr] = useState<{
    calcMode: "auto" | "custom";
    maxHr: number | null; restingHr: number | null;
    observedMaxHr?: number;
    effectiveZones: { zone: string; label: string; hrLo: number; hrHi: number | null; pctLabel?: string }[];
    customZones: ZoneRow[];
    method?: string;
    saving?: boolean; msg?: { kind: "ok" | "error"; text: string } | null;
  }>({
    calcMode: "auto",
    maxHr: null,
    restingHr: null,
    effectiveZones: [],
    customZones: [
      { zone: "Z1", label: "有氧耐力", hrLo: "", hrHi: "" },
      { zone: "Z2", label: "有氧动力", hrLo: "", hrHi: "" },
      { zone: "Z3", label: "乳酸阈", hrLo: "", hrHi: "" },
      { zone: "Z4", label: "速度耐力", hrLo: "", hrHi: "" },
      { zone: "Z5", label: "无氧动力", hrLo: "", hrHi: "" },
    ],
  });

  /** 读档案 + 从当前数据推算的 HRmax + 生效中的区间边界 */
  const loadHr = async () => {
    try {
      const p = await api.profile();
      let customZones: ZoneRow[] = [
        { zone: "Z1", label: "有氧耐力", hrLo: "", hrHi: "" },
        { zone: "Z2", label: "有氧动力", hrLo: "", hrHi: "" },
        { zone: "Z3", label: "乳酸阈", hrLo: "", hrHi: "" },
        { zone: "Z4", label: "速度耐力", hrLo: "", hrHi: "" },
        { zone: "Z5", label: "无氧动力", hrLo: "", hrHi: "" },
      ];
      if (p?.customHrZones) {
        try {
          const parsed = JSON.parse(p.customHrZones);
          if (Array.isArray(parsed) && parsed.length >= 5) {
            customZones = parsed.map((item: any, i: number) => ({
              zone: item.zone || customZones[i].zone,
              label: item.label || customZones[i].label,
              hrLo: item.hrLo ?? "",
              hrHi: item.hrHi != null && item.hrHi !== "" && Number(item.hrHi) < 900 ? Number(item.hrHi) : "",
            }));
          }
        } catch {}
      }

      const effective = p?.effectiveZones ?? [];
      // 如果自定义列表里全为空，且有当前推算区间，可把当前推算区间作为自定义的默认预填草稿
      if (customZones.every((z) => z.hrLo === "" && z.hrHi === "") && effective.length >= 5) {
        customZones = effective.map((z: any, idx: number) => ({
          zone: z.zone,
          label: z.label,
          hrLo: z.hrLo ?? "",
          hrHi: idx === 4 && (!z.hrHi || z.hrHi >= 900) ? "" : (z.hrHi ?? ""),
        }));
      }

      setHr((h) => ({
        ...h,
        calcMode: p?.hrCalcMode === "custom" ? "custom" : "auto",
        maxHr: p?.maxHr ?? null,
        restingHr: p?.restingHr ?? null,
        observedMaxHr: p?.observedMaxHr,
        effectiveZones: effective,
        customZones,
        method: p?.hrMethod,
      }));
    } catch { /* 还没同步过数据时忽略 */ }
  };

  const copyEffectiveToCustom = () => {
    if (hr.effectiveZones.length >= 5) {
      const copied: ZoneRow[] = hr.effectiveZones.map((z, idx) => ({
        zone: z.zone,
        label: z.label,
        hrLo: z.hrLo,
        hrHi: idx === 4 && (!z.hrHi || z.hrHi >= 900) ? "" : ((z.hrHi as number | null) ?? ""),
      }));
      setHr((h) => ({ ...h, calcMode: "custom", customZones: copied, msg: null }));
    } else {
      setHr((h) => ({ ...h, calcMode: "custom" }));
    }
  };

  const saveHr = async () => {
    setHr((h) => ({ ...h, saving: true, msg: null }));
    try {
      let customPayload: { zone: string; label: string; hrLo: number; hrHi?: number | null }[] | null = null;
      if (hr.calcMode === "custom") {
        for (let i = 0; i < hr.customZones.length; i++) {
          const z = hr.customZones[i];
          if (z.hrLo === "" || (i < 4 && z.hrHi === "")) {
            throw new Error(`请完整填写 ${z.zone}（${z.label}）的心率上下限`);
          }
        }
        customPayload = hr.customZones.map((z, idx) => ({
          zone: z.zone,
          label: z.label,
          hrLo: Number(z.hrLo),
          hrHi: idx === 4 && z.hrHi === "" ? null : Number(z.hrHi),
        }));
      } else {
        if (hr.customZones.some((z) => z.hrLo !== "")) {
          customPayload = hr.customZones.map((z, idx) => ({
            zone: z.zone,
            label: z.label,
            hrLo: Number(z.hrLo) || 0,
            hrHi: idx === 4 && z.hrHi === "" ? null : (Number(z.hrHi) || 0),
          }));
        }
      }

      await api.saveHrProfile({
        maxHr: hr.maxHr,
        restingHr: hr.restingHr,
        hrCalcMode: hr.calcMode,
        customHrZones: customPayload,
      });
      await loadHr();
      setHr((h) => ({ ...h, msg: { kind: "ok", text: "已保存。所有心率区间会按新配置立即重算生效。" } }));
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
    setSaving(true); setAiMsg(null);
    try {
      await api.saveAiSettings(cfg);
      setAiMsg({ kind: "ok", text: "已保存配置。之后在训练详情页、训练周报与备赛页均可使用 AI 分析。" });
      onStatus();
      api.status().then(setStatus).catch(() => {});
    } catch (e) {
      setAiMsg({ kind: "error", text: (e as Error).message });
    } finally { setSaving(false); }
  };

  const testAi = async () => {
    setTesting(true); setAiMsg(null);
    try {
      const r = await api.testAiSettings(cfg);
      setAiMsg({ kind: "ok", text: `连接成功（耗时 ${r.latencyMs} ms）！模型回复：「${r.reply || "正常"}」` });
    } catch (e) {
      setAiMsg({ kind: "error", text: (e as Error).message });
    } finally { setTesting(false); }
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
      <div className="grid g2" style={{ alignItems: "start", marginBottom: 14 }}>
        {/* 左列：AI 模型配置 + 心率档案 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                  用推理模型（如 deepseek-r1 / o-series / 带 thinking 的模型）时建议给 8000+：
                  它们的「思考」和「正文」共用这一个预算，思考烧光了正文就是空的。
                </div>
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
              <button
                className="btn primary"
                onClick={save}
                disabled={saving || testing || (!cfg.apiKey && !status?.aiConfigured) || !cfg.baseUrl || !cfg.model}
              >
                {saving ? "保存中…" : "保存配置"}
              </button>
              <button
                className="btn"
                onClick={testAi}
                disabled={saving || testing || (!cfg.apiKey && !status?.aiConfigured) || !cfg.baseUrl || !cfg.model}
              >
                {testing ? <><span className="spin" /> 测试连接中…</> : "测试连接"}
              </button>
            </div>

            {aiMsg && (
              <div className={`banner ${aiMsg.kind === "ok" ? "info" : "error"}`} style={{ marginTop: 12, marginBottom: 0 }}>
                {aiMsg.text}
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span>💡 AI 赋能场景</span>
                {status?.aiConfigured ? (
                  <span className="pill good" style={{ fontSize: 11, fontWeight: 500 }}>已就绪</span>
                ) : (
                  <span className="pill" style={{ fontSize: 11, fontWeight: 500 }}>未配置</span>
                )}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li><strong>单次训练深度复盘</strong>：训练详情页分析心率漂移、配速与体能消耗</li>
                <li><strong>周期训练周报解读</strong>：结合负荷比（ACWR）评估疲劳积累与超量恢复</li>
                <li><strong>赛事备战策略推演</strong>：基于历史锚点预测完赛用时与分段配速</li>
              </ul>
            </div>
          </div>

          {/* 心率档案：支持自动推算与直接自定义五区间 */}
          <div className="card">
            <h3 className="card-title"><IconHeart size={14} />心率档案</h3>
            <p className="card-sub">
              心率区间决定了训练场次和周报里的 Z1–Z5 统计。
              支持自动推算（按 HRR 储备百分比），也可以直接自定义绝对心率（可直接照抄 COROS 或手表 App 设置）。
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                className={`pill ${hr.calcMode === "auto" ? "active" : ""}`}
                style={{ cursor: "pointer", fontWeight: hr.calcMode === "auto" ? 600 : 400 }}
                onClick={() => setHr((h) => ({ ...h, calcMode: "auto" }))}
              >
                自动推算（HRR 储备心率）
              </button>
              <button
                type="button"
                className={`pill ${hr.calcMode === "custom" ? "active" : ""}`}
                style={{ cursor: "pointer", fontWeight: hr.calcMode === "custom" ? 600 : 400 }}
                onClick={() => setHr((h) => ({ ...h, calcMode: "custom" }))}
              >
                自定义五区间（可照抄手表设置）
              </button>
            </div>

            {hr.calcMode === "auto" ? (
              <>
                <div className="grid g2" style={{ marginBottom: 10 }}>
                  <label className="field">
                    <span>实测最大心率</span>
                    <input
                      type="number" value={hr.maxHr ?? ""} placeholder="留空 = 自动推算"
                      onChange={(e) => setHr({ ...hr, maxHr: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <div className="hint">
                      留空则从你的历史分圈推算（取高强度分圈峰值中位数），再兜底到 Tanaka 公式
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
                      早晨清醒未起床时的心率。留空则使用生理中位数 55。
                    </div>
                  </label>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className="pill"
                    style={{ fontSize: 12, cursor: "pointer" }}
                    onClick={copyEffectiveToCustom}
                  >
                    📋 将当前推算值复制到自定义区间微调
                  </button>
                </div>
              </>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <div className="hint" style={{ marginBottom: 8, lineHeight: 1.5 }}>
                  填写各个区间的起止心率（bpm），低于 Z1 下限将自动归为「Z0 积极恢复」，Z5 无氧动力默认无上限（直接照抄手表留空即可）：
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Z0 积极恢复：与手表 6 行列表 1:1 对齐，自动跟随 Z1 下限 */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "var(--surface-2)",
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px dashed var(--border)",
                      opacity: 0.85,
                    }}
                  >
                    <span style={{ width: 120, fontSize: 13, fontWeight: 500, color: "var(--text-dim)" }}>
                      <span className="pill" style={{ marginRight: 6, fontSize: 11, background: "var(--surface-3)", color: "var(--text-dim)" }}>Z0</span>
                      积极恢复
                    </span>
                    <span style={{ width: 85, textAlign: "center", fontSize: 13, color: "var(--text-faint)", fontWeight: 500 }}>
                      &lt; {hr.customZones[0]?.hrLo || "—"}
                    </span>
                    <span style={{ color: "var(--text-faint)" }}>~</span>
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      bpm（自动跟随 Z1 下限，无需单独填写）
                    </span>
                  </div>

                  {hr.customZones.map((z, idx) => {
                    const isLast = idx === hr.customZones.length - 1;
                    return (
                      <div
                        key={z.zone}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          background: "var(--surface-2)",
                          padding: "8px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                        }}
                      >
                        <span style={{ width: 120, fontSize: 13, fontWeight: 500 }}>
                          <span className="pill" style={{ marginRight: 6, fontSize: 11 }}>{z.zone}</span>
                          {z.label}
                        </span>
                        <input
                          type="number"
                          style={{ width: 85, textAlign: "center" }}
                          placeholder="下限"
                          value={z.hrLo}
                          onChange={(e) => {
                            const val = e.target.value === "" ? "" : Number(e.target.value);
                            const next = [...hr.customZones];
                            next[idx] = { ...next[idx], hrLo: val };
                            setHr({ ...hr, customZones: next });
                          }}
                        />
                        <span style={{ color: "var(--text-faint)" }}>~</span>
                        {isLast ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="number"
                              style={{ width: 95, textAlign: "center" }}
                              placeholder="无上限"
                              value={z.hrHi}
                              onChange={(e) => {
                                const val = e.target.value === "" ? "" : Number(e.target.value);
                                const next = [...hr.customZones];
                                next[idx] = { ...next[idx], hrHi: val };
                                setHr({ ...hr, customZones: next });
                              }}
                            />
                            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                              bpm（手表「&gt; {z.hrLo || 190}」无上限，留空即可）
                            </span>
                          </div>
                        ) : (
                          <>
                            <input
                              type="number"
                              style={{ width: 85, textAlign: "center" }}
                              placeholder="上限"
                              value={z.hrHi}
                              onChange={(e) => {
                                const val = e.target.value === "" ? "" : Number(e.target.value);
                                const next = [...hr.customZones];
                                next[idx] = { ...next[idx], hrHi: val };
                                if (val !== "" && idx < next.length - 1 && next[idx + 1].hrLo === "") {
                                  next[idx + 1] = { ...next[idx + 1], hrLo: Number(val) + 1 };
                                }
                                setHr({ ...hr, customZones: next });
                              }}
                            />
                            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>bpm</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="hint" style={{ marginBottom: 10 }}>
              当前生效模式：<strong>{hr.method ?? (hr.calcMode === "custom" ? "自定义五区间心率法" : "五区间心率法（HRR）")}</strong>
              {hr.effectiveZones.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: "var(--text-faint)", marginRight: 8 }}>
                    Z0 &lt;{hr.effectiveZones[0]?.hrLo}
                  </span>
                  {hr.effectiveZones.map((z) => `${z.zone} ${z.hrHi && z.hrHi < 900 ? `${z.hrLo}–${z.hrHi}` : `>${z.hrLo}`}`).join("　")}
                </div>
              )}
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

          {/* 自动化工作流：紧凑展示，消除左列留白 */}
          <WorkflowPanel />
        </div>

        {/* 右列：COROS 数据同步 + 当前数据状态 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
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
