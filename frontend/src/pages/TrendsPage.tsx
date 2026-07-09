/**
 * TrendsPage: wraps TrendsHubWorkspace inside ToolPageLayout
 * and hooks up onDesignThis to navigate to /chat/new with the trend context.
 */
import { Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDesign } from '../api/designsApi';
import type { Trend } from '../types/profile';

const TrendsHubWorkspace = lazy(() => import('../modules/trends-hub/TrendsHubWorkspace'));

interface TrendsPageProps {
  user: { email: string; name: string; auth_token: string };
}

function Loader() {
  return (
    <div className="flex h-full items-center justify-center bg-[color:var(--color-canvas,#faf9f7)]">
      <div className="rounded-xl border border-[color:var(--color-border,#e8e4dc)] bg-white px-5 py-3 text-sm text-[color:var(--color-ink-3,#8a8278)]">
        加载趋势分析...
      </div>
    </div>
  );
}

export default function TrendsPage({ user }: TrendsPageProps) {
  const navigate = useNavigate();

  const handleDesignThis = async (trend: Trend) => {
    const prompt = `基于趋势「${trend.name_zh || trend.name}」进行设计，结合其关键词：${(trend.keywords || []).slice(0, 5).join('、')}。请生成完整成衣效果图。`;
    try {
      const design = await createDesign(user.auth_token, {
        title: `趋势设计 · ${trend.name_zh || trend.name}`,
      });
      navigate(`/chat/${design.id}`, { state: { starterPrompt: prompt } });
    } catch {
      navigate('/chat/new', { state: { starterPrompt: prompt } });
    }
  };

  return (
    <Suspense fallback={<Loader />}>
      <TrendsHubWorkspace user={user} onDesignThis={handleDesignThis} />
    </Suspense>
  );
}
