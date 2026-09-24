import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { toast } from 'sonner';
import {
  Download,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Redo2,
  RotateCw,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Sticker,
  Trash2,
  Type,
  Undo2,
  Wand2,
  X
} from 'lucide-react';
import { RangeRow, ResetChip, Section, ToolButton, chipClass } from '@pmp/image-kit';
import {
  clamp,
  downloadBlob,
  formatBytes,
  loadImageFromFile,
  orientedSize,
  STICKER_EMOJI,
  STICKER_ICONS,
  supportsWebp,
  type FontKind,
  type RotateAngle
} from '@pmp/image-kit';
import {
  applySkin,
  bakeTransform,
  BEAUTY_PRESETS,
  createSampleImage,
  cssFilterOf,
  DEFAULT_PARAMS,
  DEFAULT_TRANSFORM,
  drawDecos,
  exportImage,
  FILTER_PRESETS,
  filterParamsOf,
  hasSkinOps,
  mimeOf,
  SKIN_KEYS,
  tempTint,
  toCanvas,
  type BeautyParams,
  type Deco,
  type ExportFormat,
  type Preset,
  type Transform
} from './lib/beauty-studio';
import { cn } from '@pmp/ui';

/** 预览用的降采样长边，兼顾清晰度与实时性 */
const PREVIEW_MAX = 1400;

const DECO_COLORS = [
  '#ef4444',
  '#f97316',
  '#fbbf24',
  '#22c55e',
  '#38bdf8',
  '#8b5cf6',
  '#ec4899',
  '#111827',
  '#ffffff'
];

const TEXT_BG_COLORS: (string | null)[] = [null, '#111827', '#8b5cf6', '#ef4444', '#f59e0b', '#ffffff'];

const FONTS: { id: FontKind; label: string }[] = [
  { id: 'sans', label: '黑体' },
  { id: 'serif', label: '宋体' },
  { id: 'mono', label: '等宽' }
];

const STICKER_GLYPH: Record<string, string> = {
  star: '★',
  heart: '♥',
  circle: '●',
  badge: '💬',
  check: '✓',
  cross: '✕',
  crown: '♛',
  flame: '🔥',
  bolt: '⚡',
  arrow: '➜',
  music: '♪',
  sun: '☀'
};

const SIZE_PRESETS: { id: string; label: string; longEdge: number | null }[] = [
  { id: 'origin', label: '原尺寸', longEdge: null },
  { id: '2048', label: '2048', longEdge: 2048 },
  { id: '1600', label: '1600', longEdge: 1600 },
  { id: '1080', label: '1080 朋友圈', longEdge: 1080 },
  { id: '640', label: '640 头像', longEdge: 640 }
];

type TabId = 'beauty' | 'filter' | 'adjust' | 'deco';

const TABS: { id: TabId; label: string; icon: typeof Sparkles }[] = [
  { id: 'beauty', label: '美颜', icon: Sparkles },
  { id: 'filter', label: '滤镜', icon: Wand2 },
  { id: 'adjust', label: '调节', icon: SlidersHorizontal },
  { id: 'deco', label: '装饰', icon: Sticker }
];

interface Snapshot {
  params: BeautyParams;
  filterId: string;
  strength: number;
  decos: Deco[];
  transform: Transform;
}

const sameSnap = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

/** 装饰元素的 DOM 包围盒（CSS 像素） */
function decoBox(d: Deco, viewW: number) {
  if (d.type === 'sticker') {
    const box = Math.max(8, d.size * viewW);
    return { bw: box, bh: box };
  }
  const fs = Math.max(8, d.size * viewW);
  const lines = d.text.split('\n');
  const maxLen = Math.max(1, ...lines.map((l) => l.length));
  return {
    bw: Math.max(fs, maxLen * fs * 1.06 + fs * 0.9),
    bh: lines.length * fs * 1.28 + fs * 0.9
  };
}

/** 单个装饰元素：与导出一致地用 canvas 绘制，所见即所得 */
function DecoView({
  deco,
  view,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  deco: Deco;
  view: { w: number; h: number };
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, d: Deco) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const { bw, bh } = decoBox(deco, view.w);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || view.w <= 0 || view.h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(bw * dpr));
    canvas.height = Math.max(1, Math.round(bh * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    const centered = { ...deco, x: bw / 2 / view.w, y: bh / 2 / view.h } as Deco;
    drawDecos(ctx, [centered], view.w, view.h);
  }, [deco, view.w, view.h, bw, bh]);

  return (
    <div
      className={cn(
        'absolute cursor-move select-none',
        selected && 'rounded-md outline-2 outline-offset-4 outline-dashed outline-violet-400/80'
      )}
      style={{
        left: deco.x * view.w - bw / 2,
        top: deco.y * view.h - bh / 2,
        width: bw,
        height: bh,
        transform: `rotate(${deco.rotation}deg)`,
        touchAction: 'none'
      }}
      onPointerDown={(e) => onPointerDown(e, deco)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      <canvas ref={ref} style={{ width: bw, height: bh }} className="block" />
    </div>
  );
}

export default function BeautyStudioPage() {
  const [image, setImage] = useState<{
    name: string;
    full: HTMLCanvasElement;
    preview: HTMLCanvasElement;
  } | null>(null);
  const [params, setParams] = useState<BeautyParams>(DEFAULT_PARAMS);
  const [filterId, setFilterId] = useState('none');
  const [strength, setStrength] = useState(80);
  const [activePreset, setActivePreset] = useState('none');
  const [decos, setDecos] = useState<Deco[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM);
  const [tab, setTab] = useState<TabId>('beauty');
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 导出设置
  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [sizeId, setSizeId] = useState('origin');
  const [webpOk] = useState(() => supportsWebp());

  const [, bump] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoSeq = useRef(1);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastSnap = useRef<Snapshot | null>(null);
  const skipHistory = useRef(false);

  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [skinned, setSkinned] = useState<HTMLCanvasElement | null>(null);

  /* ---------- 导入 ---------- */

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    try {
      const img = await loadImageFromFile(file);
      const full = toCanvas(img);
      const preview = toCanvas(img, PREVIEW_MAX);
      setImage({ name: file.name, full, preview });
      setParams(DEFAULT_PARAMS);
      setFilterId('none');
      setStrength(80);
      setActivePreset('none');
      setDecos([]);
      setSelected(null);
      setTransform(DEFAULT_TRANSFORM);
      setTab('beauty');
      past.current = [];
      future.current = [];
      lastSnap.current = null;
      toast.success(`已载入 ${file.name}`);
    } catch {
      toast.error('图片解析失败，换一张试试');
    }
  }, []);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = '';
  };

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const loadSample = () => {
    const sample = createSampleImage();
    const full = toCanvas(sample);
    const preview = toCanvas(sample, PREVIEW_MAX);
    setImage({ name: '示例图.png', full, preview });
    setParams(DEFAULT_PARAMS);
    setFilterId('none');
    setActivePreset('none');
    setDecos([]);
    setSelected(null);
    setTransform(DEFAULT_TRANSFORM);
    past.current = [];
    future.current = [];
    lastSnap.current = null;
    toast.success('已生成示例图，随便调调看');
  };

  /* 粘贴导入 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void loadFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  /* ---------- 尺寸与视图 ---------- */

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStageSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  /* 美颜皮肤层（仅在美颜参数变化时重算，串在下一帧避免拖动卡顿） */
  const skinKey = `${params.smooth}|${params.whiten}|${params.rosy}|${params.sharpen}`;
  useEffect(() => {
    if (!image) {
      setSkinned(null);
      return;
    }
    const skinParams: Partial<BeautyParams> = {
      smooth: params.smooth,
      whiten: params.whiten,
      rosy: params.rosy,
      sharpen: params.sharpen
    };
    const id = requestAnimationFrame(() => {
      setSkinned(hasSkinOps(skinParams) ? applySkin(image.preview, { ...DEFAULT_PARAMS, ...skinParams }) : image.preview);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, skinKey]);

  const baseCanvas = useMemo(
    () => (comparing ? image?.preview ?? null : skinned),
    [comparing, image, skinned]
  );

  const oriented = useMemo(
    () => (baseCanvas ? bakeTransform(baseCanvas, transform) : null),
    [baseCanvas, transform]
  );

  const view = useMemo(() => {
    if (!oriented || stageSize.w === 0 || stageSize.h === 0) return { w: 0, h: 0 };
    const maxW = Math.max(60, stageSize.w - 120);
    const maxH = Math.max(60, stageSize.h - 120);
    const scale = Math.min(maxW / oriented.width, maxH / oriented.height, 1);
    return { w: Math.max(1, oriented.width * scale), h: Math.max(1, oriented.height * scale) };
  }, [oriented, stageSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !oriented || view.w === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(view.w * dpr));
    const ph = Math.max(1, Math.round(view.h * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(oriented, 0, 0, pw, ph);
  }, [oriented, view]);

  /* ---------- 滤镜 / 调色 ---------- */

  const currentFilter = useMemo(
    () => FILTER_PRESETS.find((f) => f.id === filterId) ?? FILTER_PRESETS[0],
    [filterId]
  );
  const filterParams = useMemo(() => filterParamsOf(currentFilter, strength), [currentFilter, strength]);
  const cssFilter = useMemo(
    () => (comparing ? 'none' : `${cssFilterOf(params)} ${cssFilterOf(filterParams)}`.trim()),
    [comparing, params, filterParams]
  );
  const tint = comparing ? null : tempTint(params.temperature);

  /* ---------- 撤销 / 重做 ---------- */

  const snapshotOf = useCallback(
    (): Snapshot => ({ params, filterId, strength, decos, transform }),
    [params, filterId, strength, decos, transform]
  );

  useEffect(() => {
    const snap = snapshotOf();
    if (skipHistory.current) {
      skipHistory.current = false;
      lastSnap.current = snap;
      return;
    }
    if (!lastSnap.current) {
      lastSnap.current = snap;
      return;
    }
    const timer = window.setTimeout(() => {
      const last = lastSnap.current;
      if (last && !sameSnap(last, snap)) {
        past.current.push(last);
        if (past.current.length > 50) past.current.shift();
        future.current = [];
        bump((n) => n + 1);
      }
      lastSnap.current = snap;
    }, 400);
    return () => window.clearTimeout(timer);
  }, [snapshotOf]);

  const applySnapshot = (s: Snapshot) => {
    setParams(s.params);
    setFilterId(s.filterId);
    setStrength(s.strength);
    setDecos(s.decos);
    setTransform(s.transform);
  };

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snapshotOf());
    skipHistory.current = true;
    applySnapshot(prev);
    bump((n) => n + 1);
  }, [snapshotOf]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshotOf());
    skipHistory.current = true;
    applySnapshot(next);
    bump((n) => n + 1);
  }, [snapshotOf]);

  /* ---------- 参数修改 ---------- */

  const patch = (p: Partial<BeautyParams>) => setParams((prev) => ({ ...prev, ...p }));

  const patchSkin = (key: (typeof SKIN_KEYS)[number], value: number) => {
    setActivePreset('custom');
    patch({ [key]: value } as Partial<BeautyParams>);
  };

  const applyBeautyPreset = (preset: Preset) => {
    setActivePreset(preset.id);
    setParams((prev) => {
      const next = { ...prev };
      for (const key of SKIN_KEYS) next[key] = DEFAULT_PARAMS[key];
      return { ...next, ...preset.params };
    });
  };

  const resetAll = () => {
    setParams(DEFAULT_PARAMS);
    setFilterId('none');
    setStrength(80);
    setActivePreset('none');
    setTransform(DEFAULT_TRANSFORM);
    toast.success('已恢复初始状态');
  };

  /* ---------- 装饰层 ---------- */

  const addSticker = (sticker: string) => {
    const id = decoSeq.current++;
    setDecos((list) => [
      ...list,
      {
        id,
        type: 'sticker',
        sticker,
        color: sticker.startsWith('e:') ? '#ffffff' : '#8b5cf6',
        x: 0.5,
        y: 0.5,
        size: 0.2,
        rotation: 0
      }
    ]);
    setSelected(id);
  };

  const addText = () => {
    const id = decoSeq.current++;
    setDecos((list) => [
      ...list,
      {
        id,
        type: 'text',
        text: '双击编辑文字',
        color: '#ffffff',
        bg: null,
        font: 'sans',
        x: 0.5,
        y: 0.74,
        size: 0.06,
        rotation: 0
      }
    ]);
    setSelected(id);
  };

  const selectedDeco = decos.find((d) => d.id === selected) ?? null;

  const patchSelected = (p: Partial<Deco>) => {
    if (!selectedDeco) return;
    setDecos((list) => list.map((d) => (d.id === selectedDeco.id ? ({ ...d, ...p } as Deco) : d)));
  };

  const removeSelected = useCallback(() => {
    setDecos((list) => list.filter((d) => d.id !== selected));
    setSelected(null);
  }, [selected]);

  /* 拖动装饰元素 */
  const dragState = useRef<{ id: number; offX: number; offY: number } | null>(null);

  const onDecoPointerDown = (e: ReactPointerEvent<HTMLDivElement>, d: Deco) => {
    e.stopPropagation();
    setSelected(d.id);
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      id: d.id,
      offX: (e.clientX - rect.left) / rect.width - d.x,
      offY: (e.clientY - rect.top) / rect.height - d.y
    };
  };

  const onDecoPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const nx = (e.clientX - rect.left) / rect.width - state.offX;
    const ny = (e.clientY - rect.top) / rect.height - state.offY;
    setDecos((list) =>
      list.map((d) =>
        d.id === state.id ? { ...d, x: clamp(nx, -0.15, 1.15), y: clamp(ny, -0.15, 1.15) } : d
      )
    );
  };

  const onDecoPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /* 快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, removeSelected, selected]);

  /* ---------- 导出 ---------- */

  const sizePreset = SIZE_PRESETS.find((s) => s.id === sizeId) ?? SIZE_PRESETS[0];
  const fullOriented = image ? orientedSize(image.full.width, image.full.height, transform.rotate) : null;
  const outDims = useMemo(() => {
    if (!fullOriented) return null;
    const scale = sizePreset.longEdge
      ? Math.min(1, sizePreset.longEdge / Math.max(fullOriented.w, fullOriented.h))
      : 1;
    return {
      w: Math.max(1, Math.round(fullOriented.w * scale)),
      h: Math.max(1, Math.round(fullOriented.h * scale))
    };
  }, [fullOriented, sizePreset]);

  const doExport = async () => {
    if (!image || busy) return;
    setBusy(true);
    const tid = toast.loading('正在导出…');
    try {
      const blob = await exportImage({
        source: image.full,
        params,
        filter: filterParams,
        decos,
        transform,
        format,
        quality,
        longEdge: sizePreset.longEdge,
        background: '#ffffff'
      });
      const base = image.name.replace(/\.[^.]+$/, '') || 'beauty';
      downloadBlob(blob, `${base}-美图工坊.${format === 'jpeg' ? 'jpg' : format}`);
      toast.success(`导出成功 · ${formatBytes(blob.size)}`, { id: tid });
      setShowExport(false);
    } catch {
      toast.error('导出失败，请重试', { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  /* ===================== 渲染 ===================== */

  if (!image) {
    return (
      <div className="relative flex-1 min-h-0 overflow-auto bg-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 -top-24 h-80 w-80 rounded-full bg-violet-300/30 blur-3xl" />
          <div className="absolute right-0 top-10 h-72 w-72 rounded-full bg-fuchsia-300/25 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl" />
        </div>

        <div className="relative mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center px-8 py-16">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50/80 px-3 py-1 text-xs font-medium text-violet-600">
            <Sparkles className="h-3.5 w-3.5" />本地处理 · 不上传
          </span>
          <h1 className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-sky-500 bg-clip-text text-center text-4xl font-bold tracking-tight text-transparent">
            美图工坊
          </h1>
          <p className="mt-3 text-center text-sm text-zinc-500">
            一键美颜 · 滤镜调色 · 贴纸文字 · 高清导出，日常修图够用了
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'mt-10 flex w-full max-w-2xl cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-8 py-14 transition-all duration-300',
              dragging
                ? 'border-violet-400 bg-violet-50/70 scale-[1.01]'
                : 'border-violet-200 bg-white/70 hover:border-violet-300 hover:bg-violet-50/40 hover:shadow-xl'
            )}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-200">
              <ImagePlus className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-zinc-800">拖拽图片到这里，或点击上传</p>
            <p className="mt-1 text-xs text-zinc-400">支持 JPG / PNG / WEBP，也可以直接 Ctrl + V 粘贴</p>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-200 transition hover:opacity-90 active:scale-[0.98]"
              >
                <ImagePlus className="h-3.5 w-3.5" />选择图片
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  loadSample();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-4 py-2 text-xs font-semibold text-violet-600 transition hover:bg-violet-50"
              >
                <Sparkles className="h-3.5 w-3.5" />试用示例图
              </button>
            </div>
          </div>

          <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { icon: Sparkles, title: '一键美颜', desc: '磨皮 / 美白 / 红润' },
              { icon: Wand2, title: '12 款滤镜', desc: '清新 / 胶片 / 夜色' },
              { icon: Sticker, title: '贴纸文字', desc: '拖拽缩放旋转' },
              { icon: Download, title: '高清导出', desc: 'PNG / JPG / WEBP' }
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-violet-100 bg-white/80 p-4 shadow-[0_8px_26px_-18px_rgba(124,58,237,0.5)] backdrop-blur transition hover:-translate-y-0.5 hover:border-violet-300"
              >
                <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-500">
                  <f.icon className="h-4 w-4" />
                </span>
                <p className="text-sm font-semibold text-zinc-800">{f.title}</p>
                <p className="mt-0.5 text-[11px] text-zinc-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPickFile} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 bg-white">
      {/* ===== 画布区 ===== */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-violet-100/80 bg-white/80 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-600 transition hover:bg-violet-50"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            换图
          </button>
          <span className="max-w-[220px] truncate text-xs text-zinc-400">{image.name}</span>

          <div className="flex-1" />

          <button
            type="button"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition',
              comparing
                ? 'border-violet-300 bg-violet-500 text-white'
                : 'border-violet-200 bg-white text-violet-600 hover:bg-violet-50'
            )}
            title="按住查看原图"
          >
            <Eye className="h-3.5 w-3.5" />
            对比
          </button>

          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="撤销 (Ctrl+Z)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-600 transition hover:bg-violet-50 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="重做 (Ctrl+Shift+Z)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-600 transition hover:bg-violet-50 disabled:opacity-35"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowExport(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-violet-200 transition hover:opacity-90 active:scale-[0.98]"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>

        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />
            <div className="absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-fuchsia-300/15 blur-3xl" />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(124,58,237,0.13) 1px, transparent 1px)',
                backgroundSize: '24px 24px'
              }}
            />
          </div>

          <div className="relative z-10 flex h-full w-full items-center justify-center">
            <div
              ref={wrapRef}
              className="relative"
              style={{ width: view.w, height: view.h }}
              onClick={() => setSelected(null)}
            >
              <canvas
                ref={canvasRef}
                className="block h-full w-full rounded-[18px] shadow-[0_24px_60px_-24px_rgba(76,29,149,0.45)] ring-1 ring-violet-100/70"
                style={{ filter: cssFilter }}
              />
              {tint && (
                <div
                  className="pointer-events-none absolute inset-0 rounded-[18px]"
                  style={{ background: tint.color, opacity: tint.opacity, mixBlendMode: 'soft-light' }}
                />
              )}
              {params.vignette > 0 && (
                <div
                  className="pointer-events-none absolute inset-0 rounded-[18px]"
                  style={{
                    background: `radial-gradient(circle at center, transparent 42%, rgba(0,0,0,${(0.8 * params.vignette) / 100}) 100%)`
                  }}
                />
              )}

              {!comparing &&
                decos.map((d) => (
                  <DecoView
                    key={d.id}
                    deco={d}
                    view={view}
                    selected={d.id === selected}
                    onPointerDown={onDecoPointerDown}
                    onPointerMove={onDecoPointerMove}
                    onPointerUp={onDecoPointerUp}
                  />
                ))}
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-violet-100 bg-white/80 px-3 py-1 text-[11px] text-zinc-400 backdrop-blur">
            按住「对比」看原图 · Ctrl+Z 撤销 · Delete 删除选中
          </div>
        </div>
      </div>

      {/* ===== 侧栏面板 ===== */}
      <aside className="flex w-[344px] shrink-0 flex-col border-l border-violet-100 bg-gradient-to-b from-white to-violet-50/40">
        <div className="grid grid-cols-4 gap-1 border-b border-violet-100 p-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-all duration-200',
                  active
                    ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-200'
                    : 'text-zinc-500 hover:bg-violet-50 hover:text-violet-600'
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {tab === 'beauty' && (
            <>
              <Section id="beauty-preset" title="一键美颜" icon={Sparkles}>
                <div className="grid grid-cols-3 gap-2">
                  {BEAUTY_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyBeautyPreset(p)}
                      className={cn(
                        'flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-[11px] transition-all duration-200',
                        activePreset === p.id
                          ? 'border-violet-300 bg-violet-500 text-white shadow-sm shadow-violet-200'
                          : 'border-violet-100 bg-white text-zinc-600 hover:border-violet-300 hover:bg-violet-50'
                      )}
                    >
                      <span className="font-semibold">{p.name}</span>
                      {p.hint && (
                        <span
                          className={cn(
                            'text-[10px]',
                            activePreset === p.id ? 'text-white/80' : 'text-zinc-400'
                          )}
                        >
                          {p.hint}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </Section>

              <Section id="beauty-slider" title="细节调整" icon={SlidersHorizontal}>
                <RangeRow label="磨皮" value={params.smooth} min={0} max={100} onChange={(v) => patchSkin('smooth', v)} onReset={() => patchSkin('smooth', 0)} />
                <RangeRow label="美白" value={params.whiten} min={0} max={100} onChange={(v) => patchSkin('whiten', v)} onReset={() => patchSkin('whiten', 0)} />
                <RangeRow label="红润" value={params.rosy} min={0} max={100} onChange={(v) => patchSkin('rosy', v)} onReset={() => patchSkin('rosy', 0)} />
                <RangeRow label="清晰度" value={params.sharpen} min={0} max={100} onChange={(v) => patchSkin('sharpen', v)} onReset={() => patchSkin('sharpen', 0)} />
              </Section>
            </>
          )}

          {tab === 'filter' && (
            <Section
              id="filter"
              title="滤镜"
              icon={Wand2}
              action={
                <ResetChip
                  label="重置"
                  onClick={() => {
                    setFilterId('none');
                    setStrength(80);
                  }}
                />
              }
            >
              <div className="grid grid-cols-3 gap-2">
                {FILTER_PRESETS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterId(f.id)}
                    className={cn(
                      'rounded-xl border py-2 text-[11px] font-medium transition-all duration-200',
                      filterId === f.id
                        ? 'border-violet-300 bg-violet-500 text-white shadow-sm shadow-violet-200'
                        : 'border-violet-100 bg-white text-zinc-600 hover:border-violet-300 hover:bg-violet-50'
                    )}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="pt-1">
                <RangeRow
                  label="滤镜强度"
                  value={strength}
                  min={0}
                  max={100}
                  suffix="%"
                  disabled={filterId === 'none'}
                  onChange={setStrength}
                  onReset={() => setStrength(80)}
                />
              </div>
            </Section>
          )}

          {tab === 'adjust' && (
            <>
              <Section id="adjust-light" title="光影" icon={SlidersHorizontal}>
                <RangeRow label="亮度" value={params.brightness} min={50} max={150} suffix="%" onChange={(v) => patch({ brightness: v })} onReset={() => patch({ brightness: 100 })} />
                <RangeRow label="对比度" value={params.contrast} min={50} max={150} suffix="%" onChange={(v) => patch({ contrast: v })} onReset={() => patch({ contrast: 100 })} />
                <RangeRow label="饱和度" value={params.saturate} min={0} max={200} suffix="%" onChange={(v) => patch({ saturate: v })} onReset={() => patch({ saturate: 100 })} />
                <RangeRow label="色温" value={params.temperature} min={-100} max={100} onChange={(v) => patch({ temperature: v })} onReset={() => patch({ temperature: 0 })} />
              </Section>

              <Section id="adjust-more" title="质感" icon={Sparkles}>
                <RangeRow label="暗角" value={params.vignette} min={0} max={100} onChange={(v) => patch({ vignette: v })} onReset={() => patch({ vignette: 0 })} />
                <RangeRow label="模糊" value={params.blur} min={0} max={20} step={0.5} decimals={1} suffix="px" onChange={(v) => patch({ blur: v })} onReset={() => patch({ blur: 0 })} />
                <RangeRow label="复古" value={params.sepia} min={0} max={100} suffix="%" onChange={(v) => patch({ sepia: v })} onReset={() => patch({ sepia: 0 })} />
                <RangeRow label="黑白" value={params.grayscale} min={0} max={100} suffix="%" onChange={(v) => patch({ grayscale: v })} onReset={() => patch({ grayscale: 0 })} />
              </Section>

              <Section id="adjust-transform" title="方向" icon={RotateCw}>
                <div className="flex flex-wrap gap-2">
                  <ToolButton
                    icon={RotateCw}
                    onClick={() => setTransform((t) => ({ ...t, rotate: (((t.rotate + 90) % 360) as RotateAngle) }))}
                  >
                    旋转 90°
                  </ToolButton>
                  <ToolButton
                    icon={FlipHorizontal2}
                    active={transform.flipH}
                    onClick={() => setTransform((t) => ({ ...t, flipH: !t.flipH }))}
                  >
                    水平翻转
                  </ToolButton>
                  <ToolButton
                    icon={FlipVertical2}
                    active={transform.flipV}
                    onClick={() => setTransform((t) => ({ ...t, flipV: !t.flipV }))}
                  >
                    垂直翻转
                  </ToolButton>
                </div>
              </Section>
            </>
          )}

          {tab === 'deco' && (
            <>
              <Section id="deco-sticker" title="贴纸与文字" icon={Smile}>
                <div className="grid grid-cols-6 gap-1.5">
                  {STICKER_ICONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      title={s.name}
                      onClick={() => addSticker(s.id)}
                      className="flex h-9 items-center justify-center rounded-xl border border-violet-100 bg-white text-base text-violet-500 transition hover:border-violet-300 hover:bg-violet-50"
                    >
                      {STICKER_GLYPH[s.id] ?? '★'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {STICKER_EMOJI.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => addSticker(`e:${e}`)}
                      className="flex h-9 items-center justify-center rounded-xl border border-violet-100 bg-white text-base transition hover:border-violet-300 hover:bg-violet-50"
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <ToolButton icon={Type} block onClick={addText}>
                  添加文字
                </ToolButton>
              </Section>

              <Section id="deco-edit" title="编辑选中元素" icon={Type}>
                {!selectedDeco ? (
                  <p className="py-3 text-center text-[11px] text-zinc-400">
                    先点选画布上的贴纸或文字
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {selectedDeco.type === 'text' && (
                      <textarea
                        value={selectedDeco.text}
                        rows={2}
                        onChange={(e) => patchSelected({ text: e.target.value } as Partial<Deco>)}
                        className="w-full resize-none rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs text-zinc-700 outline-none transition focus:border-violet-300"
                      />
                    )}

                    <RangeRow
                      label="大小"
                      value={selectedDeco.size}
                      min={0.04}
                      max={0.8}
                      step={0.005}
                      decimals={3}
                      onChange={(v) => patchSelected({ size: v } as Partial<Deco>)}
                    />
                    <RangeRow
                      label="旋转"
                      value={selectedDeco.rotation}
                      min={-180}
                      max={180}
                      suffix="°"
                      onChange={(v) => patchSelected({ rotation: v } as Partial<Deco>)}
                      onReset={() => patchSelected({ rotation: 0 } as Partial<Deco>)}
                    />

                    <div className="space-y-1">
                      <p className="text-[11px] text-zinc-500">颜色</p>
                      <div className="flex flex-wrap gap-1.5">
                        {DECO_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => patchSelected({ color: c } as Partial<Deco>)}
                            className={cn(
                              'h-6 w-6 rounded-full border transition',
                              selectedDeco.color === c
                                ? 'border-violet-400 ring-2 ring-violet-200'
                                : 'border-zinc-200 hover:scale-110'
                            )}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>

                    {selectedDeco.type === 'text' && (
                      <>
                        <div className="space-y-1">
                          <p className="text-[11px] text-zinc-500">字体</p>
                          <div className="flex gap-1.5">
                            {FONTS.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => patchSelected({ font: f.id } as Partial<Deco>)}
                                className={chipClass(selectedDeco.font === f.id)}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] text-zinc-500">底色</p>
                          <div className="flex gap-1.5">
                            {TEXT_BG_COLORS.map((c, i) => (
                              <button
                                key={c ?? `none-${i}`}
                                type="button"
                                onClick={() => patchSelected({ bg: c } as Partial<Deco>)}
                                className={cn(
                                  'h-6 w-6 rounded-full border transition',
                                  selectedDeco.bg === c
                                    ? 'border-violet-400 ring-2 ring-violet-200'
                                    : 'border-zinc-200 hover:scale-110'
                                )}
                                style={{
                                  background: c ?? 'transparent',
                                  backgroundImage: c
                                    ? undefined
                                    : 'linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)',
                                  backgroundSize: c ? undefined : '8px 8px',
                                  backgroundPosition: c ? undefined : '0 0, 4px 4px'
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    <ToolButton icon={Trash2} variant="ghost" block onClick={removeSelected}>
                      删除该元素
                    </ToolButton>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        <div className="border-t border-violet-100 p-3">
          <button
            type="button"
            onClick={resetAll}
            className="w-full rounded-xl border border-violet-200 bg-white py-2 text-xs font-medium text-violet-600 transition hover:bg-violet-50"
          >
            重置全部效果
          </button>
        </div>
      </aside>

      {/* ===== 导出弹窗 ===== */}
      {showExport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-violet-950/25 p-4 backdrop-blur-sm"
          onClick={() => setShowExport(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-6 shadow-2xl shadow-violet-300/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-800">导出图片</h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  输出尺寸 {outDims ? `${outDims.w} × ${outDims.h}` : '—'} px
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExport(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-violet-50 hover:text-violet-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-zinc-500">格式</p>
                <div className="flex gap-2">
                  {(['jpeg', 'png', 'webp'] as ExportFormat[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      disabled={f === 'webp' && !webpOk}
                      onClick={() => setFormat(f)}
                      className={cn(
                        'flex-1 rounded-xl border py-2 text-xs font-medium uppercase transition disabled:opacity-40',
                        format === f
                          ? 'border-violet-300 bg-violet-500 text-white shadow-sm shadow-violet-200'
                          : 'border-violet-100 bg-white text-zinc-600 hover:border-violet-300 hover:bg-violet-50'
                      )}
                    >
                      {f === 'jpeg' ? 'JPG' : f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-zinc-500">尺寸</p>
                <div className="flex flex-wrap gap-2">
                  {SIZE_PRESETS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSizeId(s.id)}
                      className={chipClass(sizeId === s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {format !== 'png' && (
                <RangeRow
                  label="画质"
                  value={Math.round(quality * 100)}
                  min={40}
                  max={100}
                  suffix="%"
                  onChange={(v) => setQuality(v / 100)}
                />
              )}
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setShowExport(false)}
                className="flex-1 rounded-xl border border-violet-200 bg-white py-2.5 text-xs font-medium text-violet-600 transition hover:bg-violet-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void doExport()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 py-2.5 text-xs font-semibold text-white shadow-md shadow-violet-200 transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                {busy ? '导出中…' : `下载 ${mimeOf(format).split('/')[1].toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPickFile} />
    </div>
  );
}
