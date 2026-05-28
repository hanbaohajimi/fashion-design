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
  onEditInEditor?: (dataUrl: string) => void;
  onSendToAI?: (dataUrl: string) => void;
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

const BLUE = '#3b82f6';

function applySelectionStyle(obj: FabricObject) {
  obj.set({ selectable: true, evented: true });
  obj.lockRotation = true;
  obj.setControlVisible('mtr', false);
  obj.set({
    cornerColor: '#ffffff',
    cornerStrokeColor: BLUE,
    borderColor: BLUE,
    cornerSize: 9,
    transparentCorners: false,
    cornerStyle: 'rect' as const,
    borderScaleFactor: 1.6,
  });
}

const DesignCanvas = forwardRef<DesignCanvasHandle, DesignCanvasProps>(
  ({ onEditInEditor, onSendToAI }, ref) => {
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
        return;
      }
      const active = canvas.getActiveObject();
      if (!active || (active as FabricObject & { _elementId?: string })._elementId === undefined) {
        setSelectedInfo(null);
        return;
      }
      const ext = active as FabricObject & {
        _elementType?: string;
        _elementName?: string;
        _imageNumber?: number;
        _naturalWidth?: number;
        _naturalHeight?: number;
      };
      setSelectedInfo({
        isImage: ext._elementType === 'image',
        name: ext._elementName || '元素',
        imageNumber: ext._imageNumber || 0,
        naturalWidth: ext._naturalWidth || Math.round(active.width || 0),
        naturalHeight: ext._naturalHeight || Math.round(active.height || 0),
        elementType: ext._elementType || 'shape',
      });
    }, []);

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
      gridRef.current.style.backgroundImage = `radial-gradient(circle, #d4cfc8 ${dot}px, transparent ${dot}px)`;
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
        backgroundColor: '#fdfcfa',
        selection: true,
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      canvas.selectionColor = 'rgba(59, 130, 246, 0.05)';
      canvas.selectionBorderColor = BLUE;
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
          const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
          const center = getViewportCenter();
          const offset = addOffsetRef.current * 30;
          addOffsetRef.current = (addOffsetRef.current + 1) % 10;
          const zoom = canvas.getZoom();
          const maxSize = (Math.min(canvas.getWidth(), canvas.getHeight()) * 0.4) / zoom;
          const imgW = img.width || 300;
          const imgH = img.height || 300;
          const scale = Math.min(maxSize / imgW, maxSize / imgH, 1);
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
        if (f) addImageToCanvas(URL.createObjectURL(f), f.name.replace(/\.[^/.]+$/, ''));
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
            : a.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
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
          : a.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
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
          if (f.type.startsWith('image/'))
            addImageToCanvas(URL.createObjectURL(f), f.name.replace(/\.[^/.]+$/, ''));
        });
      },
      [addImageToCanvas],
    );

    const isEmpty = elementCount === 0;

    const ctxBtnClass =
      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-100/80 transition-colors whitespace-nowrap';

    return (
      <div className="flex-1 flex flex-col min-w-0 relative bg-[#fdfcfa]">
        {/* ── Main toolbar ── */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 p-0.5 bg-white/90 backdrop-blur-lg rounded-xl border border-gray-200/50 shadow-sm transition-all">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setActiveTool('select')}
              className={`p-2 rounded-lg transition-colors ${activeTool === 'select' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
              title="选择 (V)"
            >
              <MousePointer2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('hand')}
              className={`p-2 rounded-lg transition-colors ${activeTool === 'hand' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
              title="平移 (H)"
            >
              <Hand className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="w-px h-4 bg-gray-200/60 mx-0.5" />
          <div className="flex items-center">
            <button
              type="button"
              onClick={addTextElement}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="文字"
            >
              <Type className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={addRectElement}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="矩形"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={addCircleElement}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="圆形"
            >
              <CircleIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={insertImageFromFile}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="上传图片"
            >
              <ImagePlus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="w-px h-4 bg-gray-200/60 mx-0.5" />
          <div className="flex items-center">
            <button
              type="button"
              onClick={zoomOut}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
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
              className="text-[11px] font-medium text-gray-400 hover:text-gray-700 tabular-nums w-9 text-center rounded py-0.5 hover:bg-gray-50 transition-colors"
              title="重置缩放"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={zoomToFit}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="适应画布"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Context toolbar + Info bar (when object selected) ── */}
        {selectedInfo && (
          <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 canvas-toolbar-enter">
            <div className="flex items-center gap-0.5 px-1.5 py-1 bg-white/95 backdrop-blur-lg rounded-xl border border-gray-200/60 shadow-sm">
              {selectedInfo.isImage && onEditInEditor && (
                <>
                  <button
                    type="button"
                    onClick={() => handleExportSelected('edit')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[12px] font-medium hover:bg-blue-100 transition-colors whitespace-nowrap"
                  >
                    <PencilRuler className="w-3.5 h-3.5" />
                    快捷编辑
                    <kbd className="text-[9px] px-1 py-0.5 bg-white rounded text-blue-400 font-normal ml-0.5">Tab</kbd>
                  </button>
                  <div className="w-px h-5 bg-gray-200/60 mx-0.5" />
                </>
              )}
              <button type="button" onClick={() => flipSelected('x')} className={ctxBtnClass} title="水平翻转">
                <FlipHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">水平翻转</span>
              </button>
              <button type="button" onClick={() => flipSelected('y')} className={ctxBtnClass} title="垂直翻转">
                <FlipVertical className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">垂直翻转</span>
              </button>
              {selectedInfo.isImage && onSendToAI && (
                <>
                  <div className="w-px h-5 bg-gray-200/60 mx-0.5" />
                  <button type="button" onClick={() => handleExportSelected('ai')} className={ctxBtnClass} title="发送到 AI">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">发送 AI</span>
                  </button>
                </>
              )}
              <div className="w-px h-5 bg-gray-200/60 mx-0.5" />
              <button
                type="button"
                onClick={deleteSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors whitespace-nowrap"
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={downloadSelected} className={ctxBtnClass} title="下载">
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Info bar: label + dimensions */}
            <div className="flex items-center justify-between gap-8 min-w-[280px] px-3 py-1 bg-white/80 backdrop-blur-sm rounded-lg border border-gray-200/40 shadow-xs">
              <div className="flex items-center gap-1.5 text-[12px] text-gray-500">
                <ImageIcon className="w-3.5 h-3.5 text-gray-400" />
                <span className="font-medium">{selectedInfo.name}</span>
              </div>
              <span className="text-[12px] text-gray-400 tabular-nums font-medium tracking-wide">
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
          <div
            ref={gridRef}
            className="absolute inset-0 pointer-events-none z-[1]"
            style={{
              backgroundImage: 'radial-gradient(circle, #d4cfc8 0.6px, transparent 0.6px)',
              backgroundSize: '20px 20px',
            }}
          />
          <canvas ref={canvasElRef} className="absolute inset-0 z-[2]" />

          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[3]">
              <div className="text-center px-8 fade-up-in max-w-[320px]">
                <p className="text-[15px] font-semibold text-gray-300 mb-2 tracking-tight">设计画布</p>
                <p className="text-[12px] text-gray-300 leading-relaxed text-balance mb-3">
                  <span className="text-gray-400">路径 A：</span>
                  在右侧对话描述需求，生成后点击「置入画布」编排
                </p>
                <p className="text-[12px] text-gray-300 leading-relaxed text-balance">
                  <span className="text-gray-400">路径 B：</span>
                  拖入图片到此处，或点击工具栏「上传图片」开始
                </p>
                <div className="flex justify-center gap-4 mt-6 flex-wrap">
                  {[
                    { label: 'Space', desc: '平移' },
                    { label: 'V', desc: '选择' },
                    { label: 'H', desc: '抓手' },
                  ].map((k) => (
                    <span key={k.label} className="text-[10px] text-gray-300">
                      <kbd className="px-1 py-0.5 bg-white/60 rounded text-[9px] font-medium text-gray-400">
                        {k.label}
                      </kbd>
                      <span className="ml-1">{k.desc}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isDragOver && (
            <div className="absolute inset-4 z-[10] bg-white/90 backdrop-blur flex items-center justify-center border border-dashed border-gray-300 rounded-2xl">
              <div className="text-center">
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 font-medium">松开添加到画布</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);

DesignCanvas.displayName = 'DesignCanvas';
export default DesignCanvas;
