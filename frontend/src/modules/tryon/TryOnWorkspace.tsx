import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Eraser, X as XIcon, ChevronUp, ChevronDown } from 'lucide-react';
import './tryon.css';
import { useToast } from '../../components/Toast';
import {
  generateTryOn,
  saveTryOnOutfit,
} from '../../api/profileApi';
import type {
  PresetRef,
  TryOnClothing,
  TryOnGenerationResult,
  TryOnSelection,
} from '../../types/profile';
import LeftModuleBar, { type TryOnModule } from './components/LeftModuleBar';
import SelectionChips from './components/SelectionChips';
import GeneratedCanvas from './components/GeneratedCanvas';
import HistoryStrip from './components/HistoryStrip';
import BottomPresetPanel from './components/BottomPresetPanel';
import SaveOutfitModal from './components/SaveOutfitModal';

interface TryOnWorkspaceProps {
  user: { email: string; name: string; auth_token: string };
}

interface HistoryEntry {
  id: string;
  image_url: string;
  created_at: number;
  result: TryOnGenerationResult;
  /** snapshot of selection used to produce this image */
  selection_snapshot: TryOnSelection;
}

const EMPTY_SELECTION: TryOnSelection = {
  clothes: [],
  model: null,
  background: null,
  action: null,
  beauty: { hairstyle: null, color: null },
  extra_prompt: '',
};

const SELECTION_STORAGE_KEY = 'tryon-selection-v1';
const HISTORY_STORAGE_KEY = 'tryon-history-v1';
const HISTORY_MAX = 3;

function clothingKey(c: TryOnClothing): string {
  return `${c.kind}:${c.id}`;
}

function loadSelection(): TryOnSelection {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return EMPTY_SELECTION;
    const parsed = JSON.parse(raw) as Partial<TryOnSelection>;
    return {
      ...EMPTY_SELECTION,
      ...parsed,
      clothes: Array.isArray(parsed.clothes) ? parsed.clothes : [],
      beauty: {
        hairstyle: parsed.beauty?.hairstyle ?? null,
        color: parsed.beauty?.color ?? null,
      },
    };
  } catch {
    return EMPTY_SELECTION;
  }
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

export default function TryOnWorkspace({ user }: TryOnWorkspaceProps) {
  const { toast } = useToast();
  const authToken = user.auth_token;

  const [activeModule, setActiveModule] = useState<TryOnModule>('clothes');
  const [selection, setSelection] = useState<TryOnSelection>(() => loadSelection());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(() => {
    const h = loadHistory();
    return h[0]?.id ?? null;
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPromptPanel, setShowPromptPanel] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Persist selection
  useEffect(() => {
    try {
      sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
    } catch {
      /* ignore quota */
    }
  }, [selection]);

  // Persist history
  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* ignore quota */
    }
  }, [history]);

  const activeHistory = useMemo(
    () => history.find(h => h.id === activeHistoryId) || null,
    [history, activeHistoryId],
  );
  const currentImage = activeHistory?.image_url || null;

  const toggleClothing = useCallback((c: TryOnClothing) => {
    setSelection(prev => {
      const key = clothingKey(c);
      const exists = prev.clothes.some(x => clothingKey(x) === key);
      return {
        ...prev,
        clothes: exists ? prev.clothes.filter(x => clothingKey(x) !== key) : [...prev.clothes, c],
      };
    });
  }, []);

  const removeClothing = useCallback((c: TryOnClothing) => {
    const key = clothingKey(c);
    setSelection(prev => ({
      ...prev,
      clothes: prev.clothes.filter(x => clothingKey(x) !== key),
    }));
  }, []);

  const updateModel = useCallback((p: PresetRef | null) => {
    setSelection(prev => ({ ...prev, model: p }));
  }, []);
  const updateBackground = useCallback((p: PresetRef | null) => {
    setSelection(prev => ({ ...prev, background: p }));
  }, []);
  const updateAction = useCallback((p: PresetRef | null) => {
    setSelection(prev => ({ ...prev, action: p }));
  }, []);
  const updateBeauty = useCallback((kind: 'hairstyle' | 'color', p: PresetRef | null) => {
    setSelection(prev => ({
      ...prev,
      beauty: { ...prev.beauty, [kind]: p },
    }));
  }, []);
  const updateExtraPrompt = useCallback((s: string) => {
    setSelection(prev => ({ ...prev, extra_prompt: s }));
  }, []);

  const hasAnySelection = useMemo(
    () =>
      selection.clothes.length > 0
      || !!selection.model
      || !!selection.background
      || !!selection.action
      || !!selection.beauty.hairstyle
      || !!selection.beauty.color
      || !!selection.extra_prompt.trim(),
    [selection],
  );

  const handleClearAll = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);

  const canGenerate = selection.clothes.length > 0 && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setError(null);
    setIsGenerating(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const snapshot: TryOnSelection = {
      ...selection,
      clothes: [...selection.clothes],
      beauty: { ...selection.beauty },
    };
    try {
      const result = await generateTryOn(authToken, selection, ac.signal);
      if (ac.signal.aborted) return;
      // Preload the generated image so the canvas swap is instant.
      try {
        const img = new Image();
        img.src = result.image_url;
      } catch {
        /* ignore */
      }
      const entry: HistoryEntry = {
        id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        image_url: result.image_url,
        created_at: Date.now(),
        result,
        selection_snapshot: snapshot,
      };
      setHistory(prev => [entry, ...prev].slice(0, HISTORY_MAX));
      setActiveHistoryId(entry.id);
      const sec = result.elapsed_seconds ?? null;
      toast(`生成完成${sec ? `（${sec}s）` : ''}`, 'success');
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        // Cancelled by user — do not show as error.
        return;
      }
      const msg = e instanceof Error ? e.message : '生成失败';
      setError(msg);
      toast(msg, 'error');
    } finally {
      if (!ac.signal.aborted) setIsGenerating(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [authToken, canGenerate, selection, toast]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
    toast('已取消生成', 'info');
  }, [toast]);

  // Cmd/Ctrl+Enter shortcut
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        // Ignore when typing in an input/textarea that has its own handler.
        const tgt = e.target as HTMLElement | null;
        if (tgt && (tgt.tagName === 'TEXTAREA' || tgt.tagName === 'INPUT')) {
          // Only block when typing in modal — allow in workspace's extra-prompt textarea too via Ctrl+Enter
          if (tgt.closest('[data-tryon-modal]')) return;
        }
        e.preventDefault();
        if (canGenerate) handleGenerate();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canGenerate, handleGenerate]);

  const handleSaveOutfit = useCallback(
    async (meta: { name: string; description?: string; occasion?: string; season?: string }) => {
      if (!activeHistory) throw new Error('没有可保存的生成图');
      const snap = activeHistory.selection_snapshot;
      const wardrobeIds: string[] = [];
      const presetIds: string[] = [];
      snap.clothes.forEach(c => {
        if (c.kind === 'wardrobe') wardrobeIds.push(c.id);
        else presetIds.push(c.id);
      });
      const res = await saveTryOnOutfit(authToken, {
        name: meta.name,
        generated_image_url: activeHistory.image_url,
        wardrobe_item_ids: wardrobeIds,
        preset_clothing_ids: presetIds,
        description: meta.description,
        occasion: meta.occasion,
        season: meta.season,
      });
      toast(
        `已保存「${meta.name}」到我的衣橱 · 穿搭方案${res.ingested_preset_ids.length ? `（系统衣物 ${res.ingested_preset_ids.length} 件已入库）` : ''}`,
        'success',
      );
    },
    [activeHistory, authToken, toast],
  );

  const itemCount = useMemo(() => {
    if (!activeHistory) return { wardrobe: 0, preset: 0 };
    const snap = activeHistory.selection_snapshot;
    return {
      wardrobe: snap.clothes.filter(c => c.kind === 'wardrobe').length,
      preset: snap.clothes.filter(c => c.kind === 'preset').length,
    };
  }, [activeHistory]);

  const promptPreview = useMemo(() => {
    const lines: string[] = ['让模特穿上展示的服装，保持人物五官与体型不变，自然贴合。'];
    const primary = selection.clothes.slice(0, 2);
    const extras = selection.clothes.slice(2);
    if (primary.length) {
      lines.push(`主要服装（图）：${primary.map(c => c.name || c.id).join(', ')}`);
    }
    if (extras.length) {
      const descs = extras
        .map(c => (c.kind === 'preset' ? c.prompt || c.name : c.name))
        .filter(Boolean);
      if (descs.length) lines.push(`额外服装/配饰（文字）：${descs.join(', ')}`);
    }
    if (selection.background) lines.push(`背景：${selection.background.prompt || selection.background.name}`);
    if (selection.action) lines.push(`动作：${selection.action.prompt || selection.action.name}`);
    if (selection.beauty.hairstyle)
      lines.push(`发型：${selection.beauty.hairstyle.prompt || selection.beauty.hairstyle.name}`);
    if (selection.beauty.color)
      lines.push(`发色：${selection.beauty.color.prompt || selection.beauty.color.name}`);
    if (selection.extra_prompt.trim()) lines.push(`其他要求：${selection.extra_prompt.trim()}`);
    return lines.join('\n');
  }, [selection]);

  return (
    <div className="tryon-shell">
      <LeftModuleBar active={activeModule} onChange={setActiveModule} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: chips + generate button */}
        <div className="tryon-topbar">
          <div className="min-w-0 flex-1">
            <SelectionChips
              selection={selection}
              defaultModelHint={!selection.model}
              onRemoveClothes={removeClothing}
              onClearModel={() => updateModel(null)}
              onClearBackground={() => updateBackground(null)}
              onClearAction={() => updateAction(null)}
              onClearBeauty={kind => updateBeauty(kind, null)}
            />
          </div>
          {hasAnySelection && !isGenerating && (
            <button
              type="button"
              onClick={handleClearAll}
              className="tryon-pill"
              title="清空所有选择"
            >
              <Eraser className="h-3 w-3" strokeWidth={1.5} />
              清空
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPromptPanel(v => !v)}
            className={`tryon-pill${showPromptPanel ? ' is-on' : ''}`}
            title="查看/编辑提示词"
          >
            {showPromptPanel ? <ChevronUp className="h-3 w-3" strokeWidth={1.5} /> : <ChevronDown className="h-3 w-3" strokeWidth={1.5} />}
            提示词
          </button>
          {isGenerating ? (
            <button
              type="button"
              onClick={handleCancel}
              className="tryon-cta cancel"
              title="取消正在进行的生成"
            >
              <XIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
              取消
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="tryon-cta"
              title={
                !selection.clothes.length ? '请至少选择一件衣物' : '生成穿搭 (Ctrl/Cmd+Enter)'
              }
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              生成
            </button>
          )}
        </div>

        {/* Optional prompt preview / extra prompt panel */}
        {showPromptPanel && (
          <div className="tryon-prompt-panel">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em', marginBottom: 6 }}>
                  Prompt &middot; Auto-Composed
                </p>
                <pre className="tryon-prompt-preview">{promptPreview}</pre>
              </div>
              <div>
                <p className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em', marginBottom: 6 }}>
                  Append &middot; Custom
                </p>
                <textarea
                  value={selection.extra_prompt}
                  onChange={e => updateExtraPrompt(e.target.value)}
                  maxLength={300}
                  rows={4}
                  placeholder="例如：腰间束带、白平衡偏冷..."
                  className="tryon-prompt-extra"
                />
                <p className="tryon-prompt-count">
                  {selection.extra_prompt.length}/300
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <GeneratedCanvas
          imageUrl={currentImage}
          isGenerating={isGenerating}
          error={error}
          canGenerate={canGenerate}
          onRegenerate={handleGenerate}
          onSaveOutfit={() => setShowSaveModal(true)}
        />

        {/* History strip */}
        <HistoryStrip
          history={history}
          activeId={activeHistoryId}
          onSelect={setActiveHistoryId}
        />

        {/* Bottom preset panel */}
        <BottomPresetPanel
          authToken={authToken}
          module={activeModule}
          selection={selection}
          onToggleClothes={toggleClothing}
          onSelectModel={updateModel}
          onSelectBackground={updateBackground}
          onSelectAction={updateAction}
          onSelectBeauty={updateBeauty}
        />
      </div>

      <div data-tryon-modal>
        <SaveOutfitModal
          open={showSaveModal}
          defaultName={`穿搭 ${new Date().toLocaleDateString()}`}
          itemCount={itemCount}
          onClose={() => setShowSaveModal(false)}
          onSave={handleSaveOutfit}
        />
      </div>
    </div>
  );
}
