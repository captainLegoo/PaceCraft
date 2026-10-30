import { useState, useMemo } from "react";
import { IconChat } from "../icons";
import { useClipboard } from "../utils/clipboard";
import { ExternalLink } from "../openExternal";

const FEEDBACK_ENDPOINT = "https://useful-peacock-7115.captainlegoo.deno.net/";

type FeedbackType = "bug" | "feature" | "question";

const FEEDBACK_TYPES: { id: FeedbackType; label: string; prefix: string; hint: string }[] = [
  { id: "bug", label: "🐛 问题反馈 (Bug)", prefix: "[Bug]", hint: "描述问题现象、操作步骤或异常提示" },
  { id: "feature", label: "💡 功能建议 (Feature)", prefix: "[建议]", hint: "描述你希望增加的新图表、指标或体验改进" },
  { id: "question", label: "🏃 使用与交流 (Question)", prefix: "[交流]", hint: "跑步数据算法、心率区间或指标计算疑问" },
];

export default function FeedbackSection({
  appVersion,
  status,
}: {
  appVersion: string;
  status?: any;
}) {
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [showDiagnosticsPreview, setShowDiagnosticsPreview] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<{ issueUrl?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { copy: copyDiag, copied: copiedDiag } = useClipboard();

  // 生成环境诊断信息摘要（绝不包含 Token、密码等隐私）
  const diagnostics = useMemo(() => {
    const osInfo = typeof navigator !== "undefined" ? navigator.userAgent : "未知环境";
    const counts = status?.counts || {};
    const lines = [
      `- PaceCraft 版本: \`${appVersion}\``,
      `- 操作系统 / 环境: \`${osInfo}\``,
      `- 本地活动记录总数: ${counts.activities ?? 0} 条`,
      `- 分圈数据记录: ${counts.laps ?? 0} 条`,
      `- 训练负荷天数: ${counts.loadDays ?? 0} 天`,
      `- 最近活动日期: ${status?.latestActivityDate || "无"}`,
      `- 高驰授权状态: ${status?.hasCorosAuth ? "已连接" : "未连接"}`,
      `- 提交时间: ${new Date().toLocaleString("zh-CN")}`,
    ];
    return lines.join("\n");
  }, [appVersion, status]);

  const handleCopyDiagnostics = () => {
    copyDiag(`### PaceCraft 诊断信息\n${diagnostics}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg(null);

    const typeObj = FEEDBACK_TYPES.find((t) => t.id === type) || FEEDBACK_TYPES[0];
    const finalTitle = title.trim()
      ? `${typeObj.prefix} ${title.trim()}`
      : `${typeObj.prefix} 来自跑友的反馈 (${new Date().toLocaleDateString("zh-CN")})`;

    let fullBody = content.trim();
    if (includeDiagnostics) {
      fullBody += `\n\n---\n### 运行环境诊断报告\n${diagnostics}`;
    }

    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: finalTitle,
          content: fullBody,
          version: appVersion,
          contact: contact.trim() || "未填写",
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `请求异常 (HTTP ${res.status})`);
      }

      setSuccessResult({ issueUrl: data.issueUrl });
      setTitle("");
      setContent("");
      setContact("");
    } catch (err: any) {
      setErrorMsg(err.message || "提交失败，请检查网络或稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 className="card-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <IconChat size={14} /> 反馈与建议
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn sm"
            onClick={handleCopyDiagnostics}
            title="一键复制系统运行诊断信息（不含隐私），方便在微信群或社群粘贴"
          >
            {copiedDiag ? "✓ 已复制" : "📋 复制诊断"}
          </button>
          <ExternalLink
            href="https://github.com/captainLegoo/PaceCraft/issues"
            className="btn sm"
            title="在浏览器中直接查看 GitHub Issues 讨论与代码进展"
          >
            Issues ↗
          </ExternalLink>
        </div>
      </div>

      {successResult ? (
        <div
          style={{
            background: "var(--good-bg)",
            border: "1px solid var(--good-border)",
            borderRadius: "var(--radius)",
            padding: "14px 16px",
            color: "var(--good-text)",
            fontSize: 12.5,
            lineHeight: 1.6,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span>✓</span> 反馈已成功送达 GitHub Issues！
          </div>
          <div style={{ color: "var(--text)", fontSize: 12, marginBottom: 10 }}>
            感谢支持。若留下了联系方式，问题解决后将第一时间通知您。
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {successResult.issueUrl && (
              <ExternalLink
                href={successResult.issueUrl}
                className="btn sm primary"
                style={{ textDecoration: "none" }}
              >
                查看 Issue 详情 ↗
              </ExternalLink>
            )}
            <button
              type="button"
              className="btn sm"
              onClick={() => setSuccessResult(null)}
            >
              再写一条
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          {/* 反馈类型切换 */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FEEDBACK_TYPES.map((t) => {
              const active = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 16,
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    background: active ? "var(--accent)" : "var(--surface-2)",
                    color: active ? "var(--accent-ink)" : "var(--text)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* 标题输入 */}
          <div>
            <input
              type="text"
              placeholder={`概括主题（选填，例如：${FEEDBACK_TYPES.find((t) => t.id === type)?.hint}）`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
              maxLength={100}
            />
          </div>

          {/* 内容输入 */}
          <div style={{ flex: 1, minHeight: 70 }}>
            <textarea
              rows={3}
              required
              placeholder="详细描述具体情况、复现步骤或新功能建议...（必填）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={submitting}
              style={{
                lineHeight: 1.5,
                resize: "vertical",
                minHeight: 65,
                height: "100%",
              }}
            />
          </div>

          {/* 联系方式 */}
          <div>
            <input
              type="text"
              placeholder="联系方式（选填：微信号 / 邮箱 / GitHub ID，方便后续跟进）"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              disabled={submitting}
              maxLength={80}
            />
          </div>

          {/* 环境诊断信息勾选 */}
          <div
            style={{
              background: "var(--surface-2)",
              borderRadius: 6,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              fontSize: 11.5,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--text-dim)" }}>
                <input
                  type="checkbox"
                  checked={includeDiagnostics}
                  onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                  disabled={submitting}
                  style={{ width: "auto", margin: 0 }}
                />
                <span>自动附带运行诊断信息（版本、OS、数据量，不含隐私）</span>
              </label>
              {includeDiagnostics && (
                <button
                  type="button"
                  className="btn sm"
                  style={{ padding: "1px 6px", fontSize: 11 }}
                  onClick={() => setShowDiagnosticsPreview(!showDiagnosticsPreview)}
                >
                  {showDiagnosticsPreview ? "收起" : "预览"}
                </button>
              )}
            </div>

            {includeDiagnostics && showDiagnosticsPreview && (
              <pre
                style={{
                  margin: "4px 0 0 0",
                  padding: "6px 8px",
                  borderRadius: 4,
                  background: "var(--bg)",
                  color: "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  border: "1px solid var(--border)",
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {diagnostics}
              </pre>
            )}
          </div>

          {/* 错误提示 */}
          {errorMsg && (
            <div
              style={{
                background: "var(--bad-bg)",
                border: "1px solid var(--bad-border)",
                color: "var(--bad-text)",
                padding: "6px 10px",
                borderRadius: "var(--radius)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>⚠️</span>
              <span>提交失败：{errorMsg}</span>
            </div>
          )}

          {/* 操作按钮栏 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button
              type="submit"
              className="btn primary"
              disabled={submitting || !content.trim()}
              style={{ minWidth: 90, justifyContent: "center" }}
            >
              {submitting ? (
                <>
                  <span className="spin" />
                  <span>提交中…</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>提交反馈</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
