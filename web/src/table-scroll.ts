import { useEffect } from "react";

/**
 * 窄屏表格的横向滚动处理。
 *
 * 背景：全站有 20 多张表，最宽的「自动化工作流」有 4 列长文本，
 * 在 390px 屏上把整页撑到 1400px —— 不只表格自己溢出，
 * 旁边的卡片和图表全被挤成一条线（实测过）。
 *
 * 为什么在运行时包 DOM、而不是给 20 多处 JSX 逐个套 <div>：
 *   · 以后新加的页面自动就有，不用记得写这条规矩；
 *   · 宽窄两种形态共用同一棵 DOM，切换断点时不需要卸载重挂（不会闪）。
 * React 只管理 <table> 自己的子节点，外层壳是我们插的，卸载时一并移除。
 *
 * 已经自带横向滚动的容器（AI 报告里的 .table-wrap）跳过，别套两层。
 */
export function useTableScroll() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".main");
    if (!root) return;

    /** 表单态刷新：表还没撑开 / 窗口变了，重新判断要不要露渐隐提示 */
    const measure = (box: HTMLElement) => {
      const more = box.scrollWidth - box.clientWidth;
      const on = more > 2;
      box.parentElement?.toggleAttribute("data-x", on);
      if (on) syncEdge(box);
    };

    /** 已经滑到底就把右侧渐隐收掉，否则它会一直杵在最右列上面 */
    const syncEdge = (box: HTMLElement) => {
      box.parentElement?.classList.toggle("at-end", box.scrollLeft + box.clientWidth >= box.scrollWidth - 2);
    };

    const onScroll = (e: Event) => syncEdge(e.currentTarget as HTMLElement);

    const scan = () => {
      root.querySelectorAll<HTMLTableElement>("table").forEach((t) => {
        if (t.closest(".table-scroll, .table-wrap, .report")) return;
        const shell = document.createElement("div");
        shell.className = "table-scroll-wrap";
        const box = document.createElement("div");
        box.className = "table-scroll";
        t.replaceWith(shell);
        shell.appendChild(box);
        box.appendChild(t);
        box.addEventListener("scroll", onScroll, { passive: true });
        measure(box);
      });
    };

    // 表格数据是异步回来的，挂载时往往还没有内容，
    // 所以要盯 DOM 变化，不能只在 mount 那一刻扫一遍。
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });

    // 宽度变化（旋转屏幕、收起侧边栏、图表重排）后重新量一次
    const ro = new ResizeObserver(() => {
      root.querySelectorAll<HTMLElement>(".table-scroll").forEach(measure);
    });
    ro.observe(root);

    return () => {
      mo.disconnect();
      ro.disconnect();
      root.querySelectorAll<HTMLElement>(".table-scroll").forEach((b) => b.removeEventListener("scroll", onScroll));
    };
  }, []);
}