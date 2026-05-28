import { useState, useEffect } from 'react';
import './index.css';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import ToolSelector from './pages/ToolSelector';
import MainApp from './pages/MainApp';

export type AppView = 'landing' | 'auth' | 'tools' | 'design-studio' | 'trend-analysis';
export interface AppUser { email: string; name: string; auth_token: string; }

function AppRouter() {
  // Clear legacy localStorage-only user store from old version
  localStorage.removeItem('af_users');

  const [view, setView] = useState<AppView>(() => {
    const token = localStorage.getItem('af_token');
    const userRaw = localStorage.getItem('af_user');
    if (token && userRaw) {
      try {
        const { expires } = JSON.parse(token);
        const user = JSON.parse(userRaw);
        // Reject old sessions that have no auth_token (pre-server-auth format)
        if (expires && Date.now() < expires && user?.auth_token) return 'tools';
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
    setView('tools');
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

  const handleSelectTool = (tool: 'design-studio' | 'trend-analysis') => {
    setView(tool);
  };

  // Guard: redirect to login if not authenticated
  useEffect(() => {
    if ((view === 'tools' || view === 'design-studio' || view === 'trend-analysis') && !user) {
      setView('auth');
    }
  }, [view, user]);

  return (
    <>
      {view === 'landing' && <LandingPage onEnter={handleEnter} />}
      {view === 'auth' && <AuthPage onLogin={handleLogin} onBack={() => setView('landing')} />}
      {view === 'tools' && user && <ToolSelector user={user} onSelect={handleSelectTool} onLogout={handleLogout} />}
      {(view === 'design-studio' || view === 'trend-analysis') && user && (
        <MainApp user={user} onLogout={handleLogout} onBackToTools={() => setView('tools')} initialTool={view} />
      )}
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
