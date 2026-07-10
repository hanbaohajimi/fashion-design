import React, {
  forwardRef,
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
} from 'react';
import {
  Canvas,
  FabricImage,
  IText,
  Rect,
  Circle,
  Point,
  type FabricObject,
} from 'fabric';
import {
  MousePointer2,
  Hand,
  Type,
  Square,
  Circle as CircleIcon,
  ImagePlus,
  Trash2,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Maximize,
  Sparkles,
  PencilRuler,
  Upload,
  Download,
  ImageIcon,
} from 'lucide-react';
import { useToast } from '../../../components/Toast';

export interface DesignCanvasHandle {
  addImage: (url: string, name?: string) => Promise<void>;
}

interface DesignCanvasProps {
  currentModeLabel?: string;
  onDescribeDesign?: () => void;
  onEditInEditor?: (dataUrl: string) => void;
  onSendToAI?: (dataUrl: string) => void;
  /** 画布选中图片时回调；选中非图片或取消选中时传 null */
  onSelectionChange?: (imageUrl: string | null) => void;
}

let nextElementId = 1;
let nextImageNumber = 1;

interface SelectedObjectInfo {
  isImage: boolean;
  name: string;
  imageNumber: number;
  naturalWidth: number;
  naturalHeight: number;
  elementType: string;
}

const ACCENT_INK = '#1A1815';

interface CanvasToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
}

/** 画布主工具栏按钮：统一鼠标与键盘可见的轻量提示。 */
function CanvasToolbarButton({
  label,
  shortcut,
  className = 'canvas-tb-btn',
  children,
  ...buttonProps
}: CanvasToolbarButtonProps) {
  const tooltip = shortcut ? `${label} · ${shortcut}` : label;

  return (
    <span className="canvas-tb-tooltip" data-tooltip={tooltip}>
      <button
        type="button"
        className={className}
        aria-label={label}
        {...buttonProps}
      >
        {children}
      </button>
    </span>
  );
}

function applySelectionStyle(obj: FabricObject) {
  obj.set({ selectable: true, evented: true });
  obj.lockRotation = true;
  obj.setControlVisible('mtr', false);
  obj.set({
    cornerColor: '#FBFAF6',
    cornerStrokeColor: ACCENT_INK,
    borderColor: ACCENT_INK,
    cornerSize: 8,
    transparentCorners: false,
    cornerStyle: 'rect' as const,
    borderScaleFactor: 1.4,
  });
}

function applyHighQualityRendering(canvas: Canvas) {
  const contexts = [canvas.getContext(), canvas.contextTop];
  for (const context of contexts) {
    if (!context) continue;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
  }
}

/**
 * 直接解码原始图片元素后再交给 Fabric，避免先经过 DOM 预览尺寸或缩略图画布。
 * decode() 完成后 naturalWidth / naturalHeight 即为稳定的原始像素尺寸。
 */
async function loadOriginalImageElement(url: string): Promise<HTMLImageElement> {
  const element = new Image();
  element.decoding = 'async';
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    element.crossOrigin = 'anonymous';
  }
  element.src = url;

  try {
    await element.decode();
  } catch {
    await new Promise<void>((resolve, reject) => {
      if (element.complete) {
        if (element.naturalWidth > 0) resolve();
        else reject(new Error('图片解码失败'));
        return;
      }
      element.onload = () => resolve();
      element.onerror = () => reject(new Error('图片解码失败'));
    });
  }

  if (!element.naturalWidth || !element.naturalHeight) {
    throw new Error('无法读取图片原始尺寸');
  }
  return element;
}

function getObjectExportMultiplier(object: FabricObject): number {
  const meta = object as FabricObject & { _naturalWidth?: number; _naturalHeight?: number };
  const displayWidth = Math.max(1, object.getScaledWidth());
  const displayHeight = Math.max(1, object.getScaledHeight());
  const sourceRatio = Math.max(
    (meta._naturalWidth || displayWidth) / displayWidth,
    (meta._naturalHeight || displayHeight) / displayHeight,
  );
  return Math.min(8, Math.max(window.devicePixelRatio || 1, sourceRatio, 1));
}

const DesignCanvas = forwardRef<DesignCanvasHandle, DesignCanvasProps>(
  ({ currentModeLabel = '生成成衣效果图', onDescribeDesign, onEditInEditor, onSendToAI, onSelectionChange }, ref) => {
    const { toast } = useToast();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<Canvas | null>(null);

    const [activeTool, setActiveTool] = useState<'select' | 'hand'>('select');
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isDragOver, setIsDragOver] = useState(false);
    const [elementCount, setElementCount] = useState(0);
    const [selectedInfo, setSelectedInfo] = useState<SelectedObjectInfo | null>(null);

    const activeToolRef = useRef(activeTool);
    activeToolRef.current = activeTool;
    const spaceHeldRef = useRef(false);
    const isPanningRef = useRef(false);
    const lastPanPosRef = useRef({ x: 0, y: 0 });
    const addOffsetRef = useRef(0);
    const dragCounterRef = useRef(0);

    const updateElementCount = useCallback(() => {
      setElementCount(fabricRef.current ? fabricRef.current.getObjects().length : 0);
    }, []);

    const updateToolbar = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) {
        setSelectedInfo(null);
        onSelectionChange?.(null);
        return;
      }
      const active = canvas.getActiveObject();
      if (!active || (active as FabricObject & { _elementId?: string })._elementId === undefined) {
        setSelectedInfo(null);
        onSelectionChange?.(null);
        return;
      }
      const ext = active as FabricObject & {
        _elementType?: string;
        _elementName?: string;
        _imageNumber?: number;
        _naturalWidth?: number;
        _naturalHeight?: number;
        _sourceUrl?: string;
      };
      setSelectedInfo({
        isImage: ext._elementType === 'image',
        name: ext._elementName || '元素',
        imageNumber: ext._imageNumber || 0,
        naturalWidth: ext._naturalWidth || Math.round(active.width || 0),
        naturalHeight: ext._naturalHeight || Math.round(active.height || 0),
        elementType: ext._elementType || 'shape',
      });
      // 如果选中的是图片，向上通知其 URL（用于 ChatPanel 素材联动）
      if (ext._elementType === 'image') {
        const src = ext._sourceUrl ||
          (active as FabricObject & { toDataURL?: (o: object) => string }).toDataURL?.({ format: 'png', quality: 1, multiplier: 1 }) ||
          null;
        onSelectionChange?.(src);
      } else {
        onSelectionChange?.(null);
      }
    }, [onSelectionChange]);

    const updateGrid = useCallback(() => {
      if (!gridRef.current || !fabricRef.current) return;
      const canvas = fabricRef.current;
      const zoom = canvas.getZoom();
      const vpt = canvas.viewportTransform!;
      const spacing = 24 * zoom;
      if (spacing < 6) {
        gridRef.current.style.backgroundImage = 'none';
        return;
      }
      const dot = Math.max(0.8, Math.min(1.2, zoom));
      gridRef.current.style.backgroundImage = `radial-gradient(circle, rgba(26, 24, 21, 0.055) ${dot}px, transparent ${dot}px)`;
      gridRef.current.style.backgroundSize = `${spacing}px ${spacing}px`;
      gridRef.current.style.backgroundPosition = `${vpt[4] % spacing}px ${vpt[5] % spacing}px`;
    }, []);

    useEffect(() => {
      const el = canvasElRef.current;
      const container = containerRef.current;
      if (!el || !container) return;

      const rect = container.getBoundingClientRect();
      const canvas = new Canvas(el, {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        backgroundColor: 'transparent',
        selection: true,
        preserveObjectStacking: true,
        enableRetinaScaling: true,
        imageSmoothingEnabled: true,
      });
      fabricRef.current = canvas;
      applyHighQualityRendering(canvas);

      canvas.selectionColor = 'rgba(26, 24, 21, 0.04)';
      canvas.selectionBorderColor = ACCENT_INK;
      canvas.selectionLineWidth = 1;

      let resizeRaf: number | null = null;
      let layoutRaf1: number | null = null;
      let layoutRaf2: number | null = null;

      const syncCanvasSizeFromContainer = () => {
        if (!containerRef.current || !fabricRef.current) return;
        const r = containerRef.current.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        const c = fabricRef.current;
        const cw = Math.round(c.getWidth());
        const ch = Math.round(c.getHeight());
        if (cw === w && ch === h) {
          updateGrid();
          return;
        }
        c.setDimensions({ width: w, height: h });
        applyHighQualityRendering(c);
        c.requestRenderAll();
        updateGrid();
      };

      const scheduleSyncFromObserver = () => {
        if (resizeRaf != null) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          syncCanvasSizeFromContainer();
        });
      };

      const ro = new ResizeObserver(() => {
        scheduleSyncFromObserver();
      });
      ro.observe(container);

      layoutRaf1 = requestAnimationFrame(() => {
        layoutRaf1 = null;
        layoutRaf2 = requestAnimationFrame(() => {
          layoutRaf2 = null;
          syncCanvasSizeFromContainer();
        });
      });

      canvas.on('mouse:wheel', (opt) => {
        const e = opt.e as unknown as WheelEvent;
        e.preventDefault();
        e.stopPropagation();
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** e.deltaY;
        zoom = Math.max(0.05, Math.min(8, zoom));
        canvas.zoomToPoint(canvas.getViewportPoint(e), zoom);
        setZoomLevel(zoom);
        updateGrid();
        updateToolbar();
      });

      canvas.on('mouse:down', (opt) => {
        const e = opt.e as unknown as MouseEvent;
        if (e.button === 1 || spaceHeldRef.current || activeToolRef.current === 'hand') {
          isPanningRef.current = true;
          lastPanPosRef.current = { x: e.clientX, y: e.clientY };
          canvas.selection = false;
          canvas.defaultCursor = 'grabbing';
          canvas.upperCanvasEl.style.cursor = 'grabbing';
        }
      });
      canvas.on('mouse:move', (opt) => {
        if (!isPanningRef.current) return;
        const e = opt.e as unknown as MouseEvent;
        canvas.relativePan(
          new Point(e.clientX - lastPanPosRef.current.x, e.clientY - lastPanPosRef.current.y),
        );
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        updateGrid();
        updateToolbar();
      });
      canvas.on('mouse:up', () => {
        if (isPanningRef.current) {
          isPanningRef.current = false;
          canvas.defaultCursor = activeToolRef.current === 'hand' ? 'grab' : 'default';
          canvas.upperCanvasEl.style.cursor = canvas.defaultCursor;
          canvas.selection = activeToolRef.current === 'select';
        }
      });

      canvas.on('selection:created', updateToolbar);
      canvas.on('selection:updated', updateToolbar);
      canvas.on('selection:cleared', updateToolbar);
      canvas.on('object:moving', updateToolbar);
      canvas.on('object:scaling', updateToolbar);
      canvas.on('object:added', updateElementCount);
      canvas.on('object:removed', updateElementCount);

      updateGrid();
      return () => {
        if (resizeRaf != null) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = null;
        }
        if (layoutRaf1 != null) {
          cancelAnimationFrame(layoutRaf1);
          layoutRaf1 = null;
        }
        if (layoutRaf2 != null) {
          cancelAnimationFrame(layoutRaf2);
          layoutRaf2 = null;
        }
        ro.disconnect();
        canvas.dispose();
        fabricRef.current = null;
      };
    }, [updateGrid, updateToolbar, updateElementCount]);

    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      if (activeTool === 'hand') {
        canvas.selection = false;
        canvas.defaultCursor = 'grab';
        canvas.upperCanvasEl.style.cursor = 'grab';
        canvas.forEachObject((o) => o.set({ evented: false, selectable: false }));
      } else {
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.upperCanvasEl.style.cursor = 'default';
        canvas.forEachObject((o) => o.set({ evented: true, selectable: true }));
      }
      canvas.requestRenderAll();
    }, [activeTool]);

    useEffect(() => {
      const down = (e: KeyboardEvent) => {
        const t = (e.target as HTMLElement).tagName;
        if (t === 'INPUT' || t === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        if (e.code === 'Space' && !spaceHeldRef.current) {
          e.preventDefault();
          spaceHeldRef.current = true;
          const c = fabricRef.current;
          if (c) {
            c.defaultCursor = 'grab';
            c.upperCanvasEl.style.cursor = 'grab';
            c.selection = false;
          }
        }
        if (e.key === 'v' && !e.ctrlKey && !e.metaKey) setActiveTool('select');
        if (e.key === 'h' && !e.ctrlKey && !e.metaKey) setActiveTool('hand');
        if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey) deleteSelected();
      };
      const up = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          spaceHeldRef.current = false;
          const c = fabricRef.current;
          if (c && activeToolRef.current !== 'hand') {
            c.defaultCursor = 'default';
            c.upperCanvasEl.style.cursor = 'default';
            c.selection = true;
          }
        }
      };
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      return () => {
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
      };
    }, []);

    const getViewportCenter = useCallback((): { x: number; y: number } => {
      const c = fabricRef.current;
      if (!c) return { x: 400, y: 300 };
      const vpt = c.viewportTransform!;
      const z = c.getZoom();
      return { x: (c.getWidth() / 2 - vpt[4]) / z, y: (c.getHeight() / 2 - vpt[5]) / z };
    }, []);

    const addImageToCanvas = useCallback(
      async (url: string, name?: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        try {
          const sourceElement = await loadOriginalImageElement(url);
          const img = new FabricImage(sourceElement, {
            objectCaching: false,
            noScaleCache: true,
            imageSmoothing: true,
          });
          const center = getViewportCenter();
          const offset = addOffsetRef.current * 30;
          addOffsetRef.current = (addOffsetRef.current + 1) % 10;
          const zoom = canvas.getZoom();
          const imgW = sourceElement.naturalWidth;
          const imgH = sourceElement.naturalHeight;
          // 按可视区域分别约束宽高，避免把高分辨率竖图压缩成很小的缩略图观感。
          const maxWidth = (canvas.getWidth() * 0.72) / zoom;
          const maxHeight = (canvas.getHeight() * 0.72) / zoom;
          const scale = Math.min(maxWidth / imgW, maxHeight / imgH, 1);
          img.set({
            width: imgW,
            height: imgH,
            objectCaching: false,
            // Fabric 默认应在缩放结束后用原始像素重绘；不要复用低分辨率缩放缓存。
            noScaleCache: true,
            imageSmoothing: true,
          });
          img.scale(scale);
          const eId = `el-${nextElementId++}`;
          const imgNum = nextImageNumber++;
          img.set({
            left: center.x + offset - (imgW * scale) / 2,
            top: center.y + offset - (imgH * scale) / 2,
          });
          const ext = img as FabricObject & {
            _elementId?: string;
            _elementName?: string;
            _elementType?: string;
            _sourceUrl?: string;
            _imageNumber?: number;
            _naturalWidth?: number;
            _naturalHeight?: number;
          };
          ext._elementId = eId;
          ext._elementName = name || `Image ${imgNum}`;
          ext._elementType = 'image';
          ext._sourceUrl = url;
          ext._imageNumber = imgNum;
          ext._naturalWidth = imgW;
          ext._naturalHeight = imgH;
          applySelectionStyle(img);
          canvas.add(img);
          canvas.setActiveObject(img);
          img.setCoords();
          img.dirty = true;
          applyHighQualityRendering(canvas);
          canvas.requestRenderAll();
          toast(`已添加: ${ext._elementName}`, 'success');
        } catch (err) {
          console.error(err);
          toast('添加图片失败', 'error');
        }
      },
      [getViewportCenter, toast],
    );

    const addTextElement = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const center = getViewportCenter();
      const eId = `el-${nextElementId++}`;
      const text = new IText('双击编辑文字', {
        left: center.x,
        top: center.y,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 28,
        fill: '#1a1a2e',
        originX: 'center',
        originY: 'center',
      });
      const t = text as FabricObject & { _elementId?: string; _elementName?: string; _elementType?: string };
      t._elementId = eId;
      t._elementName = `文字 ${nextElementId - 1}`;
      t._elementType = 'text';
      applySelectionStyle(text);
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.requestRenderAll();
    }, [getViewportCenter]);

    const addRectElement = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const center = getViewportCenter();
      const eId = `el-${nextElementId++}`;
      const r = new Rect({
        left: center.x,
        top: center.y,
        width: 160,
        height: 100,
        fill: 'transparent',
        stroke: '#71717a',
        strokeWidth: 2,
        rx: 8,
        ry: 8,
        originX: 'center',
        originY: 'center',
      });
      const o = r as FabricObject & { _elementId?: string; _elementName?: string; _elementType?: string };
      o._elementId = eId;
      o._elementName = `矩形 ${nextElementId - 1}`;
      o._elementType = 'shape';
      applySelectionStyle(r);
      canvas.add(r);
      canvas.setActiveObject(r);
      canvas.requestRenderAll();
    }, [getViewportCenter]);

    const addCircleElement = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const center = getViewportCenter();
      const eId = `el-${nextElementId++}`;
      const c = new Circle({
        left: center.x,
        top: center.y,
        radius: 60,
        fill: 'transparent',
        stroke: '#71717a',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
      });
      const o = c as FabricObject & { _elementId?: string; _elementName?: string; _elementType?: string };
      o._elementId = eId;
      o._elementName = `圆形 ${nextElementId - 1}`;
      o._elementType = 'shape';
      applySelectionStyle(c);
      canvas.add(c);
      canvas.setActiveObject(c);
      canvas.requestRenderAll();
    }, [getViewportCenter]);

    const insertImageFromFile = useCallback(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) {
          const objectUrl = URL.createObjectURL(f);
          void addImageToCanvas(objectUrl, f.name.replace(/\.[^/.]+$/, ''))
            .finally(() => URL.revokeObjectURL(objectUrl));
        }
      };
      input.click();
    }, [addImageToCanvas]);

    const deleteSelected = useCallback(() => {
      const c = fabricRef.current;
      if (!c) return;
      c.getActiveObjects().forEach((o) => c.remove(o));
      c.discardActiveObject();
      c.requestRenderAll();
    }, []);

    const flipSelected = useCallback(
      (axis: 'x' | 'y') => {
        const c = fabricRef.current;
        if (!c) return;
        const a = c.getActiveObject();
        if (!a) return;
        a.set(axis === 'x' ? 'flipX' : 'flipY', axis === 'x' ? !a.flipX : !a.flipY);
        c.requestRenderAll();
        updateToolbar();
      },
      [updateToolbar],
    );

    const handleExportSelected = useCallback(
      (action: 'edit' | 'ai') => {
        const c = fabricRef.current;
        if (!c) return;
        const a = c.getActiveObject();
        if (!a) return;
        const src = (a as FabricObject & { _sourceUrl?: string })._sourceUrl;
        const url =
          src && !src.startsWith('blob:')
            ? src
            : a.toDataURL({ format: 'png', quality: 1, multiplier: getObjectExportMultiplier(a) });
        if (action === 'edit') onEditInEditor?.(url);
        if (action === 'ai') onSendToAI?.(url);
      },
      [onEditInEditor, onSendToAI],
    );

    const downloadSelected = useCallback(() => {
      const c = fabricRef.current;
      if (!c) return;
      const a = c.getActiveObject();
      if (!a) return;
      const src = (a as FabricObject & { _sourceUrl?: string })._sourceUrl;
      const url =
        src && !src.startsWith('blob:')
          ? src
          : a.toDataURL({ format: 'png', quality: 1, multiplier: getObjectExportMultiplier(a) });
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedInfo?.name || 'design'}-${Date.now()}.png`;
      link.click();
      toast('开始下载', 'success');
    }, [selectedInfo, toast]);

    const zoomIn = useCallback(() => {
      const c = fabricRef.current;
      if (!c) return;
      const z = Math.min(8, c.getZoom() * 1.25);
      c.zoomToPoint(new Point(c.getWidth() / 2, c.getHeight() / 2), z);
      setZoomLevel(z);
      updateGrid();
      updateToolbar();
    }, [updateGrid, updateToolbar]);

    const zoomOut = useCallback(() => {
      const c = fabricRef.current;
      if (!c) return;
      const z = Math.max(0.05, c.getZoom() / 1.25);
      c.zoomToPoint(new Point(c.getWidth() / 2, c.getHeight() / 2), z);
      setZoomLevel(z);
      updateGrid();
      updateToolbar();
    }, [updateGrid, updateToolbar]);

    const zoomToFit = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const objs = canvas.getObjects();
      if (!objs.length) {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        setZoomLevel(1);
        updateGrid();
        return;
      }
      let mnX = Infinity,
        mnY = Infinity,
        mxX = -Infinity,
        mxY = -Infinity;
      objs.forEach((o) => {
        const b = o.getBoundingRect();
        const vpt = canvas.viewportTransform!;
        const z = canvas.getZoom();
        const l = (b.left - vpt[4]) / z;
        const t = (b.top - vpt[5]) / z;
        mnX = Math.min(mnX, l);
        mnY = Math.min(mnY, t);
        mxX = Math.max(mxX, l + b.width / z);
        mxY = Math.max(mxY, t + b.height / z);
      });
      const pad = 80;
      const z = Math.min(
        canvas.getWidth() / (mxX - mnX + pad * 2),
        canvas.getHeight() / (mxY - mnY + pad * 2),
        3,
      );
      canvas.setViewportTransform([
        z,
        0,
        0,
        z,
        canvas.getWidth() / 2 - ((mnX + mxX) / 2) * z,
        canvas.getHeight() / 2 - ((mnY + mxY) / 2) * z,
      ]);
      setZoomLevel(z);
      updateGrid();
      updateToolbar();
    }, [updateGrid, updateToolbar]);

    useImperativeHandle(ref, () => ({ addImage: addImageToCanvas }), [addImageToCanvas]);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
    }, []);
    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) setIsDragOver(false);
    }, []);
    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []);
    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        dragCounterRef.current = 0;
        Array.from(e.dataTransfer.files).forEach((f) => {
          if (f.type.startsWith('image/')) {
            const objectUrl = URL.createObjectURL(f);
            void addImageToCanvas(objectUrl, f.name.replace(/\.[^/.]+$/, ''))
              .finally(() => URL.revokeObjectURL(objectUrl));
          }
        });
      },
      [addImageToCanvas],
    );

    const isEmpty = elementCount === 0;

    const ctxBtnClass =
      'editorial-canvas-btn whitespace-nowrap';

    return (
      <div className="flex-1 flex flex-col min-w-0 relative" style={{ background: 'var(--color-canvas)' }}>
        <div className="canvas-mode-label" aria-label={`当前设计状态：${currentModeLabel}`}>
          <strong>{currentModeLabel}</strong>
        </div>
        {/* ── Main toolbar (杂志黑底象牙字) ── */}
        <div className={`canvas-main-toolbar ${isEmpty ? 'is-empty' : ''}`}>
          <div className="flex items-center">
            <CanvasToolbarButton
              label="选择"
              shortcut="V"
              onClick={() => setActiveTool('select')}
              className={`canvas-tb-btn ${activeTool === 'select' ? 'is-active' : ''}`}
            >
              <MousePointer2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
            <CanvasToolbarButton
              label="平移"
              shortcut="H"
              onClick={() => setActiveTool('hand')}
              className={`canvas-tb-btn ${activeTool === 'hand' ? 'is-active' : ''}`}
            >
              <Hand className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
          </div>
          <span className="canvas-tb-sep" />
          <div className="flex items-center">
            <CanvasToolbarButton label="文字" onClick={addTextElement}>
              <Type className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
            <CanvasToolbarButton label="矩形" onClick={addRectElement}>
              <Square className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
            <CanvasToolbarButton label="圆形" onClick={addCircleElement}>
              <CircleIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
            <CanvasToolbarButton
              label="添加图片"
              onClick={insertImageFromFile}
              className={`canvas-tb-btn ${isEmpty ? 'is-emphasized' : ''}`}
            >
              <ImagePlus className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
          </div>
          <span className="canvas-tb-sep" />
          <div className="flex items-center">
            <CanvasToolbarButton label="缩小" onClick={zoomOut}>
              <ZoomOut className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
            <button
              type="button"
              onClick={() => {
                const c = fabricRef.current;
                if (c) {
                  c.zoomToPoint(new Point(c.getWidth() / 2, c.getHeight() / 2), 1);
                  setZoomLevel(1);
                  updateGrid();
                  updateToolbar();
                }
              }}
              className="canvas-tb-zoom"
              title="重置缩放"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <CanvasToolbarButton label="放大" onClick={zoomIn}>
              <ZoomIn className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
            <CanvasToolbarButton label="适应画布" onClick={zoomToFit}>
              <Maximize className="w-3.5 h-3.5" strokeWidth={1.5} />
            </CanvasToolbarButton>
          </div>
        </div>

        {/* ── Context toolbar + Info bar (when object selected) ── */}
        {selectedInfo && (
          <div className="absolute top-[60px] left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 canvas-toolbar-enter">
            <div className="canvas-context-toolbar">
              {selectedInfo.isImage && onEditInEditor && (
                <>
                  <button
                    type="button"
                    onClick={() => handleExportSelected('edit')}
                    className="editorial-canvas-btn primary"
                  >
                    <PencilRuler className="w-3.5 h-3.5" strokeWidth={1.5} />
                    快捷编辑
                    <kbd className="canvas-kbd">Tab</kbd>
                  </button>
                  <span className="canvas-tb-divider" />
                </>
              )}
              <button type="button" onClick={() => flipSelected('x')} className={ctxBtnClass} title="水平翻转">
                <FlipHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">水平翻转</span>
              </button>
              <button type="button" onClick={() => flipSelected('y')} className={ctxBtnClass} title="垂直翻转">
                <FlipVertical className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">垂直翻转</span>
              </button>
              {selectedInfo.isImage && onSendToAI && (
                <>
                  <span className="canvas-tb-divider" />
                  <button type="button" onClick={() => handleExportSelected('ai')} className={ctxBtnClass} title="发送到 AI">
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="hidden sm:inline">发送 AI</span>
                  </button>
                </>
              )}
              <span className="canvas-tb-divider" />
              <button
                type="button"
                onClick={deleteSelected}
                className="editorial-canvas-btn danger whitespace-nowrap"
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button type="button" onClick={downloadSelected} className={ctxBtnClass} title="下载">
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>

            {/* Info bar: caption 排版 */}
            <div className="canvas-info-bar">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="kicker" style={{ fontSize: 9, letterSpacing: '0.22em' }}>
                  {selectedInfo.elementType === 'image' ? 'Fig' : 'Object'}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--color-ink)', letterSpacing: '-0.005em' }}>
                  {selectedInfo.name}
                </span>
              </div>
              <span className="numeral" style={{ fontSize: 11, color: 'var(--color-ink-3)', letterSpacing: '0.06em' }}>
                {selectedInfo.naturalWidth} &times; {selectedInfo.naturalHeight}
              </span>
            </div>
          </div>
        )}

        <div
          className="flex-1 relative overflow-hidden"
          ref={containerRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="canvas-paper-texture" aria-hidden />
          <div
            ref={gridRef}
            className="canvas-structure-grid"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(26, 24, 21, 0.055) 0.6px, transparent 0.6px)',
              backgroundSize: '20px 20px',
            }}
          />
          <div className="canvas-ruler canvas-ruler-top" aria-hidden />
          <div className="canvas-ruler canvas-ruler-left" aria-hidden />
          <div className="canvas-center-guide canvas-center-guide-x" aria-hidden />
          <div className="canvas-center-guide canvas-center-guide-y" aria-hidden />
          <div className="canvas-crop-mark canvas-crop-mark-tl" aria-hidden />
          <div className="canvas-crop-mark canvas-crop-mark-tr" aria-hidden />
          <div className="canvas-crop-mark canvas-crop-mark-bl" aria-hidden />
          <div className="canvas-crop-mark canvas-crop-mark-br" aria-hidden />
          <canvas ref={canvasElRef} className="absolute inset-0 z-[2]" />

          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[3]">
              <div className="canvas-empty fade-up-in pointer-events-auto">
                <p className="kicker">Atelier &middot; Canvas</p>
                <h2 className="canvas-empty-quote">让灵感在此处落笔。</h2>
                <p className="canvas-empty-description">描述服装设计，或添加参考图片开始。</p>
                <div className="canvas-empty-actions">
                  <button type="button" className="canvas-empty-action primary" onClick={onDescribeDesign}>
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
                    描述设计想法
                  </button>
                  <button type="button" className="canvas-empty-action" onClick={insertImageFromFile}>
                    <ImagePlus className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
                    上传参考图片
                  </button>
                </div>
              </div>
            </div>
          )}

          {isDragOver && (
            <div className="canvas-dragover">
              <Upload className="w-6 h-6 mb-2" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
              <p className="kicker" style={{ fontSize: 11, letterSpacing: '0.22em' }}>松开添加到画布</p>
            </div>
          )}
        </div>
      </div>
    );
  },
);

DesignCanvas.displayName = 'DesignCanvas';
export default DesignCanvas;
