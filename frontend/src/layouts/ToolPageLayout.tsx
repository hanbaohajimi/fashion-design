/**
 * ToolPageLayout: Sidebar + full-width content area
 * Used for /try-on, /wardrobe, /trends, /projects, /customize
 */
import AppShell from '../components/AppShell/AppShell';

interface ToolPageLayoutProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
  children: React.ReactNode;
}

export default function ToolPageLayout({ user, onLogout, children }: ToolPageLayoutProps) {
  return (
    <AppShell user={user} onLogout={onLogout}>
      {children}
    </AppShell>
  );
}
