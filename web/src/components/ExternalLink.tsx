import React from "react";
import { openExternal } from "../openExternal";

export interface ExternalLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
}

/**
 * 跨端通用外部链接组件 (ExternalLink)
 *
 * 核心特性：
 * 1. 彻底解决桌面端与网页端“连弹两个标签页”的问题（内置事件拦截与防重入）；
 * 2. 自动根据环境分发：
 *    - 桌面端 (Tauri)：通过系统原生能力打开系统默认浏览器；
 *    - 网页端 (Browser)：由浏览器原生打开新标签页，绝对不触发后端命令行；
 * 3. 默认携带 rel="noopener noreferrer" 安全属性；
 * 4. 完美继承原生 <a> 标签所有样式 (className, style) 与属性。
 */
export default function ExternalLink({
  href,
  children,
  onClick,
  target = "_blank",
  rel = "noopener noreferrer",
  ...props
}: ExternalLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 阻断原生默认跳转与事件冒泡，杜绝浏览器与组件重复触发打开动作
    e.preventDefault();
    e.stopPropagation();

    // 允许外部传入自定义 onClick 处理逻辑
    if (onClick) {
      onClick(e);
    }

    openExternal(href);
  };

  return (
    <a
      href={href}
      target={target}
      rel={rel}
      onClick={handleClick}
      {...props}
    >
      {children}
    </a>
  );
}
