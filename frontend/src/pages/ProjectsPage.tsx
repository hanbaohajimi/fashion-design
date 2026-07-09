import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, FolderOpen, Clock } from 'lucide-react';
import { fetchProjects, createProject, type Project } from '../api/designsApi';
import { formatDate } from '../utils/date';
import './projects.css';

interface ProjectsPageProps {
  user: { email: string; name: string; auth_token: string };
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      await onCreate(name.trim(), description.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="projects-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="projects-modal">
        <h2 className="projects-modal-title">创建项目</h2>
        <div className="projects-modal-field">
          <label className="projects-modal-label">项目名称</label>
          <input
            className="projects-modal-input"
            placeholder="春夏女装系列"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
          />
        </div>
        <div className="projects-modal-field">
          <label className="projects-modal-label">你想实现什么？</label>
          <textarea
            className="projects-modal-textarea"
            placeholder="生成一套完整系列，包括趋势分析、设计图、试衣效果和项目整理..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div className="projects-modal-actions">
          <button type="button" className="projects-modal-cancel" onClick={onClose}>取消</button>
          <button
            type="button"
            className="projects-modal-create"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || loading}
          >
            {loading ? '创建中...' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage({ user }: ProjectsPageProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const list = await fetchProjects(user.auth_token, q);
      setProjects(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user.auth_token]);

  useEffect(() => {
    void load(search);
  }, [load, search]);

  const handleCreate = async (name: string, description: string) => {
    const project = await createProject(user.auth_token, name, description);
    setShowModal(false);
    navigate(`/projects/${project.id}`);
  };

  const filtered = projects; // server-side search already applied

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h1 className="projects-title">项目</h1>
        <div className="projects-toolbar">
          <div className="projects-search-wrap">
            <Search className="projects-search-icon w-4 h-4" strokeWidth={1.5} />
            <input
              className="projects-search"
              placeholder="搜索项目..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="projects-toolbar-right">
            <span className="projects-sort-label">按最近更新排序</span>
            <button
              type="button"
              className="projects-new-btn"
              onClick={() => setShowModal(true)}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              新建项目
            </button>
          </div>
        </div>
      </div>

      <div className="projects-body">
        {loading ? (
          <div className="projects-empty">
            <span className="projects-empty-text">加载中...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="projects-empty">
            <FolderOpen className="w-10 h-10 text-[color:var(--color-ink-3)]" strokeWidth={1} />
            <p className="projects-empty-text">
              {search ? `没有找到"${search}"相关项目` : '还没有项目，点击「新建项目」开始吧'}
            </p>
          </div>
        ) : (
          <div className="projects-grid">
            {filtered.map(p => (
              <button
                key={p.id}
                type="button"
                className="project-card"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <p className="project-card-name">{p.name}</p>
                {p.description && (
                  <p className="project-card-desc">{p.description}</p>
                )}
                <div className="project-card-meta">
                  <Clock className="w-3 h-3" strokeWidth={1.5} />
                  更新于 {formatDate(p.updated_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
