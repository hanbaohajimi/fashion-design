import { Loader2, RotateCw, Save, Download, AlertCircle } from 'lucide-react';

interface GeneratedCanvasProps {
  imageUrl: string | null;
  isGenerating: boolean;
  error: string | null;
  canGenerate: boolean;
  onRegenerate: () => void;
  onSaveOutfit: () => void;
}

export default function GeneratedCanvas({
  imageUrl,
  isGenerating,
  error,
  canGenerate,
  onRegenerate,
  onSaveOutfit,
}: GeneratedCanvasProps) {
  return (
    <div className="tryon-canvas">
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          aspectRatio: '3 / 4',
          maxWidth: '100%',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {!imageUrl && !isGenerating && !error && (
          <div className="tryon-canvas-empty" style={{ padding: '0 32px' }}>
            <p className="kicker">La Pose &middot; Atelier</p>
            <p className="quote">
              <span className="quote-open">&ldquo;</span>
              <span className="quote-lines">
                <span className="quote-line">选择衣物 / 模特 / 背景，</span>
                <span className="quote-line">让模型为你成像。</span>
              </span>
            </p>
          </div>
        )}

        {imageUrl && !error && (
          <img
            src={imageUrl}
            alt="试衣结果"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}

        {isGenerating && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(245, 242, 236, 0.86)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--color-ink)' }} strokeWidth={1.5} />
            <p className="kicker" style={{ marginTop: 14, fontSize: 11, letterSpacing: '0.22em' }}>
              Generating
            </p>
            <p className="serif" style={{ marginTop: 6, fontSize: 18, color: 'var(--color-ink)', fontStyle: 'italic', fontWeight: 'var(--weight-light)' }}>
              正在生成穿搭…
            </p>
            <p style={{ marginTop: 6, fontSize: 11, color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em' }}>
              通常 10-30 秒 · 可点击「取消」中止
            </p>
          </div>
        )}

        {error && !isGenerating && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
            <div
              style={{
                maxWidth: 360,
                padding: 16,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-danger)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--color-danger)', marginTop: 2 }} strokeWidth={1.5} />
                <div style={{ flex: 1 }}>
                  <p className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--color-danger)' }}>生成失败</p>
                  <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)', letterSpacing: '0.01em', lineHeight: 1.6 }}>
                    {error}
                  </p>
                  <button
                    type="button"
                    onClick={onRegenerate}
                    disabled={!canGenerate}
                    className="tryon-cta"
                    style={{ marginTop: 12, height: 30, padding: '0 14px', fontSize: 11 }}
                  >
                    <RotateCw className="h-3 w-3" strokeWidth={1.5} />
                    重试
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {imageUrl && !isGenerating && !error && (
        <div
          className="tryon-canvas-actions"
          style={{
            flexDirection: 'column',
            padding: 6,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-md)',
            gap: 4,
            bottom: 24,
          }}
        >
          <button
            type="button"
            onClick={onSaveOutfit}
            className="tryon-canvas-action primary"
            title="保存为穿搭方案"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
            保存穿搭
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!canGenerate}
            className="tryon-canvas-action"
            title="使用相同选择重新生成"
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            重新生成
          </button>
          <a
            href={imageUrl}
            download={`tryon_${Date.now()}.png`}
            className="tryon-canvas-action"
            title="下载图片"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            下载
          </a>
        </div>
      )}
    </div>
  );
}
