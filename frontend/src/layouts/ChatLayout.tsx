/**
 * ChatLayout: Sidebar + Canvas + ChatPanel
 * Used for /chat/new, /chat/:chatId, /projects/:projectId/chat/*
 */
import { Suspense, lazy } from 'react';
import AppShell from '../components/AppShell/AppShell';

const DesignStudioWorkspace = lazy(() => import('../modules/design-studio/DesignStudioWorkspace'));

interface ChatLayoutProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
  projectId?: string;
}

function Loader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-xl border border-[color:var(--color-border)] bg-white px-4 py-3 text-sm text-[color:var(--color-ink-3)]">
        加载中...
      </div>
    </div>
  );
}

export default function ChatLayout({ user, onLogout, projectId }: ChatLayoutProps) {
  return (
    <AppShell user={user} onLogout={onLogout}>
      <Suspense fallback={<Loader />}>
        <DesignStudioWorkspace user={user} projectId={projectId} />
      </Suspense>
    </AppShell>
  );
}
