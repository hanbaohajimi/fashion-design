import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface NewProjectFormProps {
  onComplete: (data: { name: string; brief: object; design_language: object }) => void;
  onCancel: () => void;
}

const STYLE_ANCHOR_OPTIONS = ['极简', '解构', '浪漫', '街头', '优雅', '实验', '前卫', '学院', '机能', '复古'];
const SILHOUETTE_OPTIONS = ['A型', 'H型', '茧型', 'X型', '不对称', '宽松', '落肩', '垂坠'];
const FABRIC_OPTIONS = ['亚麻', '真丝', '羊毛', '牛仔', '皮革', '技术面料', '双宫丝', '压缩棉', '薄纱'];

function TagInput({ label, options, value, onChange }: {
  label: string;
  options?: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [inputVal, setInputVal] = useState('');
  const add = (tag: string) => {
    const t = tag.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setInputVal('');
  };
  const remove = (tag: string) => onChange(value.filter(v => v !== tag));

  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-[color:var(--text-secondary)]">{label}</p>
      {options && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => value.includes(opt) ? remove(opt) : add(opt)}
              className={`min-h-[32px] px-3 py-1 rounded-full text-[11px] border transition-colors ${
                value.includes(opt)
                  ? 'bg-[color:var(--ink)] text-white border-[color:var(--ink)]'
                  : 'border-[color:var(--border)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 items-center border border-[color:var(--color-border)] rounded-2xl bg-[color:var(--color-surface)] px-3 py-2 min-h-[44px] focus-within:border-[color:var(--color-accent)] focus-within:shadow-[0_0_0_4px_rgba(66,133,244,0.12)]">
        {value.map(tag => (
          <span
            key={tag}
            className="flex items-center gap-1 px-2 py-0.5 bg-[color:var(--paper)] text-[color:var(--text-primary)] rounded-lg text-[11px]"
          >
            {tag}
            <button type="button" onClick={() => remove(tag)} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && inputVal.trim()) {
              e.preventDefault();
              add(inputVal);
            }
          }}
          placeholder="输入后回车添加"
          className="flex-1 min-w-[80px] text-[12px] outline-none bg-transparent placeholder:text-[color:var(--text-dim)]"
        />
      </div>
    </div>
  );
}

export default function NewProjectForm({ onComplete, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [styleAnchors, setStyleAnchors] = useState<string[]>([]);
  const [referenceDesigners, setReferenceDesigners] = useState<string[]>([]);
  const [silhouettes, setSilhouettes] = useState<string[]>([]);
  const [fabrics, setFabrics] = useState<string[]>([]);
  const [moodKeywords, setMoodKeywords] = useState<string[]>([]);
  const [avoidDirections, setAvoidDirections] = useState<string[]>([]);
  const [nameError, setNameError] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) { setNameError('请填写项目名称'); return; }
    onComplete({
      name: name.trim(),
      brief: {
        season: season.trim() || undefined,
        target_audience: targetAudience.trim() || undefined,
        style_anchors: styleAnchors,
        reference_designers: referenceDesigners,
        mood_keywords: moodKeywords,
        avoid_directions: avoidDirections,
      },
      design_language: {
        silhouettes,
        fabric_preferences: fabrics,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
      <div className="dialog-panel w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[color:var(--border-soft)]">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">新建设计项目</h2>
            <p className="text-[12px] text-[color:var(--text-secondary)] mt-1">建立本项目的设计档案，AI 将保持风格一致性</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost btn-square min-h-10 h-10 w-10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="text-[12px] font-medium text-[color:var(--text-secondary)] block mb-2">
              项目名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setNameError(''); }}
              placeholder="例：2025 秋冬系列"
              className={`input-shell text-[13px] ${
                nameError ? 'border-red-300' : ''
              }`}
            />
            {nameError && <p className="text-red-400 text-[11px] mt-1">{nameError}</p>}
          </div>

          {/* Season */}
          <div>
            <label className="text-[12px] font-medium text-[color:var(--text-secondary)] block mb-2">季节 / 系列</label>
            <input
              type="text"
              value={season}
              onChange={e => setSeason(e.target.value)}
              placeholder="例：2025AW"
              className="input-shell text-[13px]"
            />
          </div>

          {/* Target Audience */}
          <div>
            <label className="text-[12px] font-medium text-[color:var(--text-secondary)] block mb-2">目标客群</label>
            <input
              type="text"
              value={targetAudience}
              onChange={e => setTargetAudience(e.target.value)}
              placeholder="例：都市职业女性 25-35"
              className="input-shell text-[13px]"
            />
          </div>

          {/* Style Anchors */}
          <TagInput
            label="风格锚点"
            options={STYLE_ANCHOR_OPTIONS}
            value={styleAnchors}
            onChange={setStyleAnchors}
          />

          {/* Reference Designers */}
          <TagInput
            label="参考设计师 / 品牌"
            value={referenceDesigners}
            onChange={setReferenceDesigners}
          />

          {/* Silhouettes */}
          <TagInput
            label="主要廓形方向"
            options={SILHOUETTE_OPTIONS}
            value={silhouettes}
            onChange={setSilhouettes}
          />

          {/* Fabrics */}
          <TagInput
            label="面料语言"
            options={FABRIC_OPTIONS}
            value={fabrics}
            onChange={setFabrics}
          />

          {/* Mood Keywords */}
          <TagInput
            label="情绪关键词"
            value={moodKeywords}
            onChange={setMoodKeywords}
          />

          {/* Avoid */}
          <TagInput
            label="本项目禁区（避免的方向）"
            value={avoidDirections}
            onChange={setAvoidDirections}
          />
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[color:var(--border-soft)] bg-[color:var(--paper)]">
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost text-[12px]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary text-[12px] font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            创建项目
          </button>
        </div>
      </div>
    </div>
  );
}
