import { useEffect, useState } from "react";
import { api, type SyncProgress, type SyncSportsPayload } from "../api";
import { formatElapsed } from "../utils/format";
import { useClipboard } from "../utils/clipboard";
import { IconDatabase, IconGear, IconHeart, IconSync } from "../icons";
import WorkflowPanel from "./WorkflowPanel";
import { useCorosAuth } from "../use-coros-auth";
import { DEFAULT_APP_VERSION } from "../version";
import { openExternal, ExternalLink } from "../openExternal";

export type PopularModel = {
  model: string;
  label: string;
  desc?: string;
  tag?: string;
};

export type ProviderPreset = {
  id: string;
  name: string;
  group: "featured" | "domestic" | "global" | "local";
  provider: "openai" | "anthropic";
  baseUrl: string;
  defaultModel: string;
  popularModels: PopularModel[];
  docUrl?: string;
  docLabel?: string;
  apiKeyHint?: string;
  defaultApiKey?: string;
};

const PROVIDER_GROUPS = [
  { key: "featured", label: "🌟 推荐热门平台" },
  { key: "domestic", label: "🇨🇳 国内主流大模型平台" },
  { key: "global", label: "🌐 国际主流大模型平台" },
  { key: "local", label: "💻 本地与自定义部署" },
] as const;

const PROVIDERS: ProviderPreset[] = [
  // --- 推荐热门 ---
  {
    id: "deepseek",
    name: "DeepSeek (深度求索 · 官方)",
    group: "featured",
    provider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    popularModels: [
      { model: "deepseek-chat", label: "DeepSeek-V3", desc: "高性价比首选 · 综合能力卓越", tag: "推荐" },
      { model: "deepseek-reasoner", label: "DeepSeek-R1", desc: "深度长链推理与反思", tag: "深度思考" },
    ],
    docUrl: "https://platform.deepseek.com",
    docLabel: "DeepSeek 开放平台",
  },
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow · 极速聚合)",
    group: "featured",
    provider: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    popularModels: [
      { model: "deepseek-ai/DeepSeek-V3", label: "DeepSeek-V3", desc: "极速稳定 · 极高性价比", tag: "高性价" },
      { model: "deepseek-ai/DeepSeek-R1", label: "DeepSeek-R1", desc: "深度思考推理", tag: "深度思考" },
      { model: "Pro/deepseek-ai/DeepSeek-V3", label: "DeepSeek-V3 Pro", desc: "企业高可用专线" },
      { model: "Pro/deepseek-ai/DeepSeek-R1", label: "DeepSeek-R1 Pro", desc: "企业推理专线" },
      { model: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen2.5 72B", desc: "通义千问开源旗舰" },
    ],
    docUrl: "https://cloud.siliconflow.cn",
    docLabel: "硅基流动控制台",
    apiKeyHint: "国内热门大模型托管平台，新用户常有赠送 Token",
  },
  {
    id: "qwen",
    name: "阿里云百炼 (通义千问 Qwen)",
    group: "featured",
    provider: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    popularModels: [
      { model: "qwen-plus", label: "Qwen Plus", desc: "能力均衡全面 · 主力推荐", tag: "推荐" },
      { model: "qwen-max", label: "Qwen Max", desc: "千问旗舰大模型 · 复杂推理", tag: "旗舰" },
      { model: "qwen-turbo", label: "Qwen Turbo", desc: "响应极速 · 超低成本" },
      { model: "deepseek-r1", label: "百炼 DeepSeek-R1", desc: "阿里云官方托管 R1" },
      { model: "deepseek-v3", label: "百炼 DeepSeek-V3", desc: "阿里云官方托管 V3" },
      { model: "qwen2.5-72b-instruct", label: "Qwen2.5 72B", desc: "开源旗舰底座" },
    ],
    docUrl: "https://bailian.console.aliyun.com",
    docLabel: "阿里云百炼平台",
  },
  {
    id: "zhipu",
    name: "智谱 AI (GLM-4 / 智谱清言)",
    group: "featured",
    provider: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    popularModels: [
      { model: "glm-4-flash", label: "GLM-4 Flash", desc: "官方免费调用 · 响应极快", tag: "免费" },
      { model: "glm-4-plus", label: "GLM-4 Plus", desc: "智谱旗舰大模型 · 综合逻辑强", tag: "旗舰" },
      { model: "glm-4-air", label: "GLM-4 Air", desc: "高性价比极速版" },
      { model: "glm-4-long", label: "GLM-4 Long", desc: "100万长上下文支持" },
    ],
    docUrl: "https://open.bigmodel.cn",
    docLabel: "智谱大模型开放平台",
    apiKeyHint: "GLM-4-Flash 永久免费，零门槛轻松体验",
  },

  // --- 国内主流平台 ---
  {
    id: "kimi",
    name: "月之暗面 (Kimi / Moonshot)",
    group: "domestic",
    provider: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    popularModels: [
      { model: "moonshot-v1-8k", label: "Moonshot 8K", desc: "标准长上下文", tag: "推荐" },
      { model: "moonshot-v1-32k", label: "Moonshot 32K", desc: "中长上下文" },
      { model: "kimi-k1.5-preview", label: "Kimi k1.5", desc: "多模态思考推理预览版", tag: "思考" },
    ],
    docUrl: "https://platform.moonshot.cn",
    docLabel: "Moonshot 开放平台",
  },
  {
    id: "doubao",
    name: "字节火山引擎 (豆包 Doubao)",
    group: "domestic",
    provider: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1.5-pro-32k",
    popularModels: [
      { model: "doubao-1.5-pro-32k", label: "Doubao 1.5 Pro", desc: "豆包旗舰主力模型", tag: "推荐" },
      { model: "doubao-1.5-lite-32k", label: "Doubao 1.5 Lite", desc: "轻量极速模型" },
      { model: "doubao-pro-32k", label: "Doubao Pro 32K", desc: "经典专业版" },
    ],
    docUrl: "https://console.volcengine.com/ark",
    docLabel: "火山引擎方舟控制台",
    apiKeyHint: "模型名称可填官方模型名或控制台接入点 Endpoint ID (ep-xxxx)",
  },
  {
    id: "minimax",
    name: "MiniMax (海螺 AI 开放平台)",
    group: "domestic",
    provider: "openai",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    popularModels: [
      { model: "MiniMax-Text-01", label: "MiniMax-Text-01", desc: "400万超长文本新一代旗舰", tag: "旗舰" },
      { model: "abab6.5s-chat", label: "abab 6.5s", desc: "轻量高性价比" },
    ],
    docUrl: "https://platform.minimaxi.com",
    docLabel: "MiniMax 开放平台",
  },
  {
    id: "lingyi",
    name: "零一万物 (01.AI / Yi)",
    group: "domestic",
    provider: "openai",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-lightning",
    popularModels: [
      { model: "yi-lightning", label: "Yi Lightning", desc: "千亿参数超快推理旗舰", tag: "推荐" },
      { model: "yi-large", label: "Yi Large", desc: "通用能力大模型" },
      { model: "yi-medium", label: "Yi Medium", desc: "经济快速版" },
    ],
    docUrl: "https://platform.lingyiwanwu.com",
    docLabel: "零一万物开放平台",
  },
  {
    id: "qianfan",
    name: "百度千帆 (文心大模型 ERNIE)",
    group: "domestic",
    provider: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-turbo-8k",
    popularModels: [
      { model: "ernie-4.0-turbo-8k", label: "ERNIE 4.0 Turbo", desc: "百度文心旗舰", tag: "旗舰" },
      { model: "ernie-3.5-8k", label: "ERNIE 3.5", desc: "经典高性价比" },
      { model: "deepseek-r1", label: "千帆 DeepSeek-R1", desc: "千帆托管 R1" },
      { model: "deepseek-v3", label: "千帆 DeepSeek-V3", desc: "千帆托管 V3" },
    ],
    docUrl: "https://console.bce.baidu.com/qianfan",
    docLabel: "百度千帆控制台",
  },
  {
    id: "hunyuan",
    name: "腾讯混元 (Tencent Hunyuan)",
    group: "domestic",
    provider: "openai",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-standard",
    popularModels: [
      { model: "hunyuan-standard", label: "混元 Standard", desc: "通用标准版", tag: "推荐" },
      { model: "hunyuan-pro", label: "混元 Pro", desc: "混元旗舰版", tag: "旗舰" },
      { model: "hunyuan-turbo", label: "混元 Turbo", desc: "极速低延迟" },
    ],
    docUrl: "https://cloud.tencent.com/product/hunyuan",
    docLabel: "腾讯云混元控制台",
  },

  // --- 国际主流平台 ---
  {
    id: "openai",
    name: "OpenAI (官方 / ChatGPT)",
    group: "global",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    popularModels: [
      { model: "gpt-4o-mini", label: "GPT-4o mini", desc: "轻快高性价比 · 跑友首选", tag: "推荐" },
      { model: "gpt-4o", label: "GPT-4o", desc: "全能多模态旗舰", tag: "旗舰" },
      { model: "o3-mini", label: "o3-mini", desc: "最新高性价比强推理", tag: "深度推理" },
      { model: "o1", label: "o1", desc: "前沿通用慢思考推理" },
    ],
    docUrl: "https://platform.openai.com",
    docLabel: "OpenAI Platform",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude 官方)",
    group: "global",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-7-sonnet-latest",
    popularModels: [
      { model: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet", desc: "混合推理与深度思考最新旗舰", tag: "最新旗舰" },
      { model: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", desc: "业界标杆旗舰大模型" },
      { model: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", desc: "轻量快速高性价比" },
    ],
    docUrl: "https://console.anthropic.com",
    docLabel: "Anthropic Console",
  },
  {
    id: "gemini",
    name: "Google Gemini (Google AI Studio)",
    group: "global",
    provider: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    popularModels: [
      { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "兼顾深度思考与极速响应", tag: "推荐" },
      { model: "gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "顶级复杂分析推理旗舰", tag: "旗舰" },
      { model: "gemini-2.0-flash", label: "Gemini 2.0 Flash", desc: "低延迟极速生成" },
      { model: "gemini-1.5-pro", label: "Gemini 1.5 Pro", desc: "百万长上下文" },
    ],
    docUrl: "https://aistudio.google.com",
    docLabel: "Google AI Studio",
    apiKeyHint: "Google AI Studio 提供充沛的免费调用额度，通过兼容接口直连",
  },
  {
    id: "openrouter",
    name: "OpenRouter (全球模型聚合路由)",
    group: "global",
    provider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat",
    popularModels: [
      { model: "deepseek/deepseek-chat", label: "DeepSeek V3", desc: "OpenRouter 托管路由", tag: "推荐" },
      { model: "deepseek/deepseek-r1", label: "DeepSeek R1", desc: "OpenRouter R1 深度推理" },
      { model: "anthropic/claude-3.7-sonnet", label: "Claude 3.7", desc: "聚合充值免海外绑卡" },
      { model: "openai/gpt-4o-mini", label: "GPT-4o mini", desc: "高性价比" },
      { model: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", desc: "超低单价" },
      { model: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", desc: "开源旗舰" },
    ],
    docUrl: "https://openrouter.ai",
    docLabel: "OpenRouter 平台",
    apiKeyHint: "单 API Key 自由调用全球数百款大模型",
  },
  {
    id: "groq",
    name: "Groq (全球极速 LPU 推理)",
    group: "global",
    provider: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    popularModels: [
      { model: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", desc: "每秒近 300 token 闪电回复", tag: "极速" },
      { model: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 70B", desc: "R1 蒸馏极速推理" },
      { model: "llama-3.1-8b-instant", label: "Llama 3.1 8B", desc: "瞬时超低延迟" },
    ],
    docUrl: "https://console.groq.com",
    docLabel: "Groq Console",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    group: "global",
    provider: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2-latest",
    popularModels: [
      { model: "grok-2-latest", label: "Grok 2", desc: "xAI 旗舰主力模型", tag: "旗舰" },
      { model: "grok-beta", label: "Grok Beta", desc: "测试体验版" },
    ],
    docUrl: "https://console.x.ai",
    docLabel: "xAI 控制台",
  },
  {
    id: "mistral",
    name: "Mistral AI (欧洲顶尖旗舰)",
    group: "global",
    provider: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    popularModels: [
      { model: "mistral-large-latest", label: "Mistral Large", desc: "Mistral 旗舰全能大模型", tag: "旗舰" },
      { model: "mistral-small-latest", label: "Mistral Small", desc: "轻量高性价比" },
      { model: "codestral-latest", label: "Codestral", desc: "结构化数据与代码逻辑特化" },
    ],
    docUrl: "https://console.mistral.ai",
    docLabel: "Mistral Platform",
  },

  // --- 本地与自建 ---
  {
    id: "ollama",
    name: "Ollama (本地私有大模型 · 离线)",
    group: "local",
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "deepseek-r1:latest",
    popularModels: [
      { model: "deepseek-r1:latest", label: "deepseek-r1", desc: "本地运行 DeepSeek R1", tag: "离线推理" },
      { model: "qwen2.5:latest", label: "qwen2.5", desc: "本地通义千问 2.5", tag: "离线" },
      { model: "llama3.3:latest", label: "llama3.3", desc: "本地 Llama 3.3", tag: "离线" },
    ],
    docUrl: "https://ollama.com",
    docLabel: "Ollama 官网",
    apiKeyHint: "本地运行保护隐私无需联网。默认无需密钥，API Key 可填任意字符（如 ollama）",
    defaultApiKey: "ollama",
  },
  {
    id: "custom",
    name: "自定义平台 / OneAPI / NewAPI / 其它中转",
    group: "local",
    provider: "openai",
    baseUrl: "",
    defaultModel: "",
    popularModels: [],
  },
];

function detectProviderId(baseUrl: string, provider: string): string {
  if (!baseUrl) return "custom";
  const b = baseUrl.toLowerCase();
  if (b.includes("deepseek.com")) return "deepseek";
  if (b.includes("siliconflow.cn")) return "siliconflow";
  if (b.includes("aliyuncs.com") || b.includes("dashscope")) return "qwen";
  if (b.includes("bigmodel.cn")) return "zhipu";
  if (b.includes("moonshot.cn")) return "kimi";
  if (b.includes("volces.com") || b.includes("volcengine")) return "doubao";
  if (b.includes("minimax.chat") || b.includes("minimaxi")) return "minimax";
  if (b.includes("lingyiwanwu.com")) return "lingyi";
  if (b.includes("baidubce.com") || b.includes("qianfan")) return "qianfan";
  if (b.includes("hunyuan.cloud.tencent.com") || b.includes("tencent.com")) return "hunyuan";
  if (provider === "anthropic" || b.includes("anthropic.com")) return "anthropic";
  if (b.includes("generativelanguage.googleapis.com")) return "gemini";
  if (b.includes("openrouter.ai")) return "openrouter";
  if (b.includes("groq.com")) return "groq";
  if (b.includes("api.x.ai")) return "xai";
  if (b.includes("mistral.ai")) return "mistral";
  if (b.includes("localhost:11434") || b.includes("127.0.0.1:11434") || b.includes(":11434")) return "ollama";
  if (b.includes("openai.com")) return "openai";
  return "custom";
}

export default function Settings({
  onStatus,
  hasNewUpdate = false,
  onCheckUpdate,
}: {
  onStatus: () => void;
  hasNewUpdate?: boolean;
  onCheckUpdate?: () => void;
}) {
  const {
    auth,
    loading: authLoading,
    connecting: authConnecting,
    authUrl,
    msg: authMsg,
    connect: connectCoros,
    disconnect: disconnectCoros,
    cancel: cancelCoros,
    openBrowser: openCorosBrowser,
  } = useCorosAuth(
    () => {
      onStatus();
      api.status().then(setStatus).catch(() => {});
    },
    () => {
      onStatus();
      api.status().then(setStatus).catch(() => {});
    }
  );

  const [cfg, setCfg] = useState<any>({
    provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "",
    model: "gpt-4o-mini", temperature: 0.7, maxTokens: 8000,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [providerTab, setProviderTab] = useState<"featured" | "domestic" | "global" | "local">("featured");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("deepseek");
  const [status, setStatus] = useState<any>(null);
  const { copy: copyAuthUrl, copied: copiedAuthUrl } = useClipboard();
  const appVersion = status?.version || DEFAULT_APP_VERSION;
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [aiMsg, setAiMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncDays, setSyncDays] = useState(365);
  const [dataDir, setDataDir] = useState<string>("");
  const [wiping, setWiping] = useState(false);
  const [showWipeBox, setShowWipeBox] = useState(false);
  const [wipeInput, setWipeInput] = useState("");
  const [wipeError, setWipeError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

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
      if (s.configured) {
        setCfg((c: any) => ({ ...c, ...s }));
        const pid = detectProviderId(s.baseUrl, s.provider);
        setSelectedProviderId(pid);
        const p = PROVIDERS.find((item) => item.id === pid);
        if (p?.group) setProviderTab(p.group);
      }
    }).catch(() => {});
    api.syncSports().then((s) => {
      setSports(s);
      setPicked(s.selected);
    }).catch(() => {});
    loadHr();
    api.systemDataInfo().then((info) => setDataDir(info.rootDataDir)).catch(() => {});
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

  const handleConfirmWipe = async () => {
    if (wipeInput.trim() !== "WIPE") return;
    setWiping(true);
    setWipeError(null);
    try {
      await api.wipeAllData();
      window.location.reload();
    } catch (err: any) {
      setWipeError(err?.message || "未知错误");
      setWiping(false);
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
    const timer = setInterval(async () => {
      try {
        const p = await api.syncProgress();
        setSyncProgress(p);
        if (!p.active) {
          clearInterval(timer);
        }
      } catch {}
    }, 500);

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
    } finally {
      clearInterval(timer);
      setSyncing(false);
      setTimeout(() => setSyncProgress(null), 3000);
    }
  };

  const onSelectProvider = (pid: string) => {
    setSelectedProviderId(pid);
    const found = PROVIDERS.find((p) => p.id === pid);
    if (!found) return;
    setProviderTab(found.group);
    if (found.id === "custom") {
      setShowAdvanced(true);
      setCfg((c: any) => ({
        ...c,
        provider: c.provider || "openai",
        baseUrl: detectProviderId(c.baseUrl, c.provider) !== "custom" ? "" : c.baseUrl,
      }));
      return;
    }
    setCfg((c: any) => ({
      ...c,
      provider: found.provider,
      baseUrl: found.baseUrl,
      model: found.defaultModel || c.model,
      apiKey: (found.id === "ollama" && !c.apiKey) ? "ollama" : c.apiKey,
    }));
  };

  const currentProviderId = selectedProviderId;
  const currentProvider = PROVIDERS.find((p) => p.id === currentProviderId) || PROVIDERS[PROVIDERS.length - 1];
  const isLocalEndpoint = /localhost|127\.0\.0\.1|11434/.test(cfg.baseUrl || "");
  const canSubmit = !saving && !testing && (cfg.apiKey || status?.aiConfigured || isLocalEndpoint) && !!cfg.baseUrl && !!cfg.model;

  return (
    <>
      <div className="grid g2" style={{ alignItems: "start", marginBottom: 14 }}>
        {/* 左列：AI 模型配置 + 心率档案 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
              <h3 className="card-title" style={{ marginBottom: 0 }}>
                <IconGear size={14} /> AI 教练模型
              </h3>
              {status?.aiConfigured ? (
                <span className="pill good" style={{ fontSize: 11, fontWeight: 500 }}>
                  已就绪 · {cfg.model || "已配置"}
                </span>
              ) : (
                <span className="pill" style={{ fontSize: 11, fontWeight: 500 }}>未配置</span>
              )}
            </div>
            <p className="card-sub" style={{ margin: "2px 0 12px" }}>
              配置 AI 模型用于训练场次深度复盘、周报评析与赛事备战推演。已预置主流国内外模型平台与高频配置。
            </p>

            {/* 1. 服务商平台选择（分类卡片 + 快捷网格，避免长下拉框） */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg)" }}>服务商平台</span>
                {/* 紧凑下拉备选：方便快速直接切换 */}
                <select
                  value={currentProviderId}
                  onChange={(e) => onSelectProvider(e.target.value)}
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--muted)",
                    maxWidth: 160,
                    cursor: "pointer",
                  }}
                  title="也可以从下拉列表中直接切换"
                >
                  {PROVIDER_GROUPS.map((grp) => (
                    <optgroup key={grp.key} label={grp.label}>
                      {PROVIDERS.filter((p) => p.group === grp.key).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* 分类选项卡 */}
              <div style={{ display: "flex", gap: 5, marginBottom: 8, overflowX: "auto", paddingBottom: 2 }}>
                {PROVIDER_GROUPS.map((grp) => {
                  const isTabActive = providerTab === grp.key;
                  const hasSelectedHere = currentProvider?.group === grp.key;
                  return (
                    <button
                      key={grp.key}
                      type="button"
                      onClick={() => setProviderTab(grp.key)}
                      style={{
                        cursor: "pointer",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: isTabActive ? 600 : 400,
                        border: isTabActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                        background: isTabActive ? "rgba(14, 165, 233, 0.12)" : "var(--surface-2)",
                        color: isTabActive ? "var(--accent)" : "var(--muted)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span>{grp.label}</span>
                      {hasSelectedHere && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--accent)",
                            display: "inline-block",
                          }}
                          title="当前选中的平台在此分类"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {providerTab === "global" && (
                <div style={{ marginBottom: 8, padding: "6px 10px", background: "var(--surface-2)", borderRadius: 6, fontSize: 11.5, color: "var(--muted)", border: "1px solid var(--border)" }}>
                  🌐 <strong>数据出境提示</strong>：选用境外大模型平台时，训练指标数据将由您的设备直接发送至对应境外服务商，请确认您知悉并同意其数据隐私政策。
                </div>
              )}

              {/* 当前分类下的服务商按钮网格 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(138px, 1fr))",
                  gap: 6,
                }}
              >
                {PROVIDERS.filter((p) => p.group === providerTab).map((p) => {
                  const isSelected = currentProviderId === p.id;
                  const shortName = p.name.split(" (")[0];
                  const subText = p.name.includes(" (") ? p.name.slice(p.name.indexOf(" (") + 2, -1) : "";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectProvider(p.id)}
                      style={{
                        cursor: "pointer",
                        textAlign: "left",
                        padding: "7px 9px",
                        borderRadius: 7,
                        border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                        background: isSelected ? "rgba(14, 165, 233, 0.12)" : "var(--surface-2)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        position: "relative",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: isSelected ? 600 : 500,
                            color: isSelected ? "var(--accent)" : "var(--fg)",
                            lineHeight: 1.2,
                          }}
                        >
                          {shortName}
                        </span>
                        {isSelected && (
                          <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 700 }}>✓</span>
                        )}
                      </div>
                      {subText && (
                        <span
                          style={{
                            fontSize: 10.5,
                            color: isSelected ? "var(--accent)" : "var(--muted)",
                            opacity: 0.85,
                            lineHeight: 1.15,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {subText}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 若选中自定义平台，直接在此展开清晰的 Base URL 与协议设置 */}
            {currentProviderId === "custom" && (
              <div
                style={{
                  marginTop: -2,
                  marginBottom: 12,
                  padding: "12px",
                  background: "var(--surface-2)",
                  borderRadius: 8,
                  border: "1.5px solid var(--accent)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}>
                  <span>⚙️</span> 自定义平台 / OneAPI / NewAPI / 其它中转接口配置
                </div>
                <label className="field" style={{ margin: 0 }}>
                  <span>接口协议</span>
                  <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}>
                    <option value="openai">OpenAI 兼容（/chat/completions）</option>
                    <option value="anthropic">Anthropic（/v1/messages）</option>
                  </select>
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span>Base URL（必填）</span>
                  <input
                    value={cfg.baseUrl}
                    onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                    placeholder="例如 https://api.your-proxy.com/v1"
                    autoFocus
                  />
                  <div className="hint" style={{ marginTop: 3 }}>
                    {cfg.provider === "openai"
                      ? "需包含到 /v1 这一层（如 https://api.your-proxy.com/v1），程序会自动拼 /chat/completions"
                      : "填到域名即可，程序会自动拼 /v1/messages"}
                  </div>
                </label>
              </div>
            )}

            {/* 服务商快捷指引 */}
            {currentProvider && (currentProvider.docUrl || currentProvider.apiKeyHint) && (
              <div
                style={{
                  marginTop: -2,
                  marginBottom: 10,
                  fontSize: 11.5,
                  color: "var(--muted)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  lineHeight: 1.4,
                }}
              >
                {currentProvider.docUrl && (
                  <ExternalLink
                    href={currentProvider.docUrl}
                    style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
                  >
                    🔗 获取 API Key（{currentProvider.docLabel || "平台控制台"}）↗
                  </ExternalLink>
                )}
                {currentProvider.apiKeyHint && (
                  <span>· {currentProvider.apiKeyHint}</span>
                )}
              </div>
            )}

            {/* 2. API Key */}
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={cfg.apiKey}
                autoComplete="off"
                onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                placeholder={
                  currentProvider?.id === "ollama"
                    ? "本地 Ollama 无需鉴权（可留空或填 ollama）"
                    : status?.aiConfigured
                    ? "已保存（留空则保持不变）"
                    : "请输入 API Key"
                }
              />
            </label>

            {/* 3. 模型名 + 热门快捷选择 */}
            <label className="field" style={{ marginBottom: 4 }}>
              <span>模型名称</span>
              <input
                list="ai-model-datalist"
                value={cfg.model}
                onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                placeholder="例如 deepseek-chat、qwen-plus 或 gpt-4o-mini"
              />
              <datalist id="ai-model-datalist">
                {currentProvider?.popularModels?.map((pm) => (
                  <option key={pm.model} value={pm.model}>
                    {pm.label} {pm.desc ? `(${pm.desc})` : ""}
                  </option>
                ))}
              </datalist>
            </label>

            {/* 热门预置模型一键填入 */}
            {currentProvider?.popularModels && currentProvider.popularModels.length > 0 && (
              <div style={{ marginTop: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
                  热门推荐模型（点击一键选择）：
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {currentProvider.popularModels.map((pm) => {
                    const active = cfg.model === pm.model;
                    return (
                      <button
                        key={pm.model}
                        type="button"
                        onClick={() => setCfg({ ...cfg, model: pm.model })}
                        style={{
                          cursor: "pointer",
                          fontSize: 12,
                          padding: "4px 9px",
                          borderRadius: 6,
                          border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                          background: active ? "rgba(14, 165, 233, 0.14)" : "var(--surface-2)",
                          color: active ? "var(--accent)" : "var(--fg)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontWeight: active ? 600 : 400,
                          transition: "all 0.15s ease",
                        }}
                        title={pm.desc ? `${pm.model} · ${pm.desc}` : pm.model}
                      >
                        <span>{pm.label}</span>
                        {pm.tag && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 4px",
                              borderRadius: 3,
                              background: active ? "var(--accent)" : "var(--border)",
                              color: active ? "#fff" : "var(--muted)",
                              fontWeight: 500,
                              lineHeight: 1.1,
                            }}
                          >
                            {pm.tag}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 高级选项折叠器：供修改 Base URL、协议、温度与最大 Token */}
            <div style={{ marginTop: 4, marginBottom: 14 }}>
              <button
                type="button"
                className="pill"
                style={{
                  cursor: "pointer",
                  fontSize: 11.5,
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  padding: "4px 0",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span>{showAdvanced ? "▾ 收起自定义接口与高级参数（Base URL / 协议 / Token 预算）" : "▸ 展开自定义接口与高级参数（Base URL / 协议 / Token 预算）"}</span>
              </button>

              {showAdvanced && (
                <div style={{ marginTop: 8, padding: "12px", background: "var(--surface-2)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--border)" }}>
                  {currentProviderId !== "custom" && (
                    <>
                      <label className="field" style={{ margin: 0 }}>
                        <span>接口协议</span>
                        <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}>
                          <option value="openai">OpenAI 兼容（/chat/completions）</option>
                          <option value="anthropic">Anthropic（/v1/messages）</option>
                        </select>
                      </label>

                      <label className="field" style={{ margin: 0 }}>
                        <span>Base URL</span>
                        <input
                          value={cfg.baseUrl}
                          onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                        />
                        <div className="hint" style={{ marginTop: 3 }}>
                          {cfg.provider === "openai"
                            ? "需包含到 /v1 这一层，程序会自动拼 /chat/completions"
                            : "填到域名即可，程序会自动拼 /v1/messages"}
                        </div>
                      </label>
                    </>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label className="field" style={{ margin: 0 }}>
                      <span>温度 (Temperature)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={cfg.temperature ?? 0.7}
                        onChange={(e) => setCfg({ ...cfg, temperature: parseFloat(e.target.value) || 0.7 })}
                      />
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span>最大输出 Token</span>
                      <input
                        type="number"
                        step="1000"
                        min="1000"
                        max="64000"
                        value={cfg.maxTokens ?? 8000}
                        onChange={(e) => setCfg({ ...cfg, maxTokens: parseInt(e.target.value, 10) || 8000 })}
                      />
                    </label>
                  </div>
                  <div className="hint">
                    提示：像 DeepSeek-R1、OpenAI o1/o3-mini 等推理模型，内置思考过程与正文共用 Token 预算，建议保留 ≥8000。
                  </div>
                </div>
              )}
            </div>

            {/* 操作按键与连接测试 */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                className="btn primary"
                onClick={save}
                disabled={!canSubmit}
              >
                {saving ? "保存中…" : "保存配置"}
              </button>
              <button
                className="btn"
                onClick={testAi}
                disabled={!canSubmit}
              >
                {testing ? <><span className="spin" /> 测试连接中…</> : "测试连接"}
              </button>
            </div>

            {aiMsg && (
              <div className={`banner ${aiMsg.kind === "ok" ? "info" : "error"}`} style={{ marginTop: 12, marginBottom: 0 }}>
                {aiMsg.text}
              </div>
            )}
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
          {/* COROS 账号绑定卡片 */}
          <div className="card">
            <h3 className="card-title">
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: auth?.connected ? "#10b981" : "#f59e0b", marginRight: 6 }} />
              COROS 账号连接
              {status?.profile && (
                <span style={{ fontSize: 11, fontWeight: "normal", color: "var(--text-dim)", marginLeft: 8 }}>
                  (档案: {status.profile.nickname && status.profile.nickname !== status.profile.name ? `${status.profile.name}（${status.profile.nickname}）` : status.profile.name})
                </span>
              )}
            </h3>
            <p className="card-sub">
              通过高驰官方 OAuth 2.0 PKCE 协议连接。授权凭证只保存在你本地电脑，不经过任何第三方服务器。
            </p>
            {authMsg && (
              <div className={`sync-msg ${authMsg.kind}`} style={{ marginBottom: 10 }}>
                {authMsg.text}
              </div>
            )}
            {auth?.connected ? (
              <div style={{ background: "var(--bg-subtle, rgba(255,255,255,0.03))", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>高驰昵称：{auth.nickname || "已绑定（未拉取昵称）"}</span>
                  <span style={{ fontSize: 11, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12 }}>● 正常连接</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  Token 有效期至：{auth.expiresAt ? new Date(auth.expiresAt * 1000).toLocaleString("zh-CN") : "长期有效（自动续期）"}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn-secondary" onClick={connectCoros} disabled={authConnecting} style={{ fontSize: 12, padding: "5px 12px" }}>
                    {authConnecting ? "正在打开授权页面…" : "重新授权"}
                  </button>
                  {!confirmingDisconnect ? (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => setConfirmingDisconnect(true)}
                      disabled={authLoading}
                      style={{ fontSize: 12, padding: "5px 12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, cursor: "pointer" }}
                    >
                      解除绑定
                    </button>
                  ) : (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)" }}>
                      <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 500 }}>确定解除？</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await disconnectCoros();
                          setConfirmingDisconnect(false);
                        }}
                        disabled={authLoading}
                        style={{ fontSize: 11.5, padding: "3px 8px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                      >
                        {authLoading ? "解绑中…" : "确认解绑"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDisconnect(false)}
                        disabled={authLoading}
                        style={{ fontSize: 11.5, padding: "3px 6px", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ background: "rgba(245,158,11,0.06)", padding: "14px", borderRadius: 8, border: "1px dashed #f59e0b", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>
                  当前尚未连接 COROS 账号
                </div>
                <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                  连接后可直接拉取历史跑步数据、心率、分圈及体能负荷指标。
                </p>
                {!authConnecting ? (
                  <button
                    type="button"
                    onClick={connectCoros}
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    🔗 一键连接 COROS 账号
                  </button>
                ) : (
                  <div style={{ background: "var(--bg-subtle, rgba(0,0,0,0.2))", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12.5, fontWeight: 500, color: "#60a5fa" }}>
                      <span className="spinner" style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #60a5fa", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                      正在等待浏览器完成授权…
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={openCorosBrowser}
                        style={{ fontSize: 12, padding: "4px 10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                      >
                        🌐 在浏览器中打开
                      </button>
                      {authUrl && (
                        <button
                          type="button"
                          onClick={() => copyAuthUrl(authUrl)}
                          style={{
                            fontSize: 12,
                            padding: "4px 10px",
                            background: copiedAuthUrl ? "rgba(34, 197, 94, 0.15)" : "var(--surface-2)",
                            color: copiedAuthUrl ? "var(--good)" : "var(--fg)",
                            border: `1px solid ${copiedAuthUrl ? "var(--good)" : "var(--border)"}`,
                            borderRadius: 4,
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                          }}
                        >
                          {copiedAuthUrl ? "✓ 授权链接已复制" : "📋 复制授权链接"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={cancelCoros}
                        style={{ fontSize: 12, padding: "4px 10px", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

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
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              {[
                { label: "近 90 天", days: 90 },
                { label: "近 1 年 (推荐)", days: 365 },
                { label: "近 2 年", days: 730 },
              ].map((b) => (
                <button
                  key={b.days}
                  type="button"
                  className="btn btn-subtle"
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    background: syncDays === b.days ? "var(--accent)" : "var(--surface-2)",
                    color: syncDays === b.days ? "#fff" : "var(--text)",
                    border: `1px solid ${syncDays === b.days ? "var(--accent)" : "var(--border)"}`,
                    fontWeight: syncDays === b.days ? 600 : 400,
                  }}
                  onClick={() => setSyncDays(b.days)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <label className="field">
              <input type="number" value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))} />
              <div className="hint">
                <strong>推荐回溯 365 天（1 年）</strong>：长周期训练数据能自动提取半马、全马等真实比赛作为基准锚点，大幅提升马拉松完赛预测准确度。已存在的训练会自动跳过分圈，不会重复消耗耗时。
              </div>
            </label>

            {syncProgress?.active && (
              <div style={{ margin: "14px 0", padding: "12px 14px", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 6 }}>
                  <span style={{ fontWeight: 500, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="spin" style={{ width: 12, height: 12, borderColor: "var(--accent)" }} />
                    {syncProgress.message}
                    {syncProgress.startedAt && <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>（已用时 {formatElapsed(syncProgress.startedAt)}）</span>}
                  </span>
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>{syncProgress.percent}%</span>
                </div>
                <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(5, syncProgress.percent)}%`, background: "var(--accent)", transition: "width 0.3s ease" }} />
                </div>
              </div>
            )}

            <button className="btn" onClick={doSync} disabled={syncing || !auth?.connected} title={!auth?.connected ? "请先连接 COROS 账号" : undefined}>
              {syncing ? <><span className="spin" /> 同步中 {syncProgress ? `(${syncProgress.percent}%)` : "..."}</> : !auth?.connected ? "请先连接 COROS 账号" : "立即同步"}
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
                  <tr>
                    <td>当前版本</td>
                    <td style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <ExternalLink
                        href="https://github.com/captainLegoo/PaceCraft"
                        className="version-tag"
                        title={`当前版本：${appVersion}（访问 GitHub 仓库）`}
                      >
                        <span className="dot" />
                        <span>{appVersion}</span>
                      </ExternalLink>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          padding: "3px 10px",
                          fontSize: 12,
                          height: "auto",
                          ...(hasNewUpdate
                            ? { color: "var(--accent)", borderColor: "var(--accent)" }
                            : {}),
                        }}
                        onClick={onCheckUpdate}
                      >
                        {hasNewUpdate && (
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              background: "var(--accent)",
                              display: "inline-block",
                            }}
                          />
                        )}
                        <span>{hasNewUpdate ? "发现新版本" : "检查更新"}</span>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <h3 className="card-title" style={{ margin: 0 }}>关于数据来源与系统</h3>
          <ExternalLink
            href="https://github.com/captainLegoo/PaceCraft"
            className="version-tag"
            title="访问 GitHub 仓库"
          >
            <span className="dot" />
            <span>PaceCraft {appVersion}</span>
          </ExternalLink>
        </div>
        <p className="card-sub">本看板所有数据均来自 COROS 官方 MCP（mcp.coros.com，中国区），未使用任何非官方接口。</p>
        <ul style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.9, paddingLeft: 18, margin: 0 }}>
          <li>授权通过 OAuth 2.0 动态客户端注册 + PKCE 完成，无需审批，token 仅存本机。</li>
          <li>概览类接口返回的是可读文本、时序类返回 JSON，解析层已针对两者分别处理并用真实数据校验。</li>
          <li>分圈距离原始单位为厘米，已在多次活动上与记录距离交叉验证一致。</li>
          <li>心率区间由本看板按 Tanaka 公式推算（COROS 未提供分区字段），不是官方数据。</li>
          <li>FIT 原始文件每天限 50 次下载，当前看板不自动拉取，仅在你需要时再考虑。</li>
        </ul>
      </div>

      <div className="card" style={{ borderColor: "rgba(239, 68, 68, 0.35)", marginTop: 14 }}>
        <h3 className="card-title" style={{ color: "var(--bad, #ef4444)" }}>
          <IconDatabase size={14} /> 本地数据管理与安全重置 (Danger Zone)
        </h3>
        <p className="card-sub">
          PaceCraft 采用 100% 本地存储架构，所有运动记录、OAuth 凭证及跑力模型均存放在你的个人电脑主目录下。
        </p>

        <div style={{ background: "var(--surface-2)", padding: "10px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>本地持久化存储根路径：</div>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>{dataDir || "~/.coros-dashboard"}</code>
        </div>

        {!showWipeBox ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", maxWidth: 520, lineHeight: 1.5 }}>
              如需彻底卸载软件、抹除隐私或重置所有跑友档案，点击右侧按钮即可安全清空本地全部数据。
            </div>
            <button
              className="btn"
              onClick={() => { setShowWipeBox(true); setWipeInput(""); setWipeError(null); }}
              disabled={wiping}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "var(--bad, #ef4444)",
                borderColor: "rgba(239, 68, 68, 0.4)",
                fontWeight: 600,
              }}
            >
              清空本地所有档案与数据
            </button>
          </div>
        ) : (
          <div style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            borderRadius: 8,
            padding: "16px",
          }}>
            <div style={{ color: "#ef4444", fontWeight: 600, fontSize: 13.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span>⚠️</span> 【高危操作警告】清空本地所有数据
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
              此操作将彻底删除本机所有跑友档案、SQLite 历史训练数据库与授权凭证，操作完全不可逆！<br />
              如确认彻底抹除，请在下方输入 <strong style={{ color: "#ef4444", fontFamily: "monospace", fontSize: 13 }}>WIPE</strong> 并点击确认：
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="输入 WIPE 确认"
                value={wipeInput}
                onChange={(e) => setWipeInput(e.target.value)}
                disabled={wiping}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 13,
                  width: 150,
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              />
              <button
                className="btn"
                onClick={handleConfirmWipe}
                disabled={wipeInput.trim() !== "WIPE" || wiping}
                style={{
                  background: wipeInput.trim() === "WIPE" ? "#dc2626" : "rgba(239, 68, 68, 0.2)",
                  color: wipeInput.trim() === "WIPE" ? "#fff" : "rgba(255, 255, 255, 0.4)",
                  borderColor: "transparent",
                  fontWeight: 600,
                }}
              >
                {wiping ? <><span className="spin" /> 正在清空…</> : "确认彻底抹除"}
              </button>
              <button
                className="btn btn-subtle"
                onClick={() => { setShowWipeBox(false); setWipeInput(""); setWipeError(null); }}
                disabled={wiping}
              >
                取消
              </button>
            </div>
            {wipeError && (
              <div style={{ marginTop: 10, color: "#ef4444", fontSize: 12 }}>
                抹除失败：{wipeError}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
