import React from "react";
import ExternalLink from "./ExternalLink";

interface MarkdownViewProps {
  content: string;
}

/**
 * 极简轻量级 Markdown 渲染器，专为更新弹窗与说明文档设计。
 * 支持：标题（#、##、###）、列表（-、*）、引用（>）、分割线（---）、加粗（**）、行内代码（`）、外链（[text](url)）
 */
export default function MarkdownView({ content }: MarkdownViewProps) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let quoteBuffer: string[] = [];

  const flushQuote = (key: string) => {
    if (quoteBuffer.length === 0) return;
    const quoteText = quoteBuffer.join("\n");
    quoteBuffer = [];
    elements.push(
      <div
        key={key}
        style={{
          background: "var(--surface-3, rgba(255, 255, 255, 0.04))",
          borderLeft: "3px solid var(--accent)",
          borderRadius: "0 6px 6px 0",
          padding: "7px 10px",
          margin: "8px 0",
          fontSize: 11.5,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        {quoteText.split("\n").map((ql, qi) => (
          <div key={qi} style={{ minHeight: ql ? "auto" : 6 }}>
            {renderInline(ql)}
          </div>
        ))}
      </div>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 引用块处理
    if (trimmed.startsWith(">")) {
      const qText = trimmed.replace(/^>\s?/, "");
      quoteBuffer.push(qText);
      continue;
    } else {
      flushQuote(`quote-${i}`);
    }

    if (!trimmed) {
      continue;
    }

    // 分割线
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(
        <hr
          key={`hr-${i}`}
          style={{
            border: "none",
            borderTop: "1px solid var(--border)",
            margin: "10px 0",
            opacity: 0.8,
          }}
        />
      );
      continue;
    }

    // 标题 ###, ##, #
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const hText = headingMatch[2];
      const fontSize = level === 1 ? 14 : level === 2 ? 13 : 12.5;
      elements.push(
        <div
          key={`h-${i}`}
          style={{
            fontWeight: 600,
            fontSize,
            color: "var(--text)",
            marginTop: elements.length === 0 ? 0 : 10,
            marginBottom: 4,
            letterSpacing: "-0.01em",
          }}
        >
          {renderInline(hText)}
        </div>
      );
      continue;
    }

    // 无序列表 - 或 *
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      const itemText = listMatch[1];
      elements.push(
        <div
          key={`li-${i}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            margin: "2.5px 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text)",
          }}
        >
          <span
            style={{
              color: "var(--accent)",
              userSelect: "none",
              fontSize: 13,
              lineHeight: 1.2,
            }}
          >
            •
          </span>
          <div style={{ flex: 1, wordBreak: "break-word" }}>{renderInline(itemText)}</div>
        </div>
      );
      continue;
    }

    // 普通段落
    elements.push(
      <div
        key={`p-${i}`}
        style={{
          margin: "3px 0",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--text)",
          wordBreak: "break-word",
        }}
      >
        {renderInline(trimmed)}
      </div>
    );
  }

  flushQuote("quote-final");

  return <div className="markdown-body" style={{ textAlign: "left" }}>{elements}</div>;
}

/**
 * 渲染行内元素（加粗、行内代码、超链接）
 */
function renderInline(text: string): React.ReactNode[] {
  if (!text) return [];

  // 正则匹配：**加粗** | `行内代码` | [链接文字](url)
  const regex = /(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    // **加粗**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      const boldText = part.slice(2, -2);
      return (
        <strong key={index} style={{ fontWeight: 600, color: "var(--text)" }}>
          {boldText}
        </strong>
      );
    }

    // `行内代码`
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      const codeText = part.slice(1, -1);
      return (
        <code
          key={index}
          style={{
            background: "var(--surface-3, rgba(255, 255, 255, 0.08))",
            color: "var(--accent)",
            padding: "1px 5px",
            borderRadius: 4,
            fontFamily: "var(--mono)",
            fontSize: "0.88em",
            border: "1px solid var(--border)",
            margin: "0 2px",
          }}
        >
          {codeText}
        </code>
      );
    }

    // [链接](url)
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      const label = linkMatch[1];
      const href = linkMatch[2];
      return (
        <ExternalLink
          key={index}
          href={href}
          style={{
            color: "var(--accent)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {label}
        </ExternalLink>
      );
    }

    return <span key={index}>{part}</span>;
  });
}
