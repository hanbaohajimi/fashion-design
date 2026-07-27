"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  fetchMe,
  type MeResponse,
  readErrorMessage,
  refreshSession,
} from "./auth-api";

interface AuthContextValue {
  readonly error: string | null;
  readonly loading: boolean;
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
  const isPublicPath = PUBLIC_AUTH_PATHS.has(pathname);

  const loadSession = useCallback(async (): Promise<void> => {
    if (isPublicPath) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let response = await fetchMe();

      if (response.status === 401) {
        const refreshed = await refreshSession();

        if (!refreshed.ok) {
          setSession(null);
          router.replace("/login");
          return;
        }

        response = await fetchMe();
      }

      if (!response.ok) {
        setSession(null);
        setError(
          await readErrorMessage(response, "会话加载失败，请稍后重试。"),
        );
        return;
      }

      setSession((await response.json()) as MeResponse);
    } catch {
      setSession(null);
      setError("无法连接认证服务，请检查网络后重试。");
    } finally {
      setLoading(false);
    }
  }, [isPublicPath, router]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadSession();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [loadSession]);

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
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isPublicPath, loadSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      error,
      loading,
      refresh: loadSession,
      session,
    }),
    [error, loadSession, loading, session],
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
