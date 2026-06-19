import { Shirt, User, Image as ImageIcon, Move, Scissors } from 'lucide-react';

export type TryOnModule = 'clothes' | 'model' | 'background' | 'action' | 'beauty';

const MODULES: { id: TryOnModule; label: string; em: string; icon: React.ReactNode }[] = [
  { id: 'clothes',    label: '穿搭', em: 'Garment', icon: <Shirt className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'model',      label: '模特', em: 'Model',   icon: <User className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'background', label: '背景', em: 'Scene',   icon: <ImageIcon className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'action',     label: '动作', em: 'Pose',    icon: <Move className="h-4 w-4" strokeWidth={1.5} /> },
  { id: 'beauty',     label: '美颜', em: 'Beauty',  icon: <Scissors className="h-4 w-4" strokeWidth={1.5} /> },
];

interface LeftModuleBarProps {
  active: TryOnModule;
  onChange: (m: TryOnModule) => void;
}

export default function LeftModuleBar({ active, onChange }: LeftModuleBarProps) {
  return (
    <div className="tryon-rail">
      {MODULES.map((m, idx) => {
        const on = active === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`tryon-rail-item${on ? ' is-active' : ''}`}
            title={m.label}
          >
            <span className="tryon-rail-numeral">{String(idx + 1).padStart(2, '0')}</span>
            <span className="tryon-rail-icon">{m.icon}</span>
            <span className="tryon-rail-label">{m.label}</span>
            <span className="tryon-rail-em">{m.em}</span>
          </button>
        );
      })}
      <div className="tryon-rail-foot">
        <p className="kicker" style={{ writingMode: 'vertical-rl', fontSize: 9, letterSpacing: '0.28em' }}>
          La Pose
        </p>
      </div>
    </div>
  );
}
