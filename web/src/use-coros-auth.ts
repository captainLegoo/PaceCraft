import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AuthStatus } from "./api";

export function useCorosAuth(onSuccess?: () => void) {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const refreshAuth = useCallback(async () => {
    try {
      const res = await api.authStatus();
      setAuth(res);
      return res;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const connect = async () => {
    setConnecting(true);
    setMsg(null);
    try {
      const { authorizeUrl } = await api.startAuth();
      const popup = window.open(
        authorizeUrl,
        "coros_auth_window",
        "width=560,height=720,menubar=no,toolbar=no,status=no",
      );

      // 1. 监听来自授权完成子窗口的 postMessage
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "COROS_AUTH_RESULT") {
          window.removeEventListener("message", handler);
          if (e.data.ok) {
            setMsg({ text: "COROS 账号连接成功！", kind: "ok" });
            refreshAuth();
            onSuccessRef.current?.();
          } else {
            setMsg({ text: "授权未完成或已被取消", kind: "err" });
          }
          setConnecting(false);
        }
      };
      window.addEventListener("message", handler);

      // 2. 轮询兜底（防止某些环境下阻断 postMessage 或用户直接关掉窗口）
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts++;
        if (popup?.closed || attempts > 150) {
          clearInterval(timer);
          window.removeEventListener("message", handler);
          setConnecting(false);
          const latest = await refreshAuth();
          if (latest?.connected) {
            setMsg({ text: "COROS 账号已就绪！", kind: "ok" });
            onSuccessRef.current?.();
          }
          return;
        }

        const s = await refreshAuth();
        if (s?.connected) {
          clearInterval(timer);
          window.removeEventListener("message", handler);
          setConnecting(false);
          setMsg({ text: "COROS 账号连接成功！", kind: "ok" });
          onSuccessRef.current?.();
        }
      }, 2000);
    } catch (e) {
      setMsg({ text: `发起授权失败：${(e as Error).message}`, kind: "err" });
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("确定要解除当前 COROS 账号绑定吗？解除后需重新授权才能同步最新数据。")) return;
    setLoading(true);
    try {
      await api.disconnectAuth();
      await refreshAuth();
      setMsg({ text: "已解除 COROS 账号绑定", kind: "ok" });
    } catch (e) {
      setMsg({ text: `解绑失败：${(e as Error).message}`, kind: "err" });
    } finally {
      setLoading(false);
    }
  };

  return { auth, loading, connecting, msg, connect, disconnect, refreshAuth };
}
