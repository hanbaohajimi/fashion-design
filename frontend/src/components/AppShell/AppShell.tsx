import { Suspense } from 'react';
import Sidebar from './Sidebar';
import './sidebar.css';

interface AppShellProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
  children: React.ReactNode;
}

export default function AppShell({ user, onLogout, children }: AppShellProps) {
  return (
    <div className="flex h-full overflow-hidden">
      <Suspense fallback={null}>
        <Sidebar user={user} onLogout={onLogout} />
      </Suspense>
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
