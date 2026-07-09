import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import './index.css';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const MainApp = lazy(() => import('./pages/MainApp'));

export type AppView = 'landing' | 'auth' | 'main';
export interface AppUser {
  email: string;
  name: string;
  auth_token: string;
  expires_at: string;
}

function readSessionUser(): AppUser | null {
  try {
    const raw = sessionStorage.getItem('af_user');
    const parsed = raw ? JSON.parse(raw) as AppUser : null;
    if (
      parsed?.auth_token
      && parsed.expires_at
      && Date.parse(parsed.expires_at) > Date.now()
    ) {
      return parsed;
    }
  } catch {
    // Invalid browser state is treated as a signed-out session.
  }
  sessionStorage.removeItem('af_user');
  return null;
}

function AppRouter() {
  useEffect(() => {
    // Remove all data created by the legacy client-side login implementation.
    localStorage.removeItem('af_users');
    localStorage.removeItem('af_user');
    localStorage.removeItem('af_token');
  }, []);

  const [user, setUser] = useState<AppUser | null>(readSessionUser);
  const [view, setView] = useState<AppView>(() => readSessionUser() ? 'main' : 'landing');

  const handleEnter = () => setView('auth');

  const handleLogin = (u: AppUser) => {
    setUser(u);
    sessionStorage.setItem('af_user', JSON.stringify(u));
    setView('main');
  };

  const clearSession = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('af_user');
    setView('landing');
  }, []);

  const handleLogout = () => {
    if (user?.auth_token) {
      fetch('/api/design/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.auth_token}` },
      }).catch(() => {});
    }
    clearSession();
  };

  useEffect(() => {
    const handleSessionExpired = () => clearSession();
    window.addEventListener('af:session-expired', handleSessionExpired);
    return () => window.removeEventListener('af:session-expired', handleSessionExpired);
  }, [clearSession]);

  useEffect(() => {
    if (!user?.auth_token) return;
    const controller = new AbortController();
    fetch('/api/design/auth/session', {
      headers: { Authorization: `Bearer ${user.auth_token}` },
      signal: controller.signal,
    }).then((res) => {
      if (res.status === 401) clearSession();
    }).catch(() => {});
    return () => controller.abort();
  }, [user?.auth_token, clearSession]);

  // Guard: redirect to login if not authenticated
  useEffect(() => {
    if (view === 'main' && !user) {
      setView('auth');
    }
  }, [view, user]);

  return (
    <>
      <Suspense
        fallback={
          <div className="app-shell flex h-full items-center justify-center">
            <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-white px-4 py-3 shadow-[var(--shadow-md)]">
              <span className="h-3 w-3 animate-pulse rounded-full bg-[color:var(--signal-blue)]" />
              <span className="text-[13px] text-[color:var(--text-secondary)]">加载中...</span>
            </div>
          </div>
        }
      >
        {view === 'landing' && <LandingPage onEnter={handleEnter} />}
        {view === 'auth' && <AuthPage onLogin={handleLogin} onBack={() => setView('landing')} />}
        {view === 'main' && user && <MainApp user={user} onLogout={handleLogout} />}
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <AppRouter />
      </ErrorBoundary>
    </ToastProvider>
  );
}
