import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, FabricImage, type FabricObject } from 'fabric';
import {
  X,
  Download,
  Sparkles,
  MousePointer2,
  Paintbrush,
  Eraser,
  Trash2,
  Loader2,
  Wand2,
} from 'lucide-react';
import { useToast } from '../../../components/Toast';

type EditorTool = 'move' | 'brush' | 'eraser';

interface FabricEditorProps {
  imageDataUrl: string;
  mode?: 'image';
  onClose: () => void;
  onSendToAI?: (dataUrl: string) => void;
  sessionId?: string;
  authToken: string;
}

function hasMaskContent(mask: HTMLCanvasElement): boolean {
  const ctx = mask.getContext('2d');
  if (!ctx) return false;
  const { width: w, height: h } = mask;
  if (w === 0 || h === 0) return false;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (d[i]! > 25) return true;
    }
  }
  return false;
}

function redrawMaskOverlay(
  overlay: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  imgRect: { left: number; top: number; width: number; height: number },
  nw: number,
  nh: number,
) {
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const r = imgRect;
  const tmp = document.createElement('canvas');
  const tw = Math.max(1, Math.ceil(r.width));
  const th = Math.max(1, Math.ceil(r.height));
  tmp.width = tw;
  tmp.height = th;
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  tctx.fillStyle = '#000';
  tctx.fillRect(0, 0, tw, th);
  tctx.drawImage(mask, 0, 0, nw, nh, 0, 0, tw, th);
  ctx.save();
  ctx.fillStyle = 'rgba(248, 113, 113, 0.42)';
  ctx.fillRect(r.left, r.top, r.width, r.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(tmp, r.left, r.top);
  ctx.restore();
}

const FabricEditor: React.FC<FabricEditorProps> = ({
  imageDataUrl,
  onClose,
  onSendToAI,
  sessionId,
  authToken,
}) => {
  const { toast } = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const fabricImgRef = useRef<FabricImage | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const naturalRef = useRef({ w: 0, h: 0 });
  const drawingRef = useRef(false);

  const [busy, setBusy] = useState(true);
  const [tool, setTool] = useState<EditorTool>('move');
  const [brushSize, setBrushSize] = useState(48);
  const [smartPrompt, setSmartPrompt] = useState('');
  const [applying, setApplying] = useState(false);
  const [sourceUrl, setSourceUrl] = useState(imageDataUrl);

  const refreshMaskPreview = useCallback(() => {
    const img = fabricImgRef.current;
    const mask = maskRef.current;
    const ov = overlayRef.current;
    const c = fabricRef.current;
    if (!img || !mask || !ov || !c) return;
    const w = c.getWidth();
    const h = c.getHeight();
    if (ov.width !== w || ov.height !== h) {
      ov.width = w;
      ov.height = h;
    }
    const nw = naturalRef.current.w;
    const nh = naturalRef.current.h;
    if (!nw || !nh) return;
    redrawMaskOverlay(ov, mask, img.getBoundingRect(), nw, nh);
  }, []);

  const paintAt = useCallback(
    (clientX: number, clientY: number, mode: 'brush' | 'eraser') => {
      const img = fabricImgRef.current;
      const mask = maskRef.current;
      const c = fabricRef.current;
      if (!img || !mask || !c) return;
      const nw = naturalRef.current.w;
      const nh = naturalRef.current.h;
      if (!nw || !nh) return;

      const rect = c.upperCanvasEl.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const r = img.getBoundingRect();
      if (px < r.left || px > r.left + r.width || py < r.top || py > r.top + r.height) return;

      const u = (px - r.left) / r.width;
      const v = (py - r.top) / r.height;
      const nx = u * nw;
      const ny = v * nh;
      const mctx = mask.getContext('2d');
      if (!mctx) return;
      const radiusNat = (brushSize / 2) * (nw / r.width);
      mctx.beginPath();
      mctx.arc(nx, ny, Math.max(1, radiusNat), 0, Math.PI * 2);
      mctx.fillStyle = mode === 'brush' ? '#ffffff' : '#000000';
      mctx.fill();

      refreshMaskPreview();
    },
    [brushSize, refreshMaskPreview],
  );

  const clearMask = useCallback(() => {
    const mask = maskRef.current;
    const nw = naturalRef.current.w;
    const nh = naturalRef.current.h;
    if (!mask || !nw || !nh) return;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.fillStyle = '#000000';
    mctx.fillRect(0, 0, nw, nh);
    refreshMaskPreview();
    toast('已清空涂抹区域', 'info');
  }, [refreshMaskPreview, toast]);

  const exportPng = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getObjects()[0] as FabricObject | undefined;
    const url =
      obj?.toDataURL({ format: 'png', quality: 1, multiplier: 2 }) ??
      c.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
    const a = document.createElement('a');
    a.href = url;
    a.download = `design-edited-${Date.now()}.png`;
    a.click();
    toast('开始下载', 'success');
  }, [toast]);

  const sendAi = useCallback(() => {
    const c = fabricRef.current;
    if (!c || !onSendToAI) return;
    const obj = c.getObjects()[0] as FabricObject | undefined;
    const url =
      obj?.toDataURL({ format: 'png', quality: 1, multiplier: 2 }) ?? c.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
    onSendToAI(url);
    toast('已导出到 AI 对话', 'info');
    onClose();
  }, [onSendToAI, onClose, toast]);

  const initMaskForImage = useCallback((img: FabricImage) => {
    const el = img.getElement() as HTMLImageElement;
    const nw = el.naturalWidth || Math.max(1, Math.round(img.width || 1));
    const nh = el.naturalHeight || Math.max(1, Math.round(img.height || 1));
    naturalRef.current = { w: nw, h: nh };
    const mc = document.createElement('canvas');
    mc.width = nw;
    mc.height = nh;
    const mctx = mc.getContext('2d');
    if (mctx) {
      mctx.fillStyle = '#000000';
      mctx.fillRect(0, 0, nw, nh);
    }
    maskRef.current = mc;
  }, []);

  const applySmartEdit = useCallback(async () => {
    const mask = maskRef.current;
    const prompt = smartPrompt.trim();
    if (!mask || !naturalRef.current.w) {
      toast('图片未就绪', 'error');
      return;
    }
    if (!hasMaskContent(mask)) {
      toast('请先用「画笔」在图上涂抹要修改的区域（红色半透明为已选区）', 'error');
      return;
    }
    if (!prompt) {
      toast('请填写修改说明，例如：去掉卫衣帽子上的抽绳', 'error');
      return;
    }

    setApplying(true);
    try {
      const baseRes = await fetch(sourceUrl, { mode: 'cors' });
      if (!baseRes.ok) throw new Error('无法读取原图');
      const baseBlob = await baseRes.blob();
      const baseFile = new File([baseBlob], 'base.png', { type: baseBlob.type || 'image/png' });

      const maskBlob = await new Promise<Blob | null>((resolve) =>
        mask.toBlob((b) => resolve(b), 'image/png'),
      );
      if (!maskBlob) throw new Error('蒙版导出失败');
      const maskFile = new File([maskBlob], 'mask.png', { type: 'image/png' });

      const fd = new FormData();
      fd.append('instruction', prompt);
      fd.append('base_image', baseFile);
      fd.append('mask_image', maskFile);
      if (sessionId) fd.append('session_id', sessionId);

      const res = await fetch('/api/design/edit_with_mask', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; detail?: string };
      if (!res.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : `请求失败 ${res.status}`);
      }
      if (!data.url) throw new Error('未返回结果图');

      const resolved =
        data.url.startsWith('http') || data.url.startsWith('data:')
          ? data.url
          : `${window.location.origin}${data.url.startsWith('/') ? '' : '/'}${data.url}`;

      setSourceUrl(resolved);
      setSmartPrompt('');

      const canvas = fabricRef.current;
      if (canvas) {
        const old = fabricImgRef.current;
        if (old) canvas.remove(old);
        const next = await FabricImage.fromURL(resolved, { crossOrigin: 'anonymous' });
        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        initMaskForImage(next);
        const iw = next.width || naturalRef.current.w;
        const ih = next.height || naturalRef.current.h;
        const s = Math.min((cw - 40) / iw, (ch - 40) / ih, 1);
        next.scale(s);
        next.set({ left: cw / 2, top: ch / 2, originX: 'center', originY: 'center' });
        next.set({
          cornerColor: '#fff',
          cornerStrokeColor: '#71717a',
          borderColor: '#71717a',
          cornerSize: 10,
          transparentCorners: false,
        });
        canvas.add(next);
        fabricImgRef.current = next;
        next.on('moving', () => requestAnimationFrame(refreshMaskPreview));
        next.on('scaling', () => requestAnimationFrame(refreshMaskPreview));
        next.on('modified', () => requestAnimationFrame(refreshMaskPreview));
        canvas.setActiveObject(next);
        canvas.requestRenderAll();
        requestAnimationFrame(refreshMaskPreview);
      }

      toast('智能修改完成，可继续涂抹或再次提交', 'success');
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : '智能修改失败', 'error');
    } finally {
      setApplying(false);
    }
  }, [smartPrompt, sourceUrl, sessionId, toast, refreshMaskPreview, initMaskForImage]);

  useEffect(() => {
    setSourceUrl(imageDataUrl);
  }, [imageDataUrl]);

  useEffect(() => {
    const el = canvasElRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;

    const fallbackW = Math.min(Math.max(window.innerWidth - 320, 320), 900);
    const fallbackH = Math.min(Math.max(window.innerHeight - 160, 280), 560);
    const w = Math.max(320, Math.min(wrap.clientWidth || fallbackW, 900));
    const h = Math.max(280, Math.min(wrap.clientHeight || fallbackH, 560));
    const canvas = new Canvas(el, { width: w, height: h, backgroundColor: '#1e293b' });
    fabricRef.current = canvas;

    let cancelled = false;

    (async () => {
      try {
        const img = await FabricImage.fromURL(sourceUrl, { crossOrigin: 'anonymous' });
        if (cancelled) return;

        initMaskForImage(img);

        const iw = img.width || naturalRef.current.w;
        const ih = img.height || naturalRef.current.h;
        const s = Math.min((w - 40) / iw, (h - 40) / ih, 1);
        img.scale(s);
        img.set({ left: w / 2, top: h / 2, originX: 'center', originY: 'center' });
        img.set({
          cornerColor: '#fff',
          cornerStrokeColor: '#71717a',
          borderColor: '#71717a',
          cornerSize: 10,
          transparentCorners: false,
        });
        canvas.add(img);
        fabricImgRef.current = img;
        canvas.setActiveObject(img);

        img.on('moving', () => requestAnimationFrame(refreshMaskPreview));
        img.on('scaling', () => requestAnimationFrame(refreshMaskPreview));
        img.on('modified', () => requestAnimationFrame(refreshMaskPreview));

        canvas.requestRenderAll();
        requestAnimationFrame(refreshMaskPreview);
      } catch (e) {
        console.error(e);
        toast('加载图片失败', 'error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      canvas.dispose();
      fabricRef.current = null;
      fabricImgRef.current = null;
      maskRef.current = null;
    };
  }, [sourceUrl, toast, initMaskForImage, refreshMaskPreview]);

  useEffect(() => {
    const c = fabricRef.current;
    const img = fabricImgRef.current;
    if (!c || !img) return;
    const upper = c.upperCanvasEl;
    if (tool === 'move') {
      c.selection = true;
      upper.style.pointerEvents = 'auto';
      img.set({ selectable: true, evented: true });
    } else {
      c.discardActiveObject();
      c.selection = false;
      upper.style.pointerEvents = 'none';
      img.set({ selectable: false, evented: false });
    }
    c.requestRenderAll();
  }, [tool, busy]);

  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    const onDown = (e: PointerEvent) => {
      if (tool !== 'brush' && tool !== 'eraser') return;
      e.preventDefault();
      e.stopPropagation();
      drawingRef.current = true;
      try {
        ov.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      paintAt(e.clientX, e.clientY, tool === 'brush' ? 'brush' : 'eraser');
    };
    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current || (tool !== 'brush' && tool !== 'eraser')) return;
      e.preventDefault();
      paintAt(e.clientX, e.clientY, tool === 'brush' ? 'brush' : 'eraser');
    };
    const onUp = (e: PointerEvent) => {
      try {
        if (typeof ov.hasPointerCapture === 'function' && ov.hasPointerCapture(e.pointerId)) {
          ov.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
      drawingRef.current = false;
    };
    ov.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      ov.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [tool, paintAt]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const toolBtn = (t: EditorTool, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      disabled={busy}
      title={label}
      className={`flex flex-col items-center gap-1 p-2.5 rounded-xl text-[10px] font-medium transition-colors disabled:opacity-40 ${
        tool === t ? 'bg-[color:var(--color-accent)] text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[50] flex flex-col" style={{ background: 'var(--color-paper-ink)', color: 'rgba(245, 242, 236, 0.92)' }}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div>
          <p className="text-sm font-semibold">智能编辑</p>
          <p className="text-[11px] text-white/45 mt-0.5">
            移动/缩放底图 · 画笔涂抹修改区域 · 填写说明后应用智能修改（对接后端 /api/edit_with_mask）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportPng}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> 下载当前图
          </button>
          {onSendToAI && (
            <button
              type="button"
              onClick={sendAi}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[color:var(--color-accent)] hover:opacity-90 text-xs disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" /> 发送到 AI
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/70"
            title="关闭 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 中间区域：单块舞台水平垂直居中（避免 Fabric 容器与蒙版层被当成两个 flex 子项挤到左侧） */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 flex items-center justify-center p-3 md:p-4 min-h-[280px] bg-slate-900/40">
            <div
              ref={wrapRef}
              className="relative rounded-xl ring-1 ring-white/15 bg-slate-900/60 shadow-xl shrink-0"
            >
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm z-[120] rounded-xl bg-slate-900/80">
                  加载中…
                </div>
              )}
              <canvas ref={canvasElRef} className="block max-w-[min(100vw-2rem,900px)] max-h-[min(70vh,560px)]" />
              {/* 与 Fabric 生成的 wrapper 同宽同高叠放，保证画笔命中蒙版层 */}
              <canvas
                ref={overlayRef}
                className={`absolute left-0 top-0 z-[100] touch-none rounded-xl ${
                  tool === 'brush' || tool === 'eraser' ? 'pointer-events-auto' : 'pointer-events-none'
                }`}
                style={{
                  width: '100%',
                  height: '100%',
                  cursor: tool === 'brush' || tool === 'eraser' ? 'crosshair' : 'default',
                }}
              />
            </div>
          </div>
          <p className="text-[10px] text-white/35 py-2 text-center px-2 shrink-0">
            红色半透明为将提交给 AI 修改的区域；画笔/橡皮模式下上层 Fabric 已关闭指针，请在图上直接涂抹
          </p>
        </div>

        <aside className="w-[280px] shrink-0 border-l border-white/10 flex flex-col bg-black/20 p-3 gap-4 overflow-y-auto">
          <div>
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-2">工具</p>
            <div className="grid grid-cols-2 gap-2">
              {toolBtn('move', <MousePointer2 className="w-4 h-4" />, '移动')}
              {toolBtn('brush', <Paintbrush className="w-4 h-4" />, '画笔')}
              {toolBtn('eraser', <Eraser className="w-4 h-4" />, '橡皮')}
            </div>
            <button
              type="button"
              onClick={clearMask}
              disabled={busy}
              className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white/80 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> 清空选区
            </button>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-2">笔刷大小</p>
            <input
              type="range"
              min={8}
              max={120}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-full accent-[color:var(--color-accent)]"
            />
            <p className="text-[10px] text-white/40 mt-1 tabular-nums">{brushSize}px</p>
          </div>

          <div className="flex-1 flex flex-col min-h-[160px]">
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5" /> 智能修改
            </p>
            <textarea
              value={smartPrompt}
              onChange={(e) => setSmartPrompt(e.target.value)}
              disabled={applying}
              placeholder="描述希望如何修改已涂抹区域，例如：去掉帽子上的毛球、把袖子改成短袖…"
              className="flex-1 min-h-[100px] w-full rounded-xl bg-white/8 border border-white/10 px-3 py-2 text-[13px] text-white/90 placeholder:text-white/35 resize-none focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]/50 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void applySmartEdit()}
              disabled={busy || applying}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[color:var(--color-accent)] hover:opacity-90 text-sm font-medium disabled:opacity-40"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {applying ? '处理中…' : '应用智能修改'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default FabricEditor;
