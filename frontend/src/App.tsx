import { useState, useEffect } from 'react';
import './index.css';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import ToolSelector from './pages/ToolSelector';
import MainApp from './pages/MainApp';

export type AppView = 'landing' | 'auth' | 'tools' | 'design-studio' | 'trend-analysis';
export interface AppUser { email: string; name: string; }

function AppRouter() {
  const [view, setView] = useState<AppView>(() => {
    const token = localStorage.getItem('af_token');
    const user = localStorage.getItem('af_user');
    if (token && user) {
      try {
        const { expires } = JSON.parse(token);
        if (expires && Date.now() < expires) return 'tools';
      } catch { /* fall through */ }
    }
    return 'landing';
  });

  const [user, setUser] = useState<AppUser | null>(() => {
    try {
      const raw = localStorage.getItem('af_user');
      return raw ? JSON.parse(raw) : null;
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
