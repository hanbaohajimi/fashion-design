import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Plus, User, Palette } from 'lucide-react';
import type { DesignerWorkspace, SessionMode } from '../../../types/profile';

interface ModeBarProps {
  authToken: string;
  workspace: DesignerWorkspace | null;
  selectedMode: SessionMode;
  selectedProjectId: string | null;
  onModeChange: (mode: SessionMode, projectId: string | null) => void;
  onNewProject: () => void;
  /** Called when mode is designer but no projects exist */
  onNeedProject: () => void;
}

export default function ModeBar({
  workspace,
  selectedMode,
  selectedProjectId,
  onModeChange,
  onNewProject,
  onNeedProject,
}: ModeBarProps) {
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const activeProjects = (workspace?.projects || []).filter(p => p.status === 'active');
  const selectedProject = activeProjects.find(p => p.id === selectedProjectId);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleSelectPersonal = () => {
    onModeChange('personal', null);
  };

  const handleSelectDesigner = () => {
    if (activeProjects.length === 0) {
      onNeedProject();
      return;
    }
    const defaultPid = selectedProjectId && activeProjects.find(p => p.id === selectedProjectId)
      ? selectedProjectId
      : activeProjects[0].id;
    onModeChange('designer', defaultPid);
  };

  const handleSelectProject = (pid: string) => {
    onModeChange('designer', pid);
    setDropOpen(false);
  };

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-100">
      {/* Personal mode button */}
      <button
        type="button"
        onClick={handleSelectPersonal}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
          selectedMode === 'personal'
            ? 'bg-gray-900 text-white'
            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
        }`}
      >
        <User className="w-3.5 h-3.5" />
        个人穿搭
      </button>

      {/* Designer mode button + dropdown */}
      <div className="relative" ref={dropRef}>
        <button
          type="button"
          onClick={() => {
            if (selectedMode !== 'designer') {
              handleSelectDesigner();
            } else {
              setDropOpen(o => !o);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
            selectedMode === 'designer'
              ? 'bg-gray-900 text-white'
              : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          设计师模式
          {selectedMode === 'designer' && (
            <>
              {selectedProject && (
                <span className="max-w-[100px] truncate opacity-70 ml-1 text-[11px]">
                  · {selectedProject.name}
                </span>
              )}
              <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
            </>
          )}
        </button>

        {dropOpen && selectedMode === 'designer' && (
          <div className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-gray-200 bg-white shadow-lg z-50 py-1">
            {activeProjects.map(proj => (
              <button
                key={proj.id}
                type="button"
                onClick={() => handleSelectProject(proj.id)}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-gray-50 transition-colors flex items-center gap-2 ${
                  proj.id === selectedProjectId ? 'font-semibold text-gray-900' : 'text-gray-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate">{proj.name}</span>
              </button>
            ))}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                type="button"
                onClick={() => { setDropOpen(false); onNewProject(); }}
                className="w-full text-left px-3 py-2 text-[12px] text-gray-500 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" />
                新建项目
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
