/**
 * ChatPage — wraps DesignStudioWorkspace for route-based usage.
 * Handles /chat/new, /chat/:chatId,
 *         /projects/:projectId/chat/new, /projects/:projectId/chat/:chatId
 */
import { Suspense, lazy } from 'react';
import { useLocation, useParams } from 'react-router-dom';

const DesignStudioWorkspace = lazy(() =>
  import('../modules/design-studio/DesignStudioWorkspace'),
);

interface ChatPageProps {
  user: { email: string; name: string; auth_token: string };
}

function Loader() {
  return (
    <div className="flex h-full items-center justify-center bg-[color:var(--color-canvas,#faf9f7)]">
      <div className="rounded-xl border border-[color:var(--color-border,#e8e4dc)] bg-white px-5 py-3 text-sm text-[color:var(--color-ink-3,#8a8278)]">
        加载设计工作台...
      </div>
    </div>
  );
}

export default function ChatPage({ user }: ChatPageProps) {
  // projectId from route (/projects/:projectId/chat/*)
  const { projectId, chatId } = useParams<{ projectId?: string; chatId?: string }>();
  // starterPrompt may be passed from NewDesignPage / ProjectDetailPage via navigate() state
  const location = useLocation();
  const starterPrompt = (location.state as { starterPrompt?: string } | null)?.starterPrompt;

  return (
    <Suspense fallback={<Loader />}>
      <DesignStudioWorkspace
        user={user}
        projectId={projectId}
        designId={chatId}
        starterPrompt={starterPrompt}
      />
    </Suspense>
  );
}
