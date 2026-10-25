import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AuthStatus } from "./api";

export function useCorosAuth(onSuccess?: () => void) {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handlerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const cleanupListeners = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (handlerRef.current) {
      window.removeEventListener("message", handlerRef.current);
      handlerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cleanupListeners();
    setConnecting(false);
    setAuthUrl(null);
  }, [cleanupListeners]);

  useEffect(() => {
    return () => {
      cleanupListeners();
    };
  }, [cleanupListeners]);

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
    cleanupListeners();
    setConnecting(true);
    setMsg(null);
    setAuthUrl(null);

    try {
      const { authorizeUrl } = await api.startAuth();
      setAuthUrl(authorizeUrl);

      // 1. 尝试通知后端调用系统默认浏览器（Safari / Chrome）打开授权页（桌面端必备）
      api.openExternal(authorizeUrl).catch(() => {});

      // 2. 网页端环境同时尝试 window.open 弹窗
      let popup: Window | null = null;
      try {
        popup = window.open(
          authorizeUrl,
          "coros_auth_window",
          "width=560,height=720,menubar=no,toolbar=no,status=no",
        );
      } catch {}

      // 3. 监听来自授权完成子窗口的 postMessage
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "COROS_AUTH_RESULT") {
          cleanupListeners();
          if (e.data.ok) {
            setMsg({ text: "COROS 账号连接成功！", kind: "ok" });
            refreshAuth();
            onSuccessRef.current?.();
          } else {
            setMsg({ text: "授权未完成或已被取消", kind: "err" });
          }
          setConnecting(false);
          setAuthUrl(null);
        }
      };
      handlerRef.current = handler;
      window.addEventListener("message", handler);

      // 4. 轮询兜底（支持外部浏览器回调、防止某些环境下阻断 postMessage）
      let attempts = 0;
      timerRef.current = setInterval(async () => {
        attempts++;
        if (popup?.closed || attempts > 150) {
          cleanupListeners();
          setConnecting(false);
          setAuthUrl(null);
          const latest = await refreshAuth();
          if (latest?.connected) {
            setMsg({ text: "COROS 账号已就绪！", kind: "ok" });
            onSuccessRef.current?.();
          }
          return;
        }

        const s = await refreshAuth();
        if (s?.connected) {
          cleanupListeners();
          setConnecting(false);
          setAuthUrl(null);
          setMsg({ text: "COROS 账号连接成功！", kind: "ok" });
          onSuccessRef.current?.();
        }
      }, 2000);
    } catch (e) {
      setMsg({ text: `发起授权失败：${(e as Error).message}`, kind: "err" });
      setConnecting(false);
      setAuthUrl(null);
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

  const openBrowser = useCallback(() => {
    if (authUrl) {
      api.openExternal(authUrl).catch(() => {});
      try {
        window.open(authUrl, "_blank");
      } catch {}
    }
  }, [authUrl]);

  return {
    auth,
    loading,
    connecting,
    authUrl,
    msg,
    connect,
    disconnect,
    cancel,
    openBrowser,
    refreshAuth,
  };
}
