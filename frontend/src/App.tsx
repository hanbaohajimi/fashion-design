import { useState, useEffect, Suspense, lazy } from 'react';
import './index.css';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const MainApp = lazy(() => import('./pages/MainApp'));

export type AppView = 'landing' | 'auth' | 'main';
export interface AppUser { email: string; name: string; auth_token: string; }

function AppRouter() {
  useEffect(() => {
    localStorage.removeItem('af_users');
  }, []);

  const [view, setView] = useState<AppView>(() => {
    const token = localStorage.getItem('af_token');
    const userRaw = localStorage.getItem('af_user');
    if (token && userRaw) {
      try {
        const { expires } = JSON.parse(token);
        const user = JSON.parse(userRaw);
        // Reject old sessions that have no auth_token (pre-server-auth format)
        if (expires && Date.now() < expires && user?.auth_token) return 'main';
      } catch { /* fall through */ }
    }
    return 'landing';
  });

  const [user, setUser] = useState<AppUser | null>(() => {
    try {
      const raw = localStorage.getItem('af_user');
      const parsed = raw ? JSON.parse(raw) : null;
      // Reject old format that has no server-issued auth_token
      return parsed?.auth_token ? parsed : null;
    } catch { return null; }
  });

  const handleEnter = () => setView('auth');

  const handleLogin = (u: AppUser) => {
    setUser(u);
    localStorage.setItem('af_user', JSON.stringify(u));
    localStorage.setItem('af_token', JSON.stringify({ expires: Date.now() + 7 * 86400000 }));
    setView('main');
  };

  const handleLogout = () => {
    if (user?.auth_token) {
      fetch('/api/design/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: user.auth_token }),
      }).catch(() => {});
    }
    setUser(null);
    localStorage.removeItem('af_user');
    localStorage.removeItem('af_token');
    setView('landing');
  };

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
