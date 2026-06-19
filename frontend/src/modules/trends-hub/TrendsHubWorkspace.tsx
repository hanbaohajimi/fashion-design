import { lazy, Suspense, useEffect, useState } from 'react';
import { LayoutGrid, BarChart3 } from 'lucide-react';
import type { Trend } from '../../types/profile';
import './trends-hub.css';

const TrendBoardWorkspace = lazy(() => import('../trends/TrendBoardWorkspace'));
const TrendAnalysisWorkspace = lazy(() => import('../trend-analysis/TrendAnalysisWorkspace'));

type SubTab = 'board' | 'analysis';

const STORAGE_KEY = 'trends-hub-active-tab';

interface TrendsHubProps {
  user: { email: string; name: string; auth_token: string };
  onDesignThis?: (trend: Trend) => void;
}

function TabFallback({ label }: { label: string }) {
  return (
    <div className="trends-hub-fallback">
      <p>{label} · Loading</p>
    </div>
  );
}

export default function TrendsHubWorkspace({ user, onDesignThis }: TrendsHubProps) {
  const [active, setActive] = useState<SubTab>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'analysis' ? 'analysis' : 'board';
  });
  const [mounted, setMounted] = useState<Set<SubTab>>(() => new Set([active]));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, active);
    setMounted(prev => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);

  const tabs: { id: SubTab; numeral: string; label: string; icon: React.ReactNode }[] = [
    { id: 'board', numeral: '01', label: '趋势探索', icon: <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.5} /> },
    { id: 'analysis', numeral: '02', label: '趋势分析', icon: <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.5} /> },
  ];

  return (
    <div className="trends-hub-shell">
      <nav className="trends-hub-bar" aria-label="Trends hub">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`trends-hub-tab ${active === t.id ? 'active' : ''}`}
          >
            <span className="tab-numeral">{t.numeral}</span>
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <div className="trends-hub-body">
        {(['board', 'analysis'] as SubTab[]).map(id => (
          <div
            key={id}
            className="trends-hub-pane"
            style={{
              visibility: active === id ? 'visible' : 'hidden',
              zIndex: active === id ? 1 : 0,
              pointerEvents: active === id ? 'auto' : 'none',
            }}
          >
            {mounted.has(id) && (
              <Suspense fallback={<TabFallback label={id === 'board' ? '趋势探索' : '趋势分析'} />}>
                {id === 'board' ? (
                  <TrendBoardWorkspace user={user} onDesignThis={onDesignThis} />
                ) : (
                  <TrendAnalysisWorkspace />
                )}
              </Suspense>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
