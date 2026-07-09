import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Clock } from 'lucide-react';
import { fetchDesigns, createDesign, type DesignThread } from '../api/designsApi';
import { formatDate } from '../utils/date';
import './designs.css';

interface DesignsPageProps {
  user: { email: string; name: string; auth_token: string };
}

export default function DesignsPage({ user }: DesignsPageProps) {
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<DesignThread[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // null = standalone designs only (project_id IS NULL)
      const list = await fetchDesigns(user.auth_token, null);
      setDesigns(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user.auth_token]);

  useEffect(() => { void load(); }, [load]);

  const handleNew = async () => {
    try {
      const design = await createDesign(user.auth_token, {});
      navigate(`/chat/${design.id}`);
    } catch { /* ignore */ }
  };

  return (
    <div className="designs-page">
      <div className="designs-header">
        <h1 className="designs-title">我的设计</h1>
        <button type="button" className="designs-new-btn" onClick={() => void handleNew()}>
          + 新建设计
        </button>
      </div>

      <div className="designs-body">
        {loading ? (
          <div className="designs-empty"><span>加载中...</span></div>
        ) : designs.length === 0 ? (
          <div className="designs-empty">
            <Layers className="w-10 h-10 text-[color:var(--color-ink-3)]" strokeWidth={1} />
            <p>还没有设计对话，点击「新建设计」开始吧</p>
          </div>
        ) : (
          <div className="designs-list">
            {designs.map(d => (
              <button
                key={d.id}
                type="button"
                className="design-item"
                onClick={() => navigate(`/chat/${d.id}`)}
              >
                <span className="design-item-title">{d.title || '无标题设计'}</span>
                <span className="design-item-meta">
                  <Clock className="w-3 h-3" strokeWidth={1.5} />
                  {formatDate(d.updated_at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
