import { useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import type { PersonalStatic } from '../../../types/profile';

interface OnboardingModalProps {
  onComplete: (data: PersonalStatic) => void;
  onSkip: () => void;
}

const BODY_SHAPES = [
  { value: '苹果型', label: '苹果型', desc: '上宽下窄，腰部圆润' },
  { value: '梨型', label: '梨型', desc: '上窄下宽，臀部较大' },
  { value: '沙漏型', label: '沙漏型', desc: '胸臀均衡，腰线明显' },
  { value: '直筒型', label: '直筒型', desc: '腰线不明显，线条平直' },
  { value: '倒三角型', label: '倒三角型', desc: '肩宽，腰臀较窄' },
] as const;

const CONCERN_OPTIONS = ['遮胯', '显腰', '显高', '遮手臂', '遮腿', '提臀', '显胸'];
const OCCASION_OPTIONS = ['职场', '休闲', '约会', '运动', '正式场合', '旅行', '聚会'];

const STYLE_OPTIONS = [
  { value: '极简', label: '极简主义' },
  { value: '街头', label: '街头风格' },
  { value: '优雅', label: '优雅经典' },
  { value: '复古', label: '复古风格' },
  { value: '运动', label: '运动休闲' },
  { value: '通勤', label: '都市通勤' },
  { value: '浪漫', label: '浪漫少女' },
  { value: '前卫', label: '前卫实验' },
  { value: '户外', label: '户外机能' },
  { value: '法式', label: '法式风情' },
  { value: '日系', label: '日系简约' },
  { value: '美式', label: '美式休闲' },
];

const COLOR_OPTIONS = [
  { value: '莫兰迪', label: '莫兰迪', color: '#B5A89A' },
  { value: '黑白灰', label: '黑白灰', color: '#808080' },
  { value: '大地色', label: '大地色', color: '#C8A97D' },
  { value: '深色系', label: '深色系', color: '#2D3142' },
  { value: '浅色系', label: '浅色系', color: '#F0EDE8' },
  { value: '高饱和', label: '高饱和', color: '#E05C5C' },
  { value: '马卡龙', label: '马卡龙', color: '#B8D8D8' },
  { value: '金属感', label: '金属感', color: '#B8A090' },
];

const BUDGET_OPTIONS = ['亲民', '中端', '中高端', '奢侈'] as const;

function Toggle({ value, label, selected, onToggle }: {
  value: string; label: string; selected: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
        selected
          ? 'bg-gray-900 text-white border-gray-900'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
      }`}
    >
      {label || value}
    </button>
  );
}

export default function OnboardingModal({ onComplete, onSkip }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<PersonalStatic>({
    style_keywords: [],
    concerns: [],
    occasions: [],
    color_palette: [],
    avoid_elements: [],
  });

  const toggle = (field: keyof PersonalStatic, value: string) => {
    setForm(prev => {
      const arr = (prev[field] as string[] | undefined) || [];
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      };
    });
  };

  const steps = [
    {
      title: '你喜欢哪种风格？',
      sub: '多选，可以随时修改',
      content: (
        <div className="flex flex-wrap gap-2">
          {STYLE_OPTIONS.map(opt => (
            <Toggle
              key={opt.value}
              value={opt.value}
              label={opt.label}
              selected={(form.style_keywords || []).includes(opt.value)}
              onToggle={() => toggle('style_keywords', opt.value)}
            />
          ))}
        </div>
      ),
    },
    {
      title: '你的体型和穿搭关注点',
      sub: '帮助 AI 更精准地为你设计',
      content: (
        <div className="space-y-5">
          <div>
            <p className="text-[12px] text-gray-500 mb-2">体型（单选）</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BODY_SHAPES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, body_shape: s.value }))}
                  className={`px-3 py-2.5 rounded-xl border text-left text-[12px] transition-colors ${
                    form.body_shape === s.value
                      ? 'border-gray-900 bg-gray-50 font-semibold'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <p className="font-medium text-gray-800">{s.label}</p>
                  <p className="text-gray-400 text-[11px] mt-0.5">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[12px] text-gray-500 mb-2">穿搭关注点（多选）</p>
            <div className="flex flex-wrap gap-2">
              {CONCERN_OPTIONS.map(c => (
                <Toggle
                  key={c}
                  value={c}
                  label={c}
                  selected={(form.concerns || []).includes(c)}
                  onToggle={() => toggle('concerns', c)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[12px] text-gray-500 mb-2">常见场合（多选）</p>
            <div className="flex flex-wrap gap-2">
              {OCCASION_OPTIONS.map(o => (
                <Toggle
                  key={o}
                  value={o}
                  label={o}
                  selected={(form.occasions || []).includes(o)}
                  onToggle={() => toggle('occasions', o)}
                />
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '颜色偏好与预算',
      sub: '最后一步，完成即可开始个性化设计',
      content: (
        <div className="space-y-5">
          <div>
            <p className="text-[12px] text-gray-500 mb-2">偏好色系（多选）</p>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(c => {
                const selected = (form.color_palette || []).includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => toggle('color_palette', c.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                      selected
                        ? 'border-gray-900 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-gray-200 shrink-0"
                      style={{ background: c.color }}
                    />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[12px] text-gray-500 mb-2">预算档位（单选）</p>
            <div className="flex flex-wrap gap-2">
              {BUDGET_OPTIONS.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, budget_tier: b }))}
                  className={`px-4 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                    form.budget_tier === b
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>
      ),
    },
  ];

  const isLast = step === steps.length - 1;
  const current = steps[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full transition-all ${
                    i === step ? 'w-6 bg-gray-900' : i < step ? 'w-4 bg-gray-400' : 'w-4 bg-gray-200'
                  }`}
                />
              ))}
            </div>
            <h2 className="text-[17px] font-semibold text-gray-900">{current.title}</h2>
            <p className="text-[12px] text-gray-400 mt-0.5">{current.sub}</p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors ml-4 shrink-0"
            title="跳过"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {current.content}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onSkip}
            className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            跳过问卷
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1 px-3 py-2 text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) {
                  onComplete(form);
                } else {
                  setStep(s => s + 1);
                }
              }}
              className="flex items-center gap-1 px-4 py-2 bg-gray-900 text-white text-[12px] font-medium rounded-lg hover:bg-gray-800 transition-colors"
            >
              {isLast ? '完成' : '下一步'}
              {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
