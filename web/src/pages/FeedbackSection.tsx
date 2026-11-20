import { useState, useMemo } from "react";
import { IconChat } from "../icons";
import { useClipboard } from "../utils/clipboard";
import { ExternalLink } from "../openExternal";
import { useI18n } from "../i18n";

const FEEDBACK_ENDPOINT = "https://useful-peacock-7115.captainlegoo.deno.net/";

type FeedbackType = "bug" | "feature" | "question";

export default function FeedbackSection({
  appVersion,
  status,
}: {
  appVersion: string;
  status?: any;
}) {
  const { isZh } = useI18n();
  const feedbackTypes: { id: FeedbackType; label: string; prefix: string; hint: string }[] = useMemo(() => [
    { id: "bug", label: isZh ? "🐛 问题反馈 (Bug)" : "🐛 Issue (Bug)", prefix: "[Bug]", hint: isZh ? "描述问题现象、操作步骤或异常提示" : "Describe the problem, steps to reproduce, or error messages" },
    { id: "feature", label: isZh ? "💡 功能建议 (Feature)" : "💡 Suggestion (Feature)", prefix: "[建议]", hint: isZh ? "描述你希望增加的新图表、指标或体验改进" : "Describe new charts, metrics, or UX improvements you'd like" },
    { id: "question", label: isZh ? "🏃 使用与交流 (Question)" : "🏃 Discussion (Question)", prefix: "[交流]", hint: isZh ? "跑步数据算法、心率区间或指标计算疑问" : "Questions about running algorithms, HR zones, or metrics" },
  ], [isZh]);

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
    const osInfo = typeof navigator !== "undefined" ? navigator.userAgent : "Unknown OS";
    const counts = status?.counts || {};
    const lines = [
      `- PaceCraft Version: \`${appVersion}\``,
      `- OS / Env: \`${osInfo}\``,
      `- Total Activities: ${counts.activities ?? 0}`,
      `- Total Laps: ${counts.laps ?? 0}`,
      `- Load Days: ${counts.loadDays ?? 0}`,
      `- Latest Activity: ${status?.latestActivityDate || "None"}`,
      `- COROS Connected: ${status?.hasCorosAuth ? "Yes" : "No"}`,
      `- Timestamp: ${new Date().toLocaleString(isZh ? "zh-CN" : "en-US")}`,
    ];
    return lines.join("\n");
  }, [appVersion, status, isZh]);

  const handleCopyDiagnostics = () => {
    copyDiag(`### PaceCraft Diagnostics\n${diagnostics}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg(null);

    const typeObj = feedbackTypes.find((t) => t.id === type) || feedbackTypes[0];
    const finalTitle = title.trim()
      ? `${typeObj.prefix} ${title.trim()}`
      : `${typeObj.prefix} ${isZh ? "来自跑友的反馈" : "Runner Feedback"} (${new Date().toLocaleDateString(isZh ? "zh-CN" : "en-US")})`;

    let fullBody = content.trim();
    if (includeDiagnostics) {
      fullBody += `\n\n---\n### Runtime Diagnostics\n${diagnostics}`;
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
          contact: contact.trim() || (isZh ? "未填写" : "None"),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSuccessResult({ issueUrl: data.issueUrl });
      setTitle("");
      setContent("");
      setContact("");
    } catch (err: any) {
      setErrorMsg(err.message || (isZh ? "提交失败，请检查网络或稍后重试" : "Submission failed. Please check your network."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 className="card-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <IconChat size={14} /> {isZh ? "反馈与建议" : "Feedback & Suggestions"}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn sm"
            onClick={handleCopyDiagnostics}
            title={isZh ? "一键复制系统运行诊断信息（不含隐私），方便在微信群或社群粘贴" : "Copy diagnostic info to clipboard"}
          >
            {copiedDiag ? (isZh ? "✓ 已复制" : "✓ Copied") : (isZh ? "📋 复制诊断" : "📋 Copy Diagnostics")}
          </button>
          <ExternalLink
            href="https://github.com/captainLegoo/PaceCraft/issues"
            className="btn sm"
            title={isZh ? "在浏览器中直接查看 GitHub Issues 讨论与代码进展" : "View GitHub Issues"}
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
            <span>✓</span> {isZh ? "反馈已成功送达 GitHub Issues！" : "Feedback submitted successfully to GitHub Issues!"}
          </div>
          <div style={{ color: "var(--text)", fontSize: 12, marginBottom: 10 }}>
            {isZh ? "感谢支持。若留下了联系方式，问题解决后将第一时间通知您。" : "Thank you for your feedback. We will look into it promptly."}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {successResult.issueUrl && (
              <ExternalLink
                href={successResult.issueUrl}
                className="btn sm primary"
                style={{ textDecoration: "none" }}
              >
                {isZh ? "查看 Issue 详情 ↗" : "View Issue ↗"}
              </ExternalLink>
            )}
            <button
              type="button"
              className="btn sm"
              onClick={() => setSuccessResult(null)}
            >
              {isZh ? "再写一条" : "Submit Another"}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="feedback-form">
          {/* 反馈类型切换 */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {feedbackTypes.map((t) => {
              const active = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`feedback-type-btn ${active ? "active" : ""}`}
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
              placeholder={isZh ? `概括主题（选填，如：${feedbackTypes.find((t) => t.id === type)?.hint}）` : `Topic title (optional: ${feedbackTypes.find((t) => t.id === type)?.hint})`}
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
              placeholder={isZh ? "详细描述具体情况、复现步骤或新功能建议...（必填）" : "Describe the details, reproduction steps, or suggestions... (required)"}
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
              placeholder={isZh ? "联系方式（选填：微信号 / 邮箱 / GitHub ID）" : "Contact info (optional: Email / GitHub ID)"}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              disabled={submitting}
              maxLength={80}
            />
          </div>

          {/* 环境诊断信息勾选 */}
          <div className="feedback-diag-box">
            <div className="feedback-diag-row">
              <label className="feedback-diag-label">
                <input
                  type="checkbox"
                  checked={includeDiagnostics}
                  onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                  disabled={submitting}
                  style={{ width: "auto", margin: 0, flexShrink: 0 }}
                />
                <span>
                  {isZh ? "附带运行诊断信息" : "Include runtime diagnostics"}
                  <span className="feedback-diag-sub">{isZh ? "（版本/OS/数据量，不含隐私）" : " (Version/OS/counts, no private tokens)"}</span>
                </span>
              </label>
              {includeDiagnostics && (
                <button
                  type="button"
                  className="feedback-diag-btn"
                  onClick={() => setShowDiagnosticsPreview(!showDiagnosticsPreview)}
                >
                  {showDiagnosticsPreview ? (isZh ? "收起" : "Hide") : (isZh ? "预览" : "Preview")}
                </button>
              )}
            </div>

            {includeDiagnostics && showDiagnosticsPreview && (
              <pre className="feedback-diag-pre">
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
              <span>{isZh ? `提交失败：${errorMsg}` : `Submission failed: ${errorMsg}`}</span>
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
                  <span>{isZh ? "提交中…" : "Submitting..."}</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>{isZh ? "提交反馈" : "Submit Feedback"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
