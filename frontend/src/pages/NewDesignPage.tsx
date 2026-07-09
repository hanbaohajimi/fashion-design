import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Shirt, TrendingUp, BookMarked } from 'lucide-react';
import { createDesign } from '../api/designsApi';
import './new-design.css';

interface NewDesignPageProps {
  user: { email: string; name: string; auth_token: string };
}

const QUICK_ACTIONS = [
  { icon: Sparkles, label: '服装设计', prompt: '帮我设计一件今季风格的单品，生成完整成衣效果图。' },
  { icon: Shirt, label: '虚拟试衣', href: '/try-on' },
  { icon: TrendingUp, label: '趋势分析', href: '/trends' },
  { icon: BookMarked, label: '衣橱搭配', href: '/wardrobe' },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '深夜了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export default function NewDesignPage({ user }: NewDesignPageProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  }, [input]);

  const handleStart = useCallback(
    async (promptText?: string) => {
      const text = (promptText ?? input).trim();
      if (!text || loading) return;
      setLoading(true);
      try {
        const design = await createDesign(user.auth_token, { title: text.slice(0, 60) });
        navigate(`/chat/${design.id}`, { state: { starterPrompt: text } });
      } catch {
        setLoading(false);
      }
    },
    [input, loading, navigate, user.auth_token],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleStart();
    }
  };

  const firstName = user.name.split(' ')[0] || user.name;

  return (
    <div className="new-design-page">
      <div className="new-design-content">
        <p className="new-design-greeting">
          {getGreeting()}, {firstName}
        </p>
        <h1 className="new-design-heading">今天想设计什么？</h1>

        <div className="new-design-input-wrap">
          <textarea
            ref={textareaRef}
            className="new-design-textarea"
            placeholder="描述你的设计想法，或粘贴参考素材的链接..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            type="button"
            className="new-design-send"
            onClick={() => void handleStart()}
            disabled={!input.trim() || loading}
            aria-label="开始设计"
          >
            {loading ? (
              <span className="new-design-spinner" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>

        <div className="new-design-quick-actions">
          {QUICK_ACTIONS.map(item => {
            const Icon = item.icon;
            return 'href' in item ? (
              <a key={item.label} href={item.href} className="new-design-quick-btn">
                <Icon className="w-4 h-4" strokeWidth={1.5} />
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                className="new-design-quick-btn"
                onClick={() => void handleStart(item.prompt)}
              >
                <Icon className="w-4 h-4" strokeWidth={1.5} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
