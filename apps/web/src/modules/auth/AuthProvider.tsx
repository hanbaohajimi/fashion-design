"use client";

import { usePathname, useRouter } from "next/navigation";
import { draftRepository } from "../../components/drafts/draft-repository";
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
  const [sessionCheck, setSessionCheck] = useState(0);
  const isPrototypePath = process.env.NODE_ENV !== "production" && pathname === "/prototypes/impeccable";
  const isPublicPath = isPrototypePath || PUBLIC_AUTH_PATHS.has(pathname) || /^\/share\/[\w-]+$/u.test(pathname);
  const draftOwner = useRef<string | null>(null);
  const clearOwnedDrafts = useCallback(() => {
    const owner = draftOwner.current;
    if (!owner) return;
    draftOwner.current = null;
    void draftRepository.clearAccount(owner).catch(() => undefined);
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(`fashion-sketch:${owner}:`)) localStorage.removeItem(key);
      }
    } catch { /* Storage may be disabled. */ }
  }, []);
  useEffect(() => {
    const id = session?.user.id;
    // Public navigation hides the session without confirming a logout.
    // Retain the last verified owner until the server confirms an identity change.
    if (!id) return;
    if (draftOwner.current && draftOwner.current !== id) {
      clearOwnedDrafts();
    }
    draftOwner.current = id;
  }, [clearOwnedDrafts, session?.user.id]);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const flight = useRef<Promise<void> | null>(null);
  const logoutFlight = useRef<Promise<void> | null>(null);
  const epoch = useRef(0);

  const loadSession = useCallback((): Promise<void> => {
    if (isPublicPath) {
      setLoading(false);
      return Promise.resolve();
    }

    if (logoutFlight.current) return Promise.resolve();
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
          clearOwnedDrafts();
          sessionRef.current = null;
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
          clearOwnedDrafts();
          sessionRef.current = null;
          setSession(null);
          router.replace("/login");
          return;
        }
        if (!sessionRef.current) {
          const message = await readErrorMessage(response, "会话加载失败，请稍后重试。");
          if (isCurrent() && !sessionRef.current) setError(message);
        }
        return;
      }

      const next = (await response.json()) as MeResponse;
      if (isCurrent()) {
        sessionRef.current = next;
        setSession(next);
      }
    } catch {
      if (isCurrent() && !sessionRef.current) setError("无法连接认证服务，请检查网络后重试。");
    } finally {
      if (isCurrent()) setLoading(false);
    }
    };
    const promise = task().finally(() => { if (flight.current === promise) flight.current = null; });
    flight.current = promise;
    return promise;
  }, [clearOwnedDrafts, isPublicPath, router]);

  const logout = useCallback((): Promise<void> => {
    if (logoutFlight.current) return logoutFlight.current;
    epoch.current += 1;
    flight.current = null;
    const task = async () => {
      const response = await logoutSession();
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "退出登录失败，请稍后重试。"),
        );
      }
      epoch.current += 1;
      clearOwnedDrafts();
      sessionRef.current = null;
      setSession(null);
      setError(null);
      setLoading(false);
      announceSessionChange();
      router.replace("/login");
    };
    const promise = task().catch((cause: unknown) => {
      // A failed logout leaves the server identity uncertain. Recheck after
      // releasing the lock, including changes announced by another tab.
      setSessionCheck(value => value + 1);
      throw cause;
    }).finally(() => {
      if (logoutFlight.current === promise) logoutFlight.current = null;
    });
    logoutFlight.current = promise;
    return promise;
  }, [clearOwnedDrafts, router]);

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
  }, [isPublicPath, loadSession, sessionCheck]);

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
