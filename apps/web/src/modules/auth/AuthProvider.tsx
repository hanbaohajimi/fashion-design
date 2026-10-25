"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AUTH_EXPIRED_EVENT,
  fetchMe,
  logoutSession,
  type MeResponse,
  readErrorMessage,
  refreshSession,
} from "./auth-api";
import {
  identifyAnalyticsUser,
  resetAnalyticsUser,
} from "../../observability/analytics";

export const SESSION_CHANGE_KEY = "fashion:session-change";
export function announceSessionChange(): void {
  try { window.localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID()); }
  catch { /* Visibility/session polling remains available when storage is blocked. */ }
}

interface AuthContextValue {
  readonly error: string | null;
  readonly loading: boolean;
  readonly logout: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly session: MeResponse | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PUBLIC_AUTH_PATHS = new Set(["/login", "/auth/confirm"]);

interface AuthProviderProps {
  readonly children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPublicPath = PUBLIC_AUTH_PATHS.has(pathname) || /^\/share\/[\w-]+$/u.test(pathname);
  const draftOwner = useRef<string | null>(null);
  useEffect(() => {
    const id = session?.user.id ?? null;
    if (draftOwner.current && draftOwner.current !== id) {
      try { for (const key of Object.keys(localStorage)) if (key.startsWith(`fashion-sketch:${draftOwner.current}:`)) localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
    }
    draftOwner.current = id;
  }, [session?.user.id]);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const flight = useRef<Promise<void> | null>(null);
  const epoch = useRef(0);

  const loadSession = useCallback((): Promise<void> => {
    if (isPublicPath) {
      setLoading(false);
      return Promise.resolve();
    }

    if (flight.current) return flight.current;
    const currentEpoch = epoch.current;
    const isCurrent = () => epoch.current === currentEpoch;
    if (!sessionRef.current) setLoading(true);
    setError(null);
    const task = async () => {
    try {
      let response = await fetchMe();
      if (!isCurrent()) return;

      if (response.status === 401) {
        const refreshed = await refreshSession();
        if (!isCurrent()) return;

        if (refreshed.status === 401 || refreshed.status === 400) {
          setSession(null);
          router.replace("/login");
          return;
        }
        if (!refreshed.ok) throw new Error("会话刷新暂时不可用");

        response = await fetchMe();
        if (!isCurrent()) return;
      }

      if (!response.ok) {
        if (response.status === 401) {
          setSession(null);
          router.replace("/login");
          return;
        }
        if (!sessionRef.current) setError(
          await readErrorMessage(response, "会话加载失败，请稍后重试。"),
        );
        return;
      }

      const next = (await response.json()) as MeResponse;
      if (isCurrent()) setSession(next);
    } catch {
      if (isCurrent() && !sessionRef.current) setError("无法连接认证服务，请检查网络后重试。");
    } finally {
      if (isCurrent()) setLoading(false);
    }
    };
    const promise = task().finally(() => { if (flight.current === promise) flight.current = null; });
    flight.current = promise;
    return promise;
  }, [isPublicPath, router]);

  const logout = useCallback(async (): Promise<void> => {
    epoch.current += 1;
    flight.current = null;
    const response = await logoutSession();

    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, "退出登录失败，请稍后重试。"),
      );
    }

    try { for (const key of Object.keys(localStorage)) if (key.startsWith("fashion-sketch:")) localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
    setSession(null);
    setError(null);
    announceSessionChange();
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (isPublicPath) {
      epoch.current += 1;
      flight.current = null;
      sessionRef.current = null;
      const resetId = window.setTimeout(() => { setSession(null); setLoading(false); }, 0);
      return () => window.clearTimeout(resetId);
    }
    const timerId = window.setTimeout(() => {
      void loadSession();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [isPublicPath, loadSession]);

  useEffect(() => {
    if (isPublicPath) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadSession();
    }, SESSION_REFRESH_INTERVAL_MS);

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        void loadSession();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== SESSION_CHANGE_KEY) return;
      epoch.current += 1;
      flight.current = null;
      void loadSession();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
    };
  }, [isPublicPath, loadSession]);

  useEffect(() => {
    if (isPublicPath) return;
    const handleExpired = (): void => {
      void loadSession();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, [isPublicPath, loadSession]);

  useEffect(() => {
    if (session?.user.id) {
      identifyAnalyticsUser(session.user.id);
    } else if (!loading) {
      resetAnalyticsUser();
    }
  }, [loading, session?.user.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      error,
      loading,
      logout,
      refresh: loadSession,
      session,
    }),
    [error, loadSession, loading, logout, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用。");
  }

  return context;
}
