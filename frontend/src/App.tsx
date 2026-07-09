import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import './index.css';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import AppShell from './components/AppShell/AppShell';
import ToolPageLayout from './layouts/ToolPageLayout';

// Lazy pages
const LandingPage       = lazy(() => import('./pages/LandingPage'));
const AuthPage          = lazy(() => import('./pages/AuthPage'));
const NewDesignPage     = lazy(() => import('./pages/NewDesignPage'));
const ChatPage          = lazy(() => import('./pages/ChatPage'));
const ProjectsPage      = lazy(() => import('./pages/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const DesignsPage       = lazy(() => import('./pages/DesignsPage'));
const CustomizePage     = lazy(() => import('./pages/CustomizePage'));
// Tool workspaces — kept intact
const TryOnWorkspace     = lazy(() => import('./modules/tryon/TryOnWorkspace'));
const WardrobeWorkspace  = lazy(() => import('./modules/wardrobe/WardrobeWorkspace'));
const TrendsPage         = lazy(() => import('./pages/TrendsPage'));

export interface AppUser {
  email: string;
  name: string;
  auth_token: string;
  expires_at: string;
}

function readSessionUser(): AppUser | null {
  try {
    const raw = sessionStorage.getItem('af_user');
    const parsed = raw ? (JSON.parse(raw) as AppUser) : null;
    if (parsed?.auth_token && parsed.expires_at && Date.parse(parsed.expires_at) > Date.now()) {
      return parsed;
    }
  } catch { /* treat as signed-out */ }
  sessionStorage.removeItem('af_user');
  return null;
}

function PageLoader() {
  return (
    <div className="app-shell flex h-full items-center justify-center">
      <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-white px-4 py-3 shadow-[var(--shadow-md)]">
        <span className="h-3 w-3 animate-pulse rounded-full bg-[color:var(--signal-blue)]" />
        <span className="text-[13px] text-[color:var(--text-secondary)]">加载中...</span>
      </div>
    </div>
  );
}

// ── Authenticated routes ─────────────────────────────────────
function AuthenticatedApp({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const sp = { user, onLogout };

  return (
    <Routes>
      {/* Root → New Design */}
      <Route path="/" element={<Navigate to="/chat/new" replace />} />

      {/* ── Chat (A-layout: Sidebar + Canvas + Chat Panel) ── */}
      <Route path="/chat/new" element={
        <AppShell {...sp}>
          <Suspense fallback={<PageLoader />}><NewDesignPage user={user} /></Suspense>
        </AppShell>
      } />
      <Route path="/chat/:chatId" element={
        <AppShell {...sp}>
          <Suspense fallback={<PageLoader />}><ChatPage user={user} /></Suspense>
        </AppShell>
      } />
      <Route path="/projects/:projectId/chat/new" element={
        <AppShell {...sp}>
          <Suspense fallback={<PageLoader />}><ChatPage user={user} /></Suspense>
        </AppShell>
      } />
      <Route path="/projects/:projectId/chat/:chatId" element={
        <AppShell {...sp}>
          <Suspense fallback={<PageLoader />}><ChatPage user={user} /></Suspense>
        </AppShell>
      } />

      {/* ── Projects (B-layout: Sidebar + full content) ── */}
      <Route path="/projects" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><ProjectsPage user={user} /></Suspense>
        </ToolPageLayout>
      } />
      <Route path="/projects/:projectId" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><ProjectDetailPage user={user} /></Suspense>
        </ToolPageLayout>
      } />

      {/* ── Designs list ── */}
      <Route path="/designs" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><DesignsPage user={user} /></Suspense>
        </ToolPageLayout>
      } />

      {/* ── Tools ── */}
      <Route path="/try-on" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><TryOnWorkspace user={user} /></Suspense>
        </ToolPageLayout>
      } />
      <Route path="/wardrobe" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><WardrobeWorkspace user={user} /></Suspense>
        </ToolPageLayout>
      } />
      <Route path="/trends" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><TrendsPage user={user} /></Suspense>
        </ToolPageLayout>
      } />

      {/* ── Customize / Settings ── */}
      <Route path="/customize" element={
        <ToolPageLayout {...sp}>
          <Suspense fallback={<PageLoader />}><CustomizePage user={user} /></Suspense>
        </ToolPageLayout>
      } />
      <Route path="/settings" element={<Navigate to="/customize" replace />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/chat/new" replace />} />
    </Routes>
  );
}

// ── Unauthenticated routes ────────────────────────────────────
function UnauthenticatedApp({ onLogin }: { onLogin: (u: AppUser) => void }) {
  const navigate = useNavigate();
  return (
    <Routes>
      <Route path="/" element={
        <Suspense fallback={<PageLoader />}>
          <LandingPage onEnter={() => navigate('/login')} />
        </Suspense>
      } />
      <Route path="/login" element={
        <Suspense fallback={<PageLoader />}>
          <AuthPage onLogin={onLogin} onBack={() => navigate('/')} />
        </Suspense>
      } />
      <Route path="/register" element={
        <Suspense fallback={<PageLoader />}>
          <AuthPage onLogin={onLogin} onBack={() => navigate('/')} />
        </Suspense>
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

// ── Root ─────────────────────────────────────────────────────
function AppRouter() {
  useEffect(() => {
    // Remove legacy localStorage data
    localStorage.removeItem('af_users');
    localStorage.removeItem('af_user');
    localStorage.removeItem('af_token');
  }, []);

  const [user, setUser] = useState<AppUser | null>(readSessionUser);

  const clearSession = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('af_user');
  }, []);

  const handleLogin = (u: AppUser) => {
    setUser(u);
    sessionStorage.setItem('af_user', JSON.stringify(u));
  };

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
    const h = () => clearSession();
    window.addEventListener('af:session-expired', h);
    return () => window.removeEventListener('af:session-expired', h);
  }, [clearSession]);

  useEffect(() => {
    if (!user?.auth_token) return;
    const controller = new AbortController();
    fetch('/api/design/auth/session', {
      headers: { Authorization: `Bearer ${user.auth_token}` },
      signal: controller.signal,
    }).then(res => { if (res.status === 401) clearSession(); }).catch(() => {});
    return () => controller.abort();
  }, [user?.auth_token, clearSession]);

  if (!user) return <UnauthenticatedApp onLogin={handleLogin} />;
  return <AuthenticatedApp user={user} onLogout={handleLogout} />;
}

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </ErrorBoundary>
    </ToastProvider>
  );
}
