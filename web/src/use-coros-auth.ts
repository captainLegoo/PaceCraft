import { useState, useEffect, useCallback, useRef } from "react";
import { api, type AuthStatus } from "./api";
import { openExternal } from "./openExternal";
import { useI18n } from "./i18n";

export function useCorosAuth(onSuccess?: () => void, onDisconnect?: () => void) {
  const { isZh } = useI18n();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;

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
    api.cancelAuth().catch(() => {});
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

      // 后端已自动调起系统默认浏览器（openExternalUrl），前端此处无需重复调起
      let popup: Window | null = null;

      // 1. 监听来自授权完成子窗口的 postMessage
      const handler = async (e: MessageEvent) => {
        if (e.data?.type === "COROS_AUTH_RESULT") {
          cleanupListeners();
          if (e.data.ok) {
            const s = await refreshAuth();
            if (s?.mismatch) {
              setMsg({
                text: isZh ? "检测到授权账号与当前档案已有数据不一致，请在界面中选择处理方式" : "Account mismatch detected. Please select an option in the dialog.",
                kind: "ok",
              });
            } else {
              setMsg({ text: isZh ? "COROS 账号连接成功！" : "COROS account connected successfully!", kind: "ok" });
              onSuccessRef.current?.();
            }
          } else {
            setMsg({ text: isZh ? "授权未完成或已被取消" : "Authorization was cancelled or not completed.", kind: "err" });
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
        if ((popup as Window | null)?.closed || attempts > 150) {
          cleanupListeners();
          setConnecting(false);
          setAuthUrl(null);
          const latest = await refreshAuth();
          if (latest?.connected) {
            if (latest.mismatch) {
              setMsg({
                text: isZh ? "检测到授权账号与当前档案已有数据不一致，请在界面中选择处理方式" : "Account mismatch detected. Please select an option in the dialog.",
                kind: "ok",
              });
            } else {
              setMsg({ text: isZh ? "COROS 账号已就绪！" : "COROS account is ready!", kind: "ok" });
              onSuccessRef.current?.();
            }
          }
          return;
        }

        const s = await refreshAuth();
        if (s?.connected) {
          cleanupListeners();
          setConnecting(false);
          setAuthUrl(null);
          if (s.mismatch) {
            setMsg({
              text: isZh ? "检测到授权账号与当前档案已有数据不一致，请在界面中选择处理方式" : "Account mismatch detected. Please select an option in the dialog.",
              kind: "ok",
            });
          } else {
            setMsg({ text: isZh ? "COROS 账号连接成功！" : "COROS account connected successfully!", kind: "ok" });
            onSuccessRef.current?.();
          }
        }
      }, 2000);
    } catch (e) {
      setMsg({ text: isZh ? `发起授权失败：${(e as Error).message}` : `Failed to start authorization: ${(e as Error).message}`, kind: "err" });
      setConnecting(false);
      setAuthUrl(null);
    }
  };

  const disconnect = async () => {
    setLoading(true);
    try {
      await api.disconnectAuth();
      await refreshAuth();
      setMsg({ text: isZh ? "已解除 COROS 账号绑定" : "COROS account disconnected.", kind: "ok" });
      onDisconnectRef.current?.();
    } catch (e) {
      setMsg({ text: isZh ? `解绑失败：${(e as Error).message}` : `Failed to disconnect: ${(e as Error).message}`, kind: "err" });
    } finally {
      setLoading(false);
    }
  };

  const openBrowser = useCallback(() => {
    if (authUrl) {
      openExternal(authUrl);
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
