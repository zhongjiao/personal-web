import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent
} from 'react';
import { toast } from 'sonner';
import {
  ArrowUpRight,
  Blend,
  Brush,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Crop,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FilePlus2,
  FlipHorizontal2,
  Grid3x3,
  History,
  ImagePlus,
  Keyboard,
  Layers,
  LayoutGrid,
  Maximize,
  Merge,
  Move,
  PaintBucket,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Pipette,
  Plus,
  Redo2,
  Scissors,
  Shapes,
  SlidersHorizontal,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react';
import { ImageCropOverlay } from '@pmp/image-kit';
import { Select } from '@pmp/ui';
import {
  clamp,
  downloadBlob,
  formatBytes,
  loadImageFromFile,
  mimeOf,
  supportsWebp,
  type ExportFormat
} from '@pmp/image-kit';
import * as PS from './lib/photoshop';
import { alphaCoverage, blobToCanvas, canvasToPngBlob, requestAiCutout } from './lib/cutout-api';
import { cn } from '@pmp/ui';

/* ===================== 常量 ===================== */

const DEFAULT_SIZE = { width: 960, height: 640 };
const MAX_HISTORY = 20;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;
const MAX_BITMAP_SIDE = 8192;

const PALETTE = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#f59e0b', '#facc15', '#22c55e', '#14b8a6',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#78716c', '#9ca3af'
];

const SIZE_PRESETS = [
  { label: '1920×1080', w: 1920, h: 1080 },
  { label: '1080×1080', w: 1080, h: 1080 },
  { label: '800×600', w: 800, h: 600 },
  { label: '600×800', w: 600, h: 800 }
];

const COLLAGE_LAYOUTS: {
  id: string;
  label: string;
  cols?: number;
  rows?: number;
  mode?: 'stack-v' | 'stack-h';
}[] = [
  { id: 'grid-1x2', label: '竖排2', cols: 1, rows: 2 },
  { id: 'grid-2x1', label: '横排2', cols: 2, rows: 1 },
  { id: 'grid-2x2', label: '四宫格', cols: 2, rows: 2 },
  { id: 'grid-1x3', label: '竖排3', cols: 1, rows: 3 },
  { id: 'grid-3x1', label: '横排3', cols: 3, rows: 1 },
  { id: 'grid-3x3', label: '九宫格', cols: 3, rows: 3 },
  { id: 'stack-v', label: '纵向长图', mode: 'stack-v' },
  { id: 'stack-h', label: '横向长图', mode: 'stack-h' }
];

const ANCHORS: { x: number; y: number; label: string }[] = [
  { x: 0, y: 0, label: '↖' },
  { x: 0.5, y: 0, label: '↑' },
  { x: 1, y: 0, label: '↗' },
  { x: 0, y: 0.5, label: '←' },
  { x: 0.5, y: 0.5, label: '·' },
  { x: 1, y: 0.5, label: '→' },
  { x: 0, y: 1, label: '↙' },
  { x: 0.5, y: 1, label: '↓' },
  { x: 1, y: 1, label: '↘' }
];

const CHECKER =
  'linear-gradient(45deg,#c7c7c7 25%,transparent 25%),linear-gradient(-45deg,#c7c7c7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c7c7c7 75%),linear-gradient(-45deg,transparent 75%,#c7c7c7 75%)';

const BLEND_LABEL = Object.fromEntries(
  PS.BLEND_MODES.map((m) => [m.id, m.label])
) as Record<PS.BlendModeId, string>;

type ToolId =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'magic-wand'
  | 'ai-cutout'
  | 'brush'
  | 'eraser'
  | 'mosaic'
  | 'bucket'
  | 'gradient'
  | 'eyedropper'
  | 'text'
  | 'shape'
  | 'crop';

const TOOLS: { id: ToolId; label: string; icon: LucideIcon; hint: string; hotkey: string }[] = [
  { id: 'move', label: '移动', icon: Move, hint: '拖动移动当前图层', hotkey: 'V' },
  { id: 'marquee-rect', label: '矩形选框', icon: SquareDashed, hint: '拖出矩形选区', hotkey: 'M' },
  { id: 'marquee-ellipse', label: '椭圆选框', icon: Circle, hint: '拖出椭圆选区', hotkey: 'Shift+M' },
  { id: 'lasso', label: '套索', icon: PenTool, hint: '按住拖拽圈出选区', hotkey: 'L' },
  { id: 'magic-wand', label: '魔棒', icon: Wand2, hint: '点击按颜色容差选择', hotkey: 'W' },
  {
    id: 'ai-cutout',
    label: 'AI 抠图',
    icon: Scissors,
    hint: '调本地抠图服务去掉背景，结果作为新图层',
    hotkey: 'Q'
  },
  { id: 'brush', label: '画笔', icon: Brush, hint: '[ / ] 调整大小', hotkey: 'B' },
  { id: 'eraser', label: '橡皮擦', icon: Eraser, hint: '擦除当前图层内容', hotkey: 'E' },
  { id: 'mosaic', label: '马赛克', icon: Grid3x3, hint: '拖拽涂抹打码，[ / ] 调整笔刷', hotkey: 'K' },
  { id: 'bucket', label: '油漆桶', icon: PaintBucket, hint: '按容差填充（Shift+G 渐变）', hotkey: 'G' },
  { id: 'gradient', label: '渐变', icon: Blend, hint: '拖拽方向生成渐变', hotkey: 'Shift+G' },
  { id: 'eyedropper', label: '吸管', icon: Pipette, hint: '点击取样前景色', hotkey: 'I' },
  { id: 'text', label: '文字', icon: Type, hint: '点击后输入文字', hotkey: 'T' },
  { id: 'shape', label: '形状', icon: Shapes, hint: 'Shift 约束正方形 / 正圆', hotkey: 'U' },
  { id: 'crop', label: '裁剪', icon: Crop, hint: '拖出裁剪框后点击「应用」', hotkey: 'C' }
];

const TOOL_HOTKEYS: Record<string, ToolId> = {
  v: 'move',
  m: 'marquee-rect',
  l: 'lasso',
  w: 'magic-wand',
  q: 'ai-cutout',
  b: 'brush',
  e: 'eraser',
  k: 'mosaic',
  i: 'eyedropper',
  t: 'text',
  u: 'shape',
  c: 'crop'
};

/** 快捷键说明表：与下面 keydown 处理器一一对应，供「快捷键」弹窗展示 */
interface ShortcutItem {
  keys: string[];
  label: string;
  /** 备注（如浏览器保留键冲突） */
  note?: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '工具',
    items: TOOLS.map((t) => ({
      keys: t.hotkey.split('+').map((k) => k.trim()),
      label: t.label
    }))
  },
  {
    title: '编辑',
    items: [
      { keys: ['Ctrl', 'Z'], label: '撤销' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: '重做' },
      { keys: ['Ctrl', 'Y'], label: '重做（备选）' },
      { keys: ['Delete'], label: '删除选区内容' },
      { keys: ['[', ']'], label: '减小 / 增大画笔、橡皮擦' },
      { keys: ['Enter'], label: '应用自由变换', note: '仅变换进行中' },
      { keys: ['Esc'], label: '取消自由变换', note: '仅变换进行中' }
    ]
  },
  {
    title: '选区',
    items: [
      { keys: ['Ctrl', 'A'], label: '全选' },
      { keys: ['Ctrl', 'D'], label: '取消选择' }
    ]
  },
  {
    title: '变换',
    items: [
      {
        keys: ['Ctrl', 'T'],
        label: '自由变换',
        note: '浏览器保留键，会被「新建标签页」抢占而失效，可改用右侧面板按钮'
      }
    ]
  },
  {
    title: '视图',
    items: [
      { keys: ['Ctrl', '0'], label: '缩放 100%' },
      { keys: ['Ctrl', '='], label: '放大' },
      { keys: ['Ctrl', '-'], label: '缩小' },
      { keys: ['Ctrl', '滚轮'], label: '以光标为中心缩放' }
    ]
  },
  {
    title: '颜色',
    items: [
      { keys: ['X'], label: '交换前景 / 背景色' },
      { keys: ['D'], label: '恢复默认前景 / 背景色' }
    ]
  }
];

interface Snapshot {
  label: string;
  width: number;
  height: number;
  activeId: string;
  layers: PS.PsLayer[];
}

type DragState =
  | { kind: 'stroke'; mode: 'brush' | 'eraser' | 'mosaic'; last: { x: number; y: number } }
  | { kind: 'marquee'; shape: PS.SelectionKind; start: { x: number; y: number }; end: { x: number; y: number } }
  | { kind: 'move'; start: { x: number; y: number }; dx: number; dy: number }
  | { kind: 'shape'; start: { x: number; y: number }; end: { x: number; y: number }; shift: boolean }
  | { kind: 'gradient'; start: { x: number; y: number }; end: { x: number; y: number } };

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type TransformDrag =
  | { kind: 'move'; start: { x: number; y: number }; orig: PS.FreeTransform }
  | { kind: 'scale'; handle: HandleId; start: { x: number; y: number }; orig: PS.FreeTransform }
  | { kind: 'rotate'; start: { x: number; y: number }; orig: PS.FreeTransform };

function transformCorners(t: PS.FreeTransform, bounds: PS.Rect) {
  const cx = bounds.x + bounds.w / 2 + t.tx;
  const cy = bounds.y + bounds.h / 2 + t.ty;
  const hx = (bounds.w / 2) * t.sx;
  const hy = (bounds.h / 2) * t.sy;
  const rad = (t.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corner = (ox: number, oy: number) => ({
    x: cx + ox * cos - oy * sin,
    y: cy + ox * sin + oy * cos
  });
  return { nw: corner(-hx, -hy), ne: corner(hx, -hy), se: corner(hx, hy), sw: corner(-hx, hy) };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function insideTransformBox(pt: { x: number; y: number }, t: PS.FreeTransform, bounds: PS.Rect) {
  const cx = bounds.x + bounds.w / 2 + t.tx;
  const cy = bounds.y + bounds.h / 2 + t.ty;
  const rad = (-t.angle * Math.PI) / 180;
  const ox = pt.x - cx;
  const oy = pt.y - cy;
  const rx = ox * Math.cos(rad) - oy * Math.sin(rad);
  const ry = ox * Math.sin(rad) + oy * Math.cos(rad);
  return Math.abs(rx) <= (bounds.w / 2) * t.sx && Math.abs(ry) <= (bounds.h / 2) * t.sy;
}

/** 文档整幅矩形的等价包围盒（空内容时的兜底） */
function docBounds(docW: number, docH: number): PS.Rect {
  return { x: 0, y: 0, w: docW, h: docH };
}

/** 求选中图层内容（应用蒙版后）的并集包围盒，为空时回退整幅文档 */
function selectionBounds(layers: PS.PsLayer[], ids: string[], docW: number, docH: number): PS.Rect {
  const canvases = layers.filter((l) => ids.includes(l.id)).map((l) => PS.applyLayerMask(l));
  return PS.unionContentBounds(canvases) ?? docBounds(docW, docH);
}

/* ===================== 小组件 ===================== */

function IconBtn({
  children,
  onClick,
  title,
  active,
  disabled
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-40',
        active &&
          'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]/90 hover:text-white'
      )}
    >
      {children}
    </button>
  );
}

function ChipButton({
  children,
  onClick,
  active,
  disabled,
  block
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        block && 'w-full',
        active
          ? 'border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm hover:bg-[var(--color-primary)]/90'
          : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-foreground)]'
      )}
    >
      {children}
    </button>
  );
}

/** 右侧面板卡片：统一标题栏 + 内容区，点击标题栏可折叠 / 展开，跟随明暗主题 */
function Panel({
  title,
  icon: Icon,
  children,
  action
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const toggle = () => setOpen((v) => !v);
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <header
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex cursor-pointer select-none items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--color-accent)]/60',
          open && 'border-b border-[var(--color-border)]'
        )}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          <Icon className="h-3 w-3" />
        </span>
        <h3 className="flex-1 truncate text-[11px] font-semibold tracking-wider text-[var(--color-muted-foreground)]">
          {title}
        </h3>
        {action}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform',
            !open && '-rotate-90'
          )}
        />
      </header>
      {open && <div className="space-y-2.5 px-3 py-3">{children}</div>}
    </section>
  );
}

/** 面板滑杆行：标签 + 数值 + range，双击标签复位 */
function PanelRange({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  decimals = 0,
  disabled,
  onChange,
  onReset
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className={cn('space-y-1', disabled && 'pointer-events-none opacity-50')}>
      <div className="flex items-center justify-between text-[11px]">
        <span
          onDoubleClick={onReset}
          title={onReset ? '双击复位' : undefined}
          className={cn(
            'text-[var(--color-muted-foreground)]',
            onReset && 'cursor-pointer select-none hover:text-[var(--color-primary)]'
          )}
        >
          {label}
        </span>
        <span className="font-mono tabular-nums text-[var(--color-foreground)]">
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-muted)] outline-none transition-colors [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-card)] [&::-moz-range-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-card)] [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110"
      />
    </div>
  );
}

function MiniSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  width = 'w-24',
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  width?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('h-1 cursor-pointer accent-[var(--color-primary)]', width)}
      />
      <span className="w-9 text-right font-mono tabular-nums text-[var(--color-foreground)]">
        {value}
        {suffix}
      </span>
    </label>
  );
}

function ColorInput({
  value,
  onChange,
  title
}: {
  value: string;
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <input
      type="color"
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-9 shrink-0 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0.5"
    />
  );
}

function LayerThumb({ layer, revision }: { layer: PS.PsLayer; revision: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const content = PS.applyLayerMask(layer);
    const scale = Math.min(w / content.width, h / content.height);
    const dw = content.width * scale;
    const dh = content.height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(content, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }, [layer, revision]);
  return (
    <canvas
      ref={ref}
      width={40}
      height={30}
      className="shrink-0 rounded-md border border-[var(--color-border)]"
      style={{
        backgroundImage: CHECKER,
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
        backgroundColor: '#ffffff'
      }}
    />
  );
}

/** 一个文档（标签页）的完整状态：内容 + 独立历史 + 视图快照 */
interface DocTab {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: PS.PsLayer[];
  activeLayerId: string;
  selectedIds: string[];
  history: Snapshot[];
  historyIndex: number;
  zoom: number;
  selection: PS.Selection | null;
  adjust: PS.AdjustValues | null;
  cropNorm: PS.Rect;
}

function makeEmptyTab(name: string, width: number, height: number, whiteBg = true): DocTab {
  const bgLayer = PS.makeLayer('背景', width, height);
  if (whiteBg) PS.fillSelection(bgLayer.canvas, null, '#ffffff', width, height);
  const history: Snapshot[] = [
    { label: '新建文档', width, height, activeId: bgLayer.id, layers: [PS.cloneLayer(bgLayer)] }
  ];
  return {
    id: PS.uid(),
    name,
    width,
    height,
    layers: [bgLayer],
    activeLayerId: bgLayer.id,
    selectedIds: [bgLayer.id],
    history,
    historyIndex: 0,
    zoom: 1,
    selection: null,
    adjust: null,
    cropNorm: { x: 0, y: 0, w: 1, h: 1 }
  };
}

function createInitialTab(): DocTab {
  return makeEmptyTab('未命名-1', DEFAULT_SIZE.width, DEFAULT_SIZE.height, true);
}

/* ===================== 主组件 ===================== */

export default function PhotoshopPage() {
  const [init] = useState(createInitialTab);
  const [tabs, setTabs] = useState<DocTab[]>([init]);
  const [activeTabId, setActiveTabId] = useState(init.id);
  const [docName, setDocName] = useState(init.name);
  const [doc, setDoc] = useState({ width: init.width, height: init.height });
  const [layers, setLayers] = useState<PS.PsLayer[]>(init.layers);
  const [activeId, setActiveId] = useState(init.activeLayerId);
  const [selectedIds, setSelectedIds] = useState<string[]>(init.selectedIds);

  /** 默认工具：进入工具时选中「移动」 */
  const [tool, setTool] = useState<ToolId>('move');
  const [fg, setFg] = useState('#111827');
  const [bg, setBg] = useState('#ffffff');
  const [brush, setBrush] = useState({ size: 24, hardness: 70, opacity: 100 });
  const [eraser, setEraser] = useState({ size: 40, hardness: 60, opacity: 100 });
  /** 马赛克：size = 格子边长（像素），brush = 涂抹笔刷直径 */
  const [mosaic, setMosaic] = useState({ size: 12, brush: 60 });
  const [tolerance, setTolerance] = useState(32);
  const [gradient, setGradient] = useState<{ kind: PS.GradientKind; toBg: boolean }>({
    kind: 'linear',
    toBg: false
  });
  const [shape, setShape] = useState<{ kind: PS.ShapeKind; fill: boolean; lineWidth: number }>({
    kind: 'rect',
    fill: true,
    lineWidth: 4
  });
  const [textOpts, setTextOpts] = useState<PS.TextOpts>({
    font: 'sans',
    size: 32,
    color: '#111827',
    bold: false,
    italic: false
  });

  const [selection, setSelection] = useState<PS.Selection | null>(null);
  const [adjust, setAdjust] = useState<PS.AdjustValues | null>(null);
  const [zoom, setZoom] = useState(1);
  const [revision, setRevision] = useState(0);
  /** AI 抠图进行中（含图片上传 + 服务端推理） */
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; value: string } | null>(null);
  const [cropNorm, setCropNorm] = useState<PS.Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [transform, setTransform] = useState<PS.FreeTransform | null>(null);
  /** 自由变换的基准包围盒（文档坐标，取自选中图层内容） */
  const [transformBounds, setTransformBounds] = useState<PS.Rect | null>(null);

  /** 羽化半径（px），作用于新建/当前选区 */
  const [feather, setFeather] = useState(0);
  /** 图层蒙版编辑模式：画笔 / 橡皮擦写到蒙版而非图层内容 */
  const [maskEditing, setMaskEditing] = useState(false);

  const [resizeOpen, setResizeOpen] = useState(false);
  const [resizeW, setResizeW] = useState(0);
  const [resizeH, setResizeH] = useState(0);
  const [resizeKeep, setResizeKeep] = useState(true);

  const [canvasSizeOpen, setCanvasSizeOpen] = useState(false);
  const [canvasW, setCanvasW] = useState(0);
  const [canvasH, setCanvasH] = useState(0);
  const [anchorX, setAnchorX] = useState(0.5);
  const [anchorY, setAnchorY] = useState(0.5);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /** 右侧面板整体是否展开 */
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportQuality, setExportQuality] = useState(92);

  const [newOpen, setNewOpen] = useState(false);
  const [newW, setNewW] = useState(960);
  const [newH, setNewH] = useState(640);
  const [newBgWhite, setNewBgWhite] = useState(true);

  const [collageOpen, setCollageOpen] = useState(false);
  const [collageImgs, setCollageImgs] = useState<(HTMLImageElement | HTMLCanvasElement)[]>([]);
  const [collageLayout, setCollageLayout] = useState('grid-2x2');
  const [collageGap, setCollageGap] = useState(12);
  const [collageWidth, setCollageWidth] = useState(1600);
  const [collageBg, setCollageBg] = useState('#ffffff');
  const [collageRadius, setCollageRadius] = useState(0);

  /* ---------- 视图尺寸 ---------- */
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  const renderScale = useMemo(() => {
    let s = zoom * dpr;
    if (doc.width * s > MAX_BITMAP_SIDE || doc.height * s > MAX_BITMAP_SIDE) {
      s = Math.min(MAX_BITMAP_SIDE / doc.width, MAX_BITMAP_SIDE / doc.height);
    }
    return Math.max(0.02, s);
  }, [zoom, dpr, doc.width, doc.height]);
  const bmpW = Math.round(doc.width * renderScale);
  const bmpH = Math.round(doc.height * renderScale);
  const dispW = doc.width * zoom;
  const dispH = doc.height * zoom;

  /* ---------- refs ---------- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const layerFileRef = useRef<HTMLInputElement>(null);

  const docRef = useRef(doc);
  docRef.current = doc;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const docNameRef = useRef(docName);
  docNameRef.current = docName;
  const tabSeq = useRef(1);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const uiRef = useRef({
    tool, fg, bg, brush, eraser, mosaic, tolerance, gradient, shape, textOpts, selection, adjust, zoom, renderScale, cropNorm, transform, transformBounds, feather, maskEditing
  });
  uiRef.current = {
    tool, fg, bg, brush, eraser, mosaic, tolerance, gradient, shape, textOpts, selection, adjust, zoom, renderScale, cropNorm, transform, transformBounds, feather, maskEditing
  };

  const dragRef = useRef<DragState | null>(null);
  const transformDragRef = useRef<TransformDrag | null>(null);
  const moveBoundsRef = useRef<PS.Rect | null>(null);
  const lassoRef = useRef<{ points: { x: number; y: number }[] } | null>(null);
  const strokeRef = useRef<{ canvas: HTMLCanvasElement; alpha: number } | null>(null);
  /** 马赛克笔刷的落笔状态（仅马赛克工具使用，内部持有源图与累积遮罩） */
  const mosaicRef = useRef<PS.MosaicStrokeState | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const dashRef = useRef(0);
  const cursorLabelRef = useRef<HTMLSpanElement>(null);
  const maskPreviewRef = useRef<{ tint: HTMLCanvasElement; outline: HTMLCanvasElement; outlineDark: HTMLCanvasElement } | null>(null);

  const historyRef = useRef<Snapshot[]>(init.history);
  const indexRef = useRef(init.historyIndex);
  const [historyState, setHistoryState] = useState<{ list: Snapshot[]; index: number }>({
    list: init.history,
    index: init.historyIndex
  });

  const activeLayer = useMemo(
    () => layers.find((l) => l.id === activeId) ?? null,
    [layers, activeId]
  );

  /* ---------- 历史 ---------- */
  const commit = useCallback((label: string) => {
    const list = historyRef.current.slice(0, indexRef.current + 1);
    list.push({
      label,
      width: docRef.current.width,
      height: docRef.current.height,
      activeId: activeIdRef.current,
      layers: layersRef.current.map(PS.cloneLayer)
    });
    while (list.length > MAX_HISTORY) list.shift();
    historyRef.current = list;
    indexRef.current = list.length - 1;
    setHistoryState({ list, index: indexRef.current });
  }, []);

  const afterEdit = useCallback(
    (label: string) => {
      setRevision((r) => r + 1);
      commit(label);
    },
    [commit]
  );

  const restore = useCallback((snap: Snapshot) => {
    docRef.current = { width: snap.width, height: snap.height };
    layersRef.current = snap.layers.map(PS.cloneLayer);
    activeIdRef.current = snap.activeId;
    setDoc({ width: snap.width, height: snap.height });
    setLayers(snap.layers.map(PS.cloneLayer));
    setActiveId(snap.activeId);
    selectedIdsRef.current = [snap.activeId];
    setSelectedIds([snap.activeId]);
    setSelection(null);
    setAdjust(null);
    setCropNorm({ x: 0, y: 0, w: 1, h: 1 });
    setTransform(null);
    setTransformBounds(null);
    setRevision((r) => r + 1);
  }, []);

  const syncHistory = useCallback(() => {
    setHistoryState({ list: historyRef.current, index: indexRef.current });
  }, []);

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    restore(historyRef.current[indexRef.current]);
    syncHistory();
  }, [restore, syncHistory]);

  const redo = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return;
    indexRef.current += 1;
    restore(historyRef.current[indexRef.current]);
    syncHistory();
  }, [restore, syncHistory]);

  const jumpTo = useCallback(
    (i: number) => {
      const target = clamp(i, 0, historyRef.current.length - 1);
      if (target === indexRef.current) return;
      indexRef.current = target;
      restore(historyRef.current[target]);
      syncHistory();
    },
    [restore, syncHistory]
  );

  /* ---------- 缩放（适应窗口） ---------- */
  const fitView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const pad = 64;
    const z = Math.min(
      (vp.clientWidth - pad) / docRef.current.width,
      (vp.clientHeight - pad) / docRef.current.height,
      1
    );
    setZoom(clamp(Number(z.toFixed(3)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  /* ---------- 多文档标签页 ---------- */

  /** 把当前活动文档的实时状态捕获为一个 DocTab（切换前调用） */
  const captureActiveTab = useCallback((): DocTab => {
    const ui = uiRef.current;
    return {
      id: activeTabIdRef.current,
      name: docNameRef.current,
      width: docRef.current.width,
      height: docRef.current.height,
      layers: layersRef.current,
      activeLayerId: activeIdRef.current,
      selectedIds: selectedIdsRef.current,
      history: historyRef.current,
      historyIndex: indexRef.current,
      zoom: ui.zoom,
      selection: ui.selection,
      adjust: ui.adjust,
      cropNorm: ui.cropNorm
    };
  }, []);

  /** 把某个 DocTab 载入为活动文档的实时状态 */
  const loadTab = useCallback((tab: DocTab) => {
    docRef.current = { width: tab.width, height: tab.height };
    layersRef.current = tab.layers;
    activeIdRef.current = tab.activeLayerId;
    historyRef.current = tab.history;
    indexRef.current = tab.historyIndex;
    setDoc({ width: tab.width, height: tab.height });
    setLayers(tab.layers);
    setActiveId(tab.activeLayerId);
    selectedIdsRef.current = tab.selectedIds;
    setSelectedIds(tab.selectedIds);
    setSelection(tab.selection);
    setAdjust(tab.adjust);
    setZoom(tab.zoom);
    setCropNorm(tab.cropNorm);
    setDocName(tab.name);
    setHistoryState({ list: tab.history, index: tab.historyIndex });
    setTextEdit(null);
    setRenamingId(null);
    setMaskEditing(false);
    setTransform(null);
    setTransformBounds(null);
    dragRef.current = null;
    strokeRef.current = null;
    setRevision((r) => r + 1);
  }, []);

  const switchTab = useCallback(
    (id: string) => {
      if (id === activeTabIdRef.current) return;
      const captured = captureActiveTab();
      const list = tabsRef.current.map((t) => (t.id === activeTabIdRef.current ? captured : t));
      const target = list.find((t) => t.id === id);
      if (!target) return;
      tabsRef.current = list;
      setTabs(list);
      activeTabIdRef.current = id;
      setActiveTabId(id);
      loadTab(target);
    },
    [captureActiveTab, loadTab]
  );

  /** 以某个文档内容新建标签页并切换过去（content 为已构建好的 DocTab） */
  const openNewTab = useCallback(
    (fresh: DocTab) => {
      const captured = captureActiveTab();
      const list = [...tabsRef.current.map((t) => (t.id === activeTabIdRef.current ? captured : t)), fresh];
      tabsRef.current = list;
      setTabs(list);
      activeTabIdRef.current = fresh.id;
      setActiveTabId(fresh.id);
      loadTab(fresh);
    },
    [captureActiveTab, loadTab]
  );

  const newTab = useCallback(() => {
    tabSeq.current += 1;
    openNewTab(makeEmptyTab(`未命名-${tabSeq.current}`, DEFAULT_SIZE.width, DEFAULT_SIZE.height, true));
    requestAnimationFrame(() => fitView());
  }, [openNewTab, fitView]);

  const closeTab = useCallback(
    (id: string) => {
      const list = tabsRef.current;
      if (list.length <= 1) {
        toast('至少保留一个文档');
        return;
      }
      const idx = list.findIndex((t) => t.id === id);
      if (idx < 0) return;
      if (id === activeTabIdRef.current) {
        const next = list.filter((t) => t.id !== id);
        const nextActive = list[idx + 1] ?? list[idx - 1];
        tabsRef.current = next;
        setTabs(next);
        activeTabIdRef.current = nextActive.id;
        setActiveTabId(nextActive.id);
        loadTab(nextActive);
      } else {
        const next = list.filter((t) => t.id !== id);
        tabsRef.current = next;
        setTabs(next);
      }
    },
    [loadTab]
  );

  const renameTab = useCallback((id: string, name: string) => {
    const clean = name.trim() || '未命名';
    if (id === activeTabIdRef.current) setDocName(clean);
    const next = tabsRef.current.map((t) => (t.id === id ? { ...t, name: clean } : t));
    tabsRef.current = next;
    setTabs(next);
    setRenamingTabId(null);
  }, []);

  /* ---------- 绘制 ---------- */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ui = uiRef.current;
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    const scale = canvas.width / dw;
    PS.resetCtx(ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = scale < 2.5;
    ctx.imageSmoothingQuality = 'high';
    const drag = dragRef.current;
    PS.paintLayers(ctx, layersRef.current, {
      docW: dw,
      docH: dh,
      activeId: activeIdRef.current,
      activeFilter: ui.adjust && !PS.isNeutralAdjust(ui.adjust) ? PS.adjustCss(ui.adjust) : 'none',
      stroke: strokeRef.current,
      offset: drag?.kind === 'move' ? { x: drag.dx, y: drag.dy } : null,
      offsetIds: drag?.kind === 'move' ? selectedIdsRef.current : null,
      transform: ui.transform,
      transformIds: ui.transform ? selectedIdsRef.current : null,
      transformBounds: ui.transformBounds,
      selection: ui.selection
    });
    if (ui.maskEditing) {
      const active = layersRef.current.find((l) => l.id === activeIdRef.current);
      if (active?.mask) {
        ctx.drawImage(PS.maskRubyOverlay(active.mask), 0, 0);
      }
    }
    ctx.restore();
  }, []);

  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ui = uiRef.current;
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    const scale = canvas.width / dw;
    PS.resetCtx(ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineWidth = 1 / scale;

    if (ui.selection) {
      if (ui.selection.kind === 'mask' && maskPreviewRef.current) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(maskPreviewRef.current.tint, 0, 0);
        ctx.drawImage(maskPreviewRef.current.outlineDark, 0, 1 / scale);
        ctx.drawImage(maskPreviewRef.current.outline, 0, 0);
        ctx.restore();
      } else if (ui.selection.kind !== 'mask') {
        ctx.save();
        ctx.setLineDash([5 / scale, 4 / scale]);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineDashOffset = -dashRef.current / scale;
        PS.selectionPath(ctx, ui.selection, dw, dh);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineDashOffset = (5 - dashRef.current) / scale;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (ui.transform) {
      const c = transformCorners(ui.transform, ui.transformBounds ?? docBounds(dw, dh));
      ctx.save();
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.moveTo(c.nw.x, c.nw.y);
      ctx.lineTo(c.ne.x, c.ne.y);
      ctx.lineTo(c.se.x, c.se.y);
      ctx.lineTo(c.sw.x, c.sw.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      const n = midpoint(c.nw, c.ne);
      const e = midpoint(c.ne, c.se);
      const s = midpoint(c.se, c.sw);
      const w = midpoint(c.sw, c.nw);
      const handles: Record<string, { x: number; y: number }> = {
        nw: c.nw, ne: c.ne, se: c.se, sw: c.sw, n, e, s, w
      };
      const r = 5 / Math.max(0.02, ui.zoom);
      ctx.setLineDash([]);
      for (const h of Object.values(handles)) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      const cx = (c.nw.x + c.se.x) / 2;
      const cy = (c.nw.y + c.se.y) / 2;
      let dirx = n.x - cx;
      let diry = n.y - cy;
      const len = Math.hypot(dirx, diry) || 1;
      dirx /= len;
      diry /= len;
      const off = 26 / Math.max(0.02, ui.zoom);
      const rh = { x: n.x + dirx * off, y: n.y + diry * off };
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(rh.x, rh.y);
      ctx.stroke();
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (lassoRef.current) {
      const pts = lassoRef.current.points;
      const cur = cursorRef.current;
      ctx.save();
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      if (cur) ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.restore();
    }

    const drag = dragRef.current;
    if (drag?.kind === 'shape') {
      ctx.save();
      if (ui.selection && ui.selection.kind !== 'mask') {
        PS.selectionPath(ctx, ui.selection, dw, dh);
        ctx.clip(ui.selection.inverted ? 'evenodd' : 'nonzero');
      }
      PS.paintShape(ctx, drag.start, drag.end, {
        kind: ui.shape.kind,
        color: ui.fg,
        lineWidth: ui.shape.lineWidth,
        fill: ui.shape.fill,
        constrain: drag.shift
      });
      ctx.restore();
    } else if (drag?.kind === 'gradient') {
      ctx.save();
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(drag.start.x, drag.start.y);
      ctx.lineTo(drag.end.x, drag.end.y);
      ctx.stroke();
      ctx.restore();
    } else if (drag?.kind === 'marquee') {
      ctx.save();
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      const rect = PS.normalizeRect(drag.start, drag.end);
      if (drag.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
      ctx.restore();
    } else if (drag?.kind === 'move') {
      const mb = moveBoundsRef.current ?? docBounds(dw, dh);
      ctx.save();
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.strokeRect(mb.x + drag.dx, mb.y + drag.dy, mb.w, mb.h);
      ctx.restore();
    }

    const cur = cursorRef.current;
    if (
      cur &&
      !ui.transform &&
      (ui.tool === 'brush' || ui.tool === 'eraser' || ui.tool === 'mosaic')
    ) {
      const size =
        ui.tool === 'brush' ? ui.brush.size : ui.tool === 'eraser' ? ui.eraser.size : ui.mosaic.brush;
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, Math.max(0.5, size / 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.setLineDash([3 / scale, 3 / scale]);
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, Math.max(0.5, size / 2) + 1.5 / scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    paint();
  }, [paint, layers, doc, activeId, adjust, selection, revision, renderScale, transform, transformBounds, maskEditing]);

  useEffect(() => {
    paintOverlay();
  }, [paintOverlay, layers, doc, activeId, selection, revision, renderScale, tool, fg, bg, brush, eraser, shape, gradient, transform, transformBounds]);

  useEffect(() => {
    if (!selection) return;
    let raf = 0;
    const loop = () => {
      dashRef.current = (dashRef.current + 0.5) % 8;
      paintOverlay();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [selection, paintOverlay]);

  useEffect(() => {
    if (selection?.kind === 'mask') {
      const outline = PS.buildSelectionOutline(selection.mask);
      maskPreviewRef.current = {
        tint: PS.colorizeMask(selection.mask, '#3b82f6', 0.28),
        outline,
        outlineDark: PS.colorizeMask(outline, '#000000', 0.8)
      };
    } else {
      maskPreviewRef.current = null;
    }
  }, [selection]);

  /* ---------- 缩放 ---------- */
  useEffect(() => {
    fitView();
  }, [fitView]);

  // 活动图层没有蒙版时自动退出蒙版编辑
  useEffect(() => {
    if (maskEditing) {
      const layer = layers.find((l) => l.id === activeId);
      if (!layer?.mask) setMaskEditing(false);
    }
  }, [maskEditing, activeId, layers]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom((z) => clamp(z * factor, ZOOM_MIN, ZOOM_MAX));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- 工具辅助 ---------- */
  const toDoc = useCallback((clientX: number, clientY: number) => {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1) * dw,
      y: clamp((clientY - rect.top) / rect.height, 0, 1) * dh
    };
  }, []);

  const getActiveLayer = useCallback((): PS.PsLayer | null => {
    return layersRef.current.find((l) => l.id === activeIdRef.current) ?? layersRef.current[0] ?? null;
  }, []);

  const brushOptsOf = useCallback((mode: 'brush' | 'eraser'): PS.BrushOpts => {
    const ui = uiRef.current;
    const conf = mode === 'brush' ? ui.brush : ui.eraser;
    return {
      size: conf.size,
      hardness: conf.hardness,
      alpha: conf.opacity / 100,
      // 蒙版编辑时：画笔用白色（显示），橡皮擦仍为擦除（隐藏）
      color: mode === 'brush' ? (ui.maskEditing ? '#ffffff' : ui.fg) : '#000000',
      erase: mode === 'eraser'
    };
  }, []);

  /** 当前画笔 / 橡皮擦的落笔目标：蒙版编辑模式且存在蒙版时写蒙版，否则写图层内容 */
  const getPaintTarget = useCallback((): HTMLCanvasElement | null => {
    const layer = getActiveLayer();
    if (!layer) return null;
    if (uiRef.current.maskEditing && layer.mask) return layer.mask;
    return layer.canvas;
  }, [getActiveLayer]);

  /** 马赛克笔刷：涂一段笔迹（落笔状态从 mosaicRef 取，源图固定在落笔那一刻） */
  const mosaicStrokeTo = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const stroke = mosaicRef.current;
      const target = getPaintTarget();
      if (!stroke || !target) return;
      const ui = uiRef.current;
      PS.mosaicStrokeSegment(
        stroke,
        target,
        from,
        to,
        ui.mosaic.brush,
        ui.selection,
        docRef.current.width,
        docRef.current.height
      );
    },
    [getPaintTarget]
  );

  const selectTool = useCallback((t: ToolId) => {
    setTool(t);
    setCropNorm({ x: 0, y: 0, w: 1, h: 1 });
    setTransform(null);
    setTransformBounds(null);
  }, []);

  /** 若设置了羽化半径，则对新建选区自动羽化 */
  const applyFeather = useCallback((sel: PS.Selection | null): PS.Selection | null => {
    const f = uiRef.current.feather;
    if (!sel || f <= 0) return sel;
    return PS.featherSelection(sel, docRef.current.width, docRef.current.height, f);
  }, []);

  const featherCurrent = useCallback(() => {
    const sel = uiRef.current.selection;
    if (!sel) {
      toast('请先建立选区');
      return;
    }
    if (uiRef.current.feather <= 0) {
      toast('请先设置羽化半径');
      return;
    }
    setSelection(PS.featherSelection(sel, docRef.current.width, docRef.current.height, uiRef.current.feather));
  }, []);

  /* ---------- 自由变换 ---------- */
  const beginTransform = useCallback(() => {
    if (!getActiveLayer()) return;
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    const ids = selectedIdsRef.current.length ? selectedIdsRef.current : [activeIdRef.current];
    setSelection(null);
    setTransformBounds(selectionBounds(layersRef.current, ids, dw, dh));
    setTransform({ ...PS.IDENTITY_TRANSFORM });
  }, [getActiveLayer]);

  const commitTransform = useCallback(() => {
    const t = uiRef.current.transform;
    if (!t) return;
    const ids = selectedIdsRef.current.length ? selectedIdsRef.current : [activeIdRef.current];
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    const bounds = uiRef.current.transformBounds ?? docBounds(dw, dh);
    const next = layersRef.current.map((l) =>
      ids.includes(l.id)
        ? {
            ...l,
            canvas: PS.bakeFreeTransform(l.canvas, t, bounds, dw, dh),
            // 蒙版必须与内容同步变换，否则内容会移出蒙版范围
            mask: l.mask ? PS.bakeFreeTransform(l.mask, t, bounds, dw, dh) : null
          }
        : l
    );
    layersRef.current = next;
    setLayers(next);
    setTransform(null);
    setTransformBounds(null);
    afterEdit(ids.length > 1 ? '自由变换多个图层' : '自由变换');
  }, [afterEdit]);

  const cancelTransform = useCallback(() => {
    setTransform(null);
    setTransformBounds(null);
  }, []);

  const startTransformDrag = useCallback(
    (pt: { x: number; y: number }) => {
      const t = uiRef.current.transform;
      if (!t) return;
      const bounds =
        uiRef.current.transformBounds ?? docBounds(docRef.current.width, docRef.current.height);
      const zoom = Math.max(0.02, uiRef.current.zoom);
      const c = transformCorners(t, bounds);
      const n = midpoint(c.nw, c.ne);
      const e = midpoint(c.ne, c.se);
      const s = midpoint(c.se, c.sw);
      const w = midpoint(c.sw, c.nw);
      const handles: Record<HandleId, { x: number; y: number }> = {
        nw: c.nw, n, ne: c.ne, e, se: c.se, s, sw: c.sw, w
      };
      const hitR = 12 / zoom;
      const cx = (c.nw.x + c.se.x) / 2;
      const cy = (c.nw.y + c.se.y) / 2;
      let dirx = n.x - cx;
      let diry = n.y - cy;
      const len = Math.hypot(dirx, diry) || 1;
      dirx /= len;
      diry /= len;
      const off = 26 / zoom;
      const rh = { x: n.x + dirx * off, y: n.y + diry * off };
      if (Math.hypot(pt.x - rh.x, pt.y - rh.y) < hitR) {
        transformDragRef.current = { kind: 'rotate', start: pt, orig: t };
        return;
      }
      for (const id of Object.keys(handles) as HandleId[]) {
        if (Math.hypot(pt.x - handles[id].x, pt.y - handles[id].y) < hitR) {
          transformDragRef.current = { kind: 'scale', handle: id, start: pt, orig: t };
          return;
        }
      }
      if (insideTransformBox(pt, t, bounds)) {
        transformDragRef.current = { kind: 'move', start: pt, orig: t };
      } else {
        cancelTransform();
      }
    },
    [cancelTransform]
  );

  const handleTransformMove = useCallback((pt: { x: number; y: number }, e: PointerEvent) => {
    const d = transformDragRef.current;
    if (!d) return;
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    const bounds = uiRef.current.transformBounds ?? docBounds(dw, dh);
    const bcx = bounds.x + bounds.w / 2;
    const bcy = bounds.y + bounds.h / 2;
    const hw = Math.max(0.5, bounds.w / 2);
    const hh = Math.max(0.5, bounds.h / 2);
    const orig = d.orig;
    const dx = pt.x - d.start.x;
    const dy = pt.y - d.start.y;
    if (d.kind === 'move') {
      setTransform({ ...orig, tx: orig.tx + dx, ty: orig.ty + dy });
    } else if (d.kind === 'rotate') {
      const cx = bcx + orig.tx;
      const cy = bcy + orig.ty;
      const startAngle = Math.atan2(d.start.y - cy, d.start.x - cx);
      const curAngle = Math.atan2(pt.y - cy, pt.x - cx);
      let angle = orig.angle + ((curAngle - startAngle) * 180) / Math.PI;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      setTransform({ ...orig, angle });
    } else {
      const cx = bcx + orig.tx;
      const cy = bcy + orig.ty;
      const rad = (-orig.angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ox = pt.x - cx;
      const oy = pt.y - cy;
      const mx = ox * cos - oy * sin;
      const my = ox * sin + oy * cos;
      const signX = d.handle.includes('e') ? 1 : d.handle.includes('w') ? -1 : 0;
      const signY = d.handle.includes('s') ? 1 : d.handle.includes('n') ? -1 : 0;
      let sx = orig.sx;
      let sy = orig.sy;
      const min = 0.05;
      const max = 8;
      if (signX !== 0) sx = clamp(mx / signX / hw, min, max);
      if (signY !== 0) sy = clamp(my / signY / hh, min, max);
      if (signX !== 0 && signY !== 0 && e.shiftKey) {
        const k = Math.max(sx, sy);
        sx = k;
        sy = k;
      }
      setTransform({ ...orig, sx, sy });
    }
  }, []);

  /* ---------- 指针交互 ---------- */
  const handleWindowMove = useCallback(
    (e: PointerEvent) => {
      const pt = toDoc(e.clientX, e.clientY);
      cursorRef.current = pt;
      if (cursorLabelRef.current) {
        cursorLabelRef.current.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
      }
      if (transformDragRef.current) {
        handleTransformMove(pt, e);
        return;
      }
      if (lassoRef.current) {
        const pts = lassoRef.current.points;
        const last = pts[pts.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) > 3) pts.push(pt);
        paintOverlay();
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const ui = uiRef.current;
      const dw = docRef.current.width;
      const dh = docRef.current.height;
      switch (drag.kind) {
        case 'stroke': {
          if (drag.mode === 'mosaic') {
            mosaicStrokeTo(drag.last, pt);
            drag.last = pt;
            paint();
            break;
          }
          const target = getPaintTarget();
          if (!target) return;
          const opts = brushOptsOf(drag.mode);
          if (drag.mode === 'brush' && strokeRef.current) {
            PS.stampSegment(PS.ctxOf(strokeRef.current.canvas), drag.last, pt, opts);
          } else {
            PS.runClipped(target, ui.selection, dw, dh, (c) =>
              PS.stampSegment(c, drag.last, pt, opts)
            );
          }
          drag.last = pt;
          paint();
          break;
        }
        case 'marquee':
          drag.end = pt;
          paintOverlay();
          break;
        case 'move':
          drag.dx = pt.x - drag.start.x;
          drag.dy = pt.y - drag.start.y;
          paint();
          break;
        case 'shape':
          drag.end = pt;
          drag.shift = e.shiftKey;
          paintOverlay();
          break;
        case 'gradient':
          drag.end = pt;
          paintOverlay();
          break;
      }
    },
    [toDoc, getPaintTarget, brushOptsOf, mosaicStrokeTo, paint, paintOverlay, handleTransformMove]
  );

  const handleWindowUp = useCallback(() => {
    if (transformDragRef.current) {
      transformDragRef.current = null;
      return;
    }
    if (lassoRef.current) {
      const points = lassoRef.current.points;
      lassoRef.current = null;
      if (points.length >= 3) {
        setSelection(applyFeather(PS.selectionFromLasso(points, docRef.current.width, docRef.current.height)));
      }
      paintOverlay();
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    moveBoundsRef.current = null;
    if (!drag) return;
    const ui = uiRef.current;
    const dw = docRef.current.width;
    const dh = docRef.current.height;
    const layer = getActiveLayer();
    if (!layer) return;
    switch (drag.kind) {
      case 'stroke': {
        if (drag.mode === 'brush' && strokeRef.current) {
          const target = getPaintTarget();
          if (target) {
            const opts = brushOptsOf('brush');
            const buffer = strokeRef.current.canvas;
            PS.runClipped(target, ui.selection, dw, dh, (c) => {
              c.globalAlpha = opts.alpha;
              c.globalCompositeOperation = 'source-over';
              c.drawImage(buffer, 0, 0);
            });
          }
        }
        strokeRef.current = null;
        mosaicRef.current = null;
        afterEdit(drag.mode === 'brush' ? '画笔' : drag.mode === 'eraser' ? '橡皮擦' : '马赛克');
        break;
      }
      case 'marquee': {
        setSelection(applyFeather(PS.buildSelection(drag.shape, drag.start, drag.end, dw, dh)));
        paint();
        paintOverlay();
        break;
      }
      case 'move': {
        const dx = Math.round(drag.dx);
        const dy = Math.round(drag.dy);
        if (dx !== 0 || dy !== 0) {
          const ids = selectedIdsRef.current.length ? selectedIdsRef.current : [layer.id];
          const next = layersRef.current.map((l) =>
            ids.includes(l.id)
              ? {
                  ...l,
                  canvas: PS.translateCanvas(l.canvas, dx, dy),
                  // 蒙版随内容一起平移，保持对齐
                  mask: l.mask ? PS.translateCanvas(l.mask, dx, dy) : null
                }
              : l
          );
          layersRef.current = next;
          setLayers(next);
          afterEdit(ids.length > 1 ? '移动多个图层' : '移动图层');
        } else {
          paint();
        }
        break;
      }
      case 'shape': {
        PS.drawShape(
          layer.canvas,
          drag.start,
          drag.end,
          { kind: ui.shape.kind, color: ui.fg, lineWidth: ui.shape.lineWidth, fill: ui.shape.fill, constrain: drag.shift },
          ui.selection,
          dw,
          dh
        );
        afterEdit('形状');
        break;
      }
      case 'gradient': {
        const colorB = ui.gradient.toBg ? ui.bg : PS.withAlpha(ui.fg, 0);
        PS.drawGradient(layer.canvas, drag.start, drag.end, ui.gradient.kind, ui.fg, colorB, ui.selection, dw, dh);
        afterEdit('渐变');
        break;
      }
    }
  }, [toDoc, getActiveLayer, getPaintTarget, brushOptsOf, applyFeather, afterEdit, paint, paintOverlay]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const pt = toDoc(e.clientX, e.clientY);
      const ui = uiRef.current;
      cursorRef.current = pt;

      if (ui.transform) {
        startTransformDrag(pt);
        const onMove = (ev: PointerEvent) => handleWindowMove(ev);
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          handleWindowUp();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return;
      }

      if (ui.tool === 'text') {
        setTextEdit({ x: pt.x, y: pt.y, value: '' });
        return;
      }
      if (ui.tool === 'crop') return;
      if (ui.tool === 'eyedropper') {
        const flat = PS.flattenTo(layersRef.current, docRef.current.width, docRef.current.height);
        const hex = PS.samplePixel(flat, pt.x, pt.y);
        if (hex) {
          setFg(hex);
          toast(`已拾取 ${hex}`);
        } else {
          toast('该处为透明像素');
        }
        return;
      }
      if (ui.tool === 'bucket') {
        const layer = getActiveLayer();
        if (!layer) return;
        if (!layer.visible) {
          toast.error('当前图层不可见，无法填充');
          return;
        }
        const ok = PS.floodFill(layer.canvas, pt.x, pt.y, ui.fg, ui.tolerance, ui.selection, docRef.current.width, docRef.current.height);
        if (ok) afterEdit('油漆桶');
        return;
      }
      if (ui.tool === 'magic-wand') {
        const flat = PS.flattenTo(layersRef.current, docRef.current.width, docRef.current.height);
        const sel = PS.selectionFromMagicWand(flat, pt.x, pt.y, ui.tolerance);
        if (sel) setSelection(applyFeather(sel));
        else toast('该处未选中任何区域');
        return;
      }
      if (ui.tool === 'lasso') {
        lassoRef.current = { points: [pt] };
        const onMove = (ev: PointerEvent) => handleWindowMove(ev);
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          handleWindowUp();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return;
      }

      const layer = getActiveLayer();
      if (!layer) return;
      if (!layer.visible) {
        toast.error('当前图层不可见，无法操作');
        return;
      }

      switch (ui.tool) {
        case 'brush': {
          const opts = brushOptsOf('brush');
          const canvas = PS.canvasOf(docRef.current.width, docRef.current.height);
          strokeRef.current = { canvas, alpha: opts.alpha };
          PS.stampDot(PS.ctxOf(canvas), pt.x, pt.y, opts);
          dragRef.current = { kind: 'stroke', mode: 'brush', last: pt };
          paint();
          break;
        }
        case 'eraser': {
          const target = getPaintTarget();
          if (target) {
            PS.runClipped(target, ui.selection, docRef.current.width, docRef.current.height, (c) =>
              PS.stampDot(c, pt.x, pt.y, brushOptsOf('eraser'))
            );
          }
          dragRef.current = { kind: 'stroke', mode: 'eraser', last: pt };
          paint();
          break;
        }
        case 'mosaic': {
          const target = getPaintTarget();
          if (!target) return;
          mosaicRef.current = PS.beginMosaicStroke(
            target,
            ui.mosaic.size,
            docRef.current.width,
            docRef.current.height
          );
          // 落笔即涂一个点，单击也能留下一块马赛克
          mosaicStrokeTo(pt, pt);
          dragRef.current = { kind: 'stroke', mode: 'mosaic', last: pt };
          paint();
          break;
        }
        case 'marquee-rect':
        case 'marquee-ellipse': {
          dragRef.current = {
            kind: 'marquee',
            shape: ui.tool === 'marquee-rect' ? 'rect' : 'ellipse',
            start: pt,
            end: pt
          };
          paintOverlay();
          break;
        }
        case 'move': {
          const moveIds = selectedIdsRef.current.length ? selectedIdsRef.current : [layer.id];
          moveBoundsRef.current = PS.unionContentBounds(
            layersRef.current.filter((l) => moveIds.includes(l.id)).map((l) => PS.applyLayerMask(l))
          );
          dragRef.current = { kind: 'move', start: pt, dx: 0, dy: 0 };
          break;
        }
        case 'shape':
          dragRef.current = { kind: 'shape', start: pt, end: pt, shift: e.shiftKey };
          paintOverlay();
          break;
        case 'gradient':
          dragRef.current = { kind: 'gradient', start: pt, end: pt };
          paintOverlay();
          break;
        default:
          return;
      }

      const onMove = (ev: PointerEvent) => handleWindowMove(ev);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        handleWindowUp();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [toDoc, getActiveLayer, getPaintTarget, brushOptsOf, mosaicStrokeTo, applyFeather, paint, paintOverlay, afterEdit, handleWindowMove, handleWindowUp, startTransformDrag]
  );

  const handleHover = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const pt = toDoc(e.clientX, e.clientY);
      cursorRef.current = pt;
      if (cursorLabelRef.current) {
        cursorLabelRef.current.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
      }
      const ui = uiRef.current;
      if (ui.tool === 'brush' || ui.tool === 'eraser' || ui.selection || dragRef.current) paintOverlay();
    },
    [toDoc, paintOverlay]
  );

  const handleLeave = useCallback(() => {
    cursorRef.current = null;
    if (cursorLabelRef.current) cursorLabelRef.current.textContent = '—';
    paintOverlay();
  }, [paintOverlay]);

  /* ---------- 图层操作 ---------- */
  const addLayer = useCallback(
    (name: string, source?: HTMLCanvasElement | null) => {
      const { width, height } = docRef.current;
      const layer = PS.makeLayer(name, width, height, source);
      const next = [layer, ...layersRef.current];
      layersRef.current = next;
      setLayers(next);
      activeIdRef.current = layer.id;
      setActiveId(layer.id);
      selectedIdsRef.current = [layer.id];
      setSelectedIds([layer.id]);
      commit('新建图层');
    },
    [commit]
  );

  /* ---------- AI 抠图：调本地抠图服务去背景，结果作为新图层 ---------- */

  /**
   * 对「整张文档（拼合图）」「当前图层」或「选区内的内容」调 AI 抠图。
   *
   * 选区模式：按选区的包围盒**外扩一圈余量**后原样裁切送抠，结果按同一原点贴回。
   * 选区因此是「告诉模型去哪找主体」，而不是把结果硬裁成选区的形状。
   *
   * 两个都实测过的坑，改这里之前先看一遍：
   *
   * 1. **不要**用蒙版把选区外擦成透明或填成纯色。那条人为的硬边界是全图最强的轮廓，
   *    显著性模型会直接把它当成物体边缘，于是抠出来的形状恰好等于选区形状、还糊一圈灰雾。
   *    实测（同图同选区，统计选区内背景的平均 alpha）：选区外透明 58.9、填纯色 58.9、原样裁切 1.1。
   * 2. **必须**向外留余量。这个引擎只认「画面里有完整物体」，只喂选区那一小块碎片
   *    （比如只框住耳机耳罩 + 一点头发）它会判定「没有前景」而返回**全空**，
   *    表现就是选中的那块变成透明。实测外扩 0% / 30% 全空（1.1 / 2.3），
   *    外扩 60% 起恢复正常（168.4）。
   *
   * 图片会上传到本地抠图服务 `servers/cutout-api`（服务端 ONNX 推理），
   * 不会发往任何第三方；原图层全部保留，结果作为新的透明背景图层插入。
   */
  const runAiCutout = useCallback(
    async (source: 'document' | 'layer' | 'selection') => {
      if (cutoutBusy) return;
      const { width, height } = docRef.current;
      if (!width || !height) return;

      let input: HTMLCanvasElement;
      /** 选区模式：结果需要贴回的文档坐标原点 */
      let pasteAt: { x: number; y: number } | null = null;
      let name = 'AI 抠图';

      if (source === 'selection') {
        const sel = uiRef.current.selection;
        if (!sel) {
          toast('请先用选框 / 套索 / 魔棒圈出要抠的区域');
          return;
        }
        const mask = PS.selectionToMask(sel, width, height);
        const box = PS.contentBounds(mask);
        if (!box) {
          toast('选区是空的，换个位置再试');
          return;
        }
        if (box.w < 8 || box.h < 8) {
          toast('选区太小了，框大一点再试');
          return;
        }
        // 外扩一圈余量后原样裁切（不擦透明、不填色）：
        // 既避免造出那条被模型误判的假边界，又保证画面里能出现「完整物体」
        const pad = Math.max(48, Math.round(Math.max(box.w, box.h) * 0.5));
        const cropX = Math.max(0, box.x - pad);
        const cropY = Math.max(0, box.y - pad);
        const cropW = Math.min(width, box.x + box.w + pad) - cropX;
        const cropH = Math.min(height, box.y + box.h + pad) - cropY;
        const crop = PS.canvasOf(cropW, cropH);
        PS.ctxOf(crop).drawImage(
          PS.flattenTo(layersRef.current, width, height),
          cropX,
          cropY,
          cropW,
          cropH,
          0,
          0,
          cropW,
          cropH
        );
        input = crop;
        pasteAt = { x: cropX, y: cropY };
        name = 'AI 选区抠图';
      } else if (source === 'layer') {
        const layer = layersRef.current.find((l) => l.id === activeIdRef.current);
        if (!layer) {
          toast('当前没有可用图层');
          return;
        }
        input = PS.applyLayerMask(layer);
        name = `${layer.name} 抠图`;
      } else {
        input = PS.flattenTo(layersRef.current, width, height);
      }

      setCutoutBusy(true);
      const toastId = toast.loading('正在抠图（首次调用需加载模型，可能要十几秒）…');
      try {
        const png = await canvasToPngBlob(input);
        const { blob, elapsedMs } = await requestAiCutout(png);
        const cut = await blobToCanvas(blob);

        // 引擎找不到「完整物体」时会安静地返回全透明；这时别默默加一个空图层，
        // 直接说明原因，否则用户只会看到「选中的那块变成了透明」
        if (source === 'selection' && alphaCoverage(cut) < 0.001) {
          toast.error('这块选区里没找到完整的主体，把选区框大一点再试', { id: toastId });
          return;
        }

        // 选区模式把结果按原坐标贴回文档尺寸的画布，其余模式直接就是整幅结果
        let out = cut;
        if (pasteAt) {
          out = PS.canvasOf(width, height);
          PS.ctxOf(out).drawImage(cut, pasteAt.x, pasteAt.y);
        }
        addLayer(name, out);
        toast.success(elapsedMs ? `抠图完成（服务端 ${elapsedMs} ms）` : '抠图完成', { id: toastId });
      } catch (error) {
        // 完整错误留给控制台，容易被截断的 message 只用于提示
        console.error('[photoshop] AI 抠图失败', error);
        toast.error(`AI 抠图失败：${error instanceof Error ? error.message : String(error)}`, {
          id: toastId
        });
      } finally {
        setCutoutBusy(false);
      }
    },
    [cutoutBusy, addLayer]
  );

  const duplicateLayer = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    const copy = PS.cloneLayer(layer);
    copy.id = PS.uid();
    copy.name = `${layer.name} 副本`;
    const idx = layersRef.current.findIndex((l) => l.id === layer.id);
    const next = [...layersRef.current];
    next.splice(idx, 0, copy);
    layersRef.current = next;
    setLayers(next);
    activeIdRef.current = copy.id;
    setActiveId(copy.id);
    selectedIdsRef.current = [copy.id];
    setSelectedIds([copy.id]);
    commit('复制图层');
  }, [getActiveLayer, commit]);

  const removeLayer = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (layersRef.current.length <= ids.length) {
      toast.error('至少保留一个图层');
      return;
    }
    const next = layersRef.current.filter((l) => !ids.includes(l.id));
    const newActive = next[0];
    layersRef.current = next;
    setLayers(next);
    activeIdRef.current = newActive.id;
    setActiveId(newActive.id);
    selectedIdsRef.current = [newActive.id];
    setSelectedIds([newActive.id]);
    commit(ids.length > 1 ? '删除多个图层' : '删除图层');
  }, [commit]);

  const moveLayer = useCallback(
    (dir: -1 | 1) => {
      const idx = layersRef.current.findIndex((l) => l.id === activeIdRef.current);
      if (idx < 0) return;
      const target = idx + dir;
      if (target < 0 || target >= layersRef.current.length) return;
      const next = [...layersRef.current];
      [next[idx], next[target]] = [next[target], next[idx]];
      layersRef.current = next;
      setLayers(next);
      commit(dir === -1 ? '上移图层' : '下移图层');
    },
    [commit]
  );

  const mergeDownLayer = useCallback(() => {
    const idx = layersRef.current.findIndex((l) => l.id === activeIdRef.current);
    if (idx < 0 || idx >= layersRef.current.length - 1) {
      toast('已在最底层，无法向下合并');
      return;
    }
    const next = PS.mergeDown(layersRef.current, idx);
    const newActive = next[Math.min(idx, next.length - 1)].id;
    layersRef.current = next;
    setLayers(next);
    activeIdRef.current = newActive;
    setActiveId(newActive);
    selectedIdsRef.current = [newActive];
    setSelectedIds([newActive]);
    commit('合并图层');
  }, [commit]);

  const flattenAll = useCallback(() => {
    const { width, height } = docRef.current;
    const flat = PS.flattenTo(layersRef.current, width, height);
    const layer = PS.makeLayer('背景', width, height, flat);
    layersRef.current = [layer];
    setLayers([layer]);
    activeIdRef.current = layer.id;
    setActiveId(layer.id);
    selectedIdsRef.current = [layer.id];
    setSelectedIds([layer.id]);
    commit('合并可见图层');
  }, [commit]);

  const updateLayer = useCallback((id: string, patch: Partial<PS.PsLayer>) => {
    const next = layersRef.current.map((l) => (l.id === id ? { ...l, ...patch } : l));
    layersRef.current = next;
    setLayers(next);
  }, []);

  const addMask = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    updateLayer(layer.id, { mask: PS.makeLayerMask(docRef.current.width, docRef.current.height), maskEnabled: true });
    setMaskEditing(true);
    commit('添加图层蒙版');
  }, [getActiveLayer, updateLayer, commit]);

  const removeMask = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    updateLayer(layer.id, { mask: null, maskEnabled: true });
    setMaskEditing(false);
    commit('删除图层蒙版');
  }, [getActiveLayer, updateLayer, commit]);

  const toggleMaskEditing = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer?.mask) {
      toast('请先添加图层蒙版');
      return;
    }
    setMaskEditing((v) => !v);
  }, [getActiveLayer]);

  const toggleMaskEnabled = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer?.mask) return;
    updateLayer(layer.id, { maskEnabled: !layer.maskEnabled });
  }, [getActiveLayer, updateLayer]);

  const toggleVisible = useCallback((id: string) => {
    const ids = selectedIdsRef.current.includes(id) ? selectedIdsRef.current : [id];
    const target = layersRef.current.find((l) => l.id === id);
    if (!target) return;
    const nextVisible = !target.visible;
    const next = layersRef.current.map((l) =>
      ids.includes(l.id) ? { ...l, visible: nextVisible } : l
    );
    layersRef.current = next;
    setLayers(next);
  }, []);

  const renameLayer = useCallback(
    (id: string, name: string) => {
      updateLayer(id, { name: name.trim() || '图层' });
      setRenamingId(null);
    },
    [updateLayer]
  );

  /** 单选：同时作为「主活动图层」，多选用于分组操作 */
  const focusLayer = useCallback((id: string) => {
    activeIdRef.current = id;
    setActiveId(id);
    selectedIdsRef.current = [id];
    setSelectedIds([id]);
  }, []);

  const selectLayer = useCallback(
    (id: string, e?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
      const list = layersRef.current;
      const idx = list.findIndex((l) => l.id === id);
      if (idx < 0) return;
      const prevActive = activeIdRef.current;
      activeIdRef.current = id;
      setActiveId(id);
      if (e?.shiftKey) {
        const anchorIdx = list.findIndex((l) => l.id === prevActive);
        const [from, to] = anchorIdx < idx ? [anchorIdx, idx] : [idx, anchorIdx];
        const range = list.slice(from, to + 1).map((l) => l.id);
        selectedIdsRef.current = range;
        setSelectedIds(range);
      } else if (e?.ctrlKey || e?.metaKey) {
        const cur = selectedIdsRef.current;
        const next = cur.includes(id)
          ? cur.length === 1
            ? cur
            : cur.filter((x) => x !== id)
          : [...cur, id];
        selectedIdsRef.current = next;
        setSelectedIds(next);
      } else {
        selectedIdsRef.current = [id];
        setSelectedIds([id]);
      }
    },
    []
  );

  /** 合并所有选中图层为一张（顶层选中项保留位置与名称） */
  const mergeSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length < 2) {
      toast('请按住 Ctrl / Shift 选中至少两个图层');
      return;
    }
    const list = layersRef.current;
    const selected = list.filter((l) => ids.includes(l.id));
    if (selected.length < 2) return;
    const top = selected[0];
    const { width, height } = docRef.current;
    const merged = PS.canvasOf(width, height);
    const mctx = PS.ctxOf(merged);
    for (const l of [...selected].reverse()) {
      if (!l.visible) continue;
      mctx.globalAlpha = l.opacity;
      mctx.globalCompositeOperation = PS.blendOf(l.blend);
      mctx.drawImage(PS.applyLayerMask(l), 0, 0);
    }
    const newLayer: PS.PsLayer = {
      ...top,
      canvas: merged,
      mask: null,
      name: `${top.name} 合并`,
      visible: true,
      opacity: 1,
      blend: 'normal'
    };
    let replaced = false;
    const next: PS.PsLayer[] = [];
    for (const l of list) {
      if (ids.includes(l.id)) {
        if (!replaced) {
          next.push(newLayer);
          replaced = true;
        }
      } else {
        next.push(l);
      }
    }
    layersRef.current = next;
    setLayers(next);
    activeIdRef.current = newLayer.id;
    setActiveId(newLayer.id);
    selectedIdsRef.current = [newLayer.id];
    setSelectedIds([newLayer.id]);
    commit('合并图层');
  }, [commit]);

  /* ---------- 变换 ---------- */
  const layerFlip = useCallback(
    (axis: 'h' | 'v') => {
      const layer = getActiveLayer();
      if (!layer) return;
      PS.copyInto(layer.canvas, PS.flipCanvas(layer.canvas, axis));
      afterEdit(axis === 'h' ? '水平翻转图层' : '垂直翻转图层');
    },
    [getActiveLayer, afterEdit]
  );

  const layerRotate = useCallback(
    (dir: 'cw' | 'ccw') => {
      const layer = getActiveLayer();
      if (!layer) return;
      PS.copyInto(layer.canvas, PS.rotateLayer90(layer.canvas, dir));
      afterEdit(dir === 'cw' ? '图层旋转 90°' : '图层旋转 -90°');
    },
    [getActiveLayer, afterEdit]
  );

  const imageFlip = useCallback(
    (axis: 'h' | 'v') => {
      const next = layersRef.current.map((l) => ({ ...l, canvas: PS.flipCanvas(l.canvas, axis) }));
      layersRef.current = next;
      setLayers(next);
      commit(axis === 'h' ? '水平翻转图像' : '垂直翻转图像');
    },
    [commit]
  );

  const imageRotate = useCallback(
    (dir: 'cw' | 'ccw') => {
      const { width, height } = docRef.current;
      const result = PS.rotateDocument(layersRef.current, width, height, dir);
      layersRef.current = result.layers;
      docRef.current = { width: result.width, height: result.height };
      setLayers(result.layers);
      setDoc({ width: result.width, height: result.height });
      setSelection(null);
      commit(dir === 'cw' ? '旋转图像 90°' : '旋转图像 -90°');
    },
    [commit]
  );

  /* ---------- 图像 / 画布大小 ---------- */
  const openResize = useCallback(() => {
    setResizeW(docRef.current.width);
    setResizeH(docRef.current.height);
    setResizeKeep(true);
    setResizeOpen(true);
  }, []);

  const applyResize = useCallback(() => {
    const w = clamp(Math.round(resizeW) || 1, 1, 8000);
    const h = clamp(Math.round(resizeH) || 1, 1, 8000);
    if (w === docRef.current.width && h === docRef.current.height) {
      setResizeOpen(false);
      return;
    }
    const result = PS.resizeDocument(layersRef.current, w, h);
    layersRef.current = result.layers;
    docRef.current = { width: result.width, height: result.height };
    setLayers(result.layers);
    setDoc({ width: result.width, height: result.height });
    setSelection(null);
    setResizeOpen(false);
    commit('图像大小');
  }, [resizeW, resizeH, commit]);

  const openCanvasSize = useCallback(() => {
    setCanvasW(docRef.current.width);
    setCanvasH(docRef.current.height);
    setAnchorX(0.5);
    setAnchorY(0.5);
    setCanvasSizeOpen(true);
  }, []);

  const applyCanvasSize = useCallback(() => {
    const w = clamp(Math.round(canvasW) || 1, 1, 8000);
    const h = clamp(Math.round(canvasH) || 1, 1, 8000);
    const result = PS.canvasSizeDocument(
      layersRef.current,
      docRef.current.width,
      docRef.current.height,
      w,
      h,
      anchorX,
      anchorY
    );
    layersRef.current = result.layers;
    docRef.current = { width: result.width, height: result.height };
    setLayers(result.layers);
    setDoc({ width: result.width, height: result.height });
    setSelection(null);
    setCanvasSizeOpen(false);
    commit('画布大小');
  }, [canvasW, canvasH, anchorX, anchorY, commit]);

  /* ---------- 裁剪 ---------- */
  const applyCrop = useCallback(() => {
    const { width, height } = docRef.current;
    const rect = {
      x: Math.round(cropNorm.x * width),
      y: Math.round(cropNorm.y * height),
      w: Math.round(cropNorm.w * width),
      h: Math.round(cropNorm.h * height)
    };
    if (rect.w < 1 || rect.h < 1 || (rect.x === 0 && rect.y === 0 && rect.w === width && rect.h === height)) {
      toast('请先拖出裁剪区域');
      return;
    }
    const result = PS.cropDocument(layersRef.current, PS.clampRect(rect, width, height));
    layersRef.current = result.layers;
    docRef.current = { width: result.width, height: result.height };
    setLayers(result.layers);
    setDoc({ width: result.width, height: result.height });
    setSelection(null);
    setCropNorm({ x: 0, y: 0, w: 1, h: 1 });
    commit('裁剪');
  }, [cropNorm, commit]);

  /* ---------- 选区操作 ---------- */
  const selectAll = useCallback(() => {
    setSelection(PS.selectAllSelection(docRef.current.width, docRef.current.height));
  }, []);

  const deselect = useCallback(() => setSelection(null), []);

  const invertSel = useCallback(() => {
    const sel = uiRef.current.selection;
    if (!sel) {
      selectAll();
      return;
    }
    setSelection(PS.invertSelection(sel, docRef.current.width, docRef.current.height));
  }, [selectAll]);

  const deleteSelectionArea = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    const sel = uiRef.current.selection;
    if (!sel) {
      toast('请先用选框工具建立选区');
      return;
    }
    PS.clearSelection(layer.canvas, sel, docRef.current.width, docRef.current.height);
    afterEdit('删除选区内容');
  }, [getActiveLayer, afterEdit]);

  const fillSelectionColor = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    const sel = uiRef.current.selection;
    PS.fillSelection(layer.canvas, sel, uiRef.current.fg, docRef.current.width, docRef.current.height);
    afterEdit(sel ? '填充选区' : '填充图层');
  }, [getActiveLayer, afterEdit]);

  /* ---------- 调整 ---------- */
  const applyAdjust = useCallback(() => {
    const layer = getActiveLayer();
    const ui = uiRef.current;
    if (!layer || !ui.adjust) return;
    if (!PS.isNeutralAdjust(ui.adjust)) {
      PS.filterInPlace(layer.canvas, PS.adjustCss(ui.adjust), ui.selection, docRef.current.width, docRef.current.height);
      setAdjust(null);
      afterEdit('调整');
    } else {
      setAdjust(null);
    }
  }, [getActiveLayer, afterEdit]);

  const quickFilter = useCallback(
    (css: string, label: string) => {
      const layer = getActiveLayer();
      if (!layer) return;
      PS.filterInPlace(layer.canvas, css, uiRef.current.selection, docRef.current.width, docRef.current.height);
      afterEdit(label);
    },
    [getActiveLayer, afterEdit]
  );

  const quickSharpen = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    PS.sharpenInPlace(layer.canvas, 0.8, uiRef.current.selection, docRef.current.width, docRef.current.height);
    afterEdit('锐化');
  }, [getActiveLayer, afterEdit]);

  /** 一键马赛克：把当前图层整幅像素化（格子大小跟随工具栏，受选区限制） */
  const applyMosaic = useCallback(() => {
    const layer = getActiveLayer();
    if (!layer) return;
    const ui = uiRef.current;
    PS.pixelateInPlace(
      layer.canvas,
      ui.mosaic.size,
      ui.selection,
      docRef.current.width,
      docRef.current.height
    );
    afterEdit('马赛克');
  }, [getActiveLayer, afterEdit]);

  /* ---------- 文字 ---------- */
  const commitText = useCallback(() => {
    const layer = getActiveLayer();
    const ui = uiRef.current;
    if (!layer || !textEdit || !textEdit.value.trim()) {
      setTextEdit(null);
      return;
    }
    PS.drawText(
      layer.canvas,
      textEdit.value,
      textEdit.x,
      textEdit.y,
      ui.textOpts,
      ui.selection,
      docRef.current.width,
      docRef.current.height
    );
    setTextEdit(null);
    afterEdit('文字');
  }, [getActiveLayer, textEdit, afterEdit]);

  /* ---------- 文件 ---------- */
  const openImage = useCallback(
    async (file: File, mode: 'doc' | 'layer') => {
      try {
        const img = await loadImageFromFile(file);
        const imgW = img.naturalWidth || img.width;
        const imgH = img.naturalHeight || img.height;
        if (mode === 'doc') {
          const canvas = PS.canvasOf(imgW, imgH);
          PS.ctxOf(canvas).drawImage(img, 0, 0);
          const bgLayer = PS.makeLayer('背景', imgW, imgH, canvas);
          const name = file.name.replace(/\.[^.]+$/, '') || '图片';
          const fresh: DocTab = {
            id: PS.uid(),
            name,
            width: imgW,
            height: imgH,
            layers: [bgLayer],
            activeLayerId: bgLayer.id,
            selectedIds: [bgLayer.id],
            history: [
              { label: '打开图片', width: imgW, height: imgH, activeId: bgLayer.id, layers: [PS.cloneLayer(bgLayer)] }
            ],
            historyIndex: 0,
            zoom: 1,
            selection: null,
            adjust: null,
            cropNorm: { x: 0, y: 0, w: 1, h: 1 }
          };
          openNewTab(fresh);
          requestAnimationFrame(() => fitView());
        } else {
          const { width, height } = docRef.current;
          const scale = Math.min(1, (width * 0.9) / imgW, (height * 0.9) / imgH);
          const w = Math.max(1, Math.round(imgW * scale));
          const h = Math.max(1, Math.round(imgH * scale));
          const canvas = PS.canvasOf(width, height);
          const ctx = PS.ctxOf(canvas);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
          const name = file.name.replace(/\.[^.]+$/, '') || '图层';
          const layer = PS.makeLayer(name, width, height, canvas);
          const next = [layer, ...layersRef.current];
          layersRef.current = next;
          setLayers(next);
          activeIdRef.current = layer.id;
          setActiveId(layer.id);
          commit('置入图层');
        }
      } catch {
        toast.error('图片加载失败');
      }
    },
    [commit, openNewTab, fitView]
  );

  const handleDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) openImage(file, 'layer');
    },
    [openImage]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) openImage(file, 'layer');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openImage]);

  const createNewDoc = useCallback(() => {
    const width = clamp(Math.round(newW), 1, 8000);
    const height = clamp(Math.round(newH), 1, 8000);
    tabSeq.current += 1;
    const fresh = makeEmptyTab(`未命名-${tabSeq.current}`, width, height, newBgWhite);
    openNewTab(fresh);
    setNewOpen(false);
    requestAnimationFrame(() => fitView());
  }, [newW, newH, newBgWhite, openNewTab, fitView]);

  const doExport = useCallback(async () => {
    const { width, height } = docRef.current;
    const flat = PS.flattenTo(layersRef.current, width, height);
    let out = flat;
    if (exportFormat === 'jpeg') {
      out = PS.canvasOf(width, height);
      const ctx = PS.ctxOf(out);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(flat, 0, 0);
    }
    const blob = await new Promise<Blob | null>((res) =>
      out.toBlob(res, mimeOf(exportFormat), exportQuality / 100)
    );
    if (!blob) {
      toast.error('导出失败');
      return;
    }
    const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
    downloadBlob(blob, `photoshop-${Date.now()}.${ext}`);
    toast.success(`已导出 ${formatBytes(blob.size)}`);
    setExportOpen(false);
  }, [exportFormat, exportQuality]);

  /* ---------- 拼图 ---------- */
  const collageFileRef = useRef<HTMLInputElement>(null);
  const collagePreviewRef = useRef<HTMLCanvasElement>(null);

  const composeCollage = useCallback((): HTMLCanvasElement => {
    const layout = COLLAGE_LAYOUTS.find((l) => l.id === collageLayout) ?? COLLAGE_LAYOUTS[0];
    const opts: PS.CollageOptions = {
      width: collageWidth,
      gap: collageGap,
      background: collageBg,
      radius: collageRadius
    };
    if (layout.mode === 'stack-v') return PS.buildStackCollage(collageImgs, true, opts);
    if (layout.mode === 'stack-h') return PS.buildStackCollage(collageImgs, false, opts);
    return PS.buildGridCollage(collageImgs, layout.cols ?? 2, layout.rows ?? 2, opts);
  }, [collageImgs, collageLayout, collageGap, collageWidth, collageBg, collageRadius]);

  useEffect(() => {
    const canvas = collagePreviewRef.current;
    if (!canvas || collageImgs.length === 0 || !collageOpen) return;
    const composed = composeCollage();
    const maxW = 380;
    const scale = Math.min(1, maxW / composed.width);
    const w = Math.max(1, Math.round(composed.width * scale));
    const h = Math.max(1, Math.round(composed.height * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(composed, 0, 0, w, h);
  }, [collageOpen, collageImgs, composeCollage]);

  const loadCollageFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    try {
      const imgs = await Promise.all(arr.map((f) => loadImageFromFile(f)));
      setCollageImgs(imgs);
    } catch {
      toast.error('部分图片加载失败');
    }
  }, []);

  const applyCollage = useCallback(() => {
    if (collageImgs.length === 0) {
      toast('请先添加图片');
      return;
    }
    const canvas = composeCollage();
    const bgLayer = PS.makeLayer('背景', canvas.width, canvas.height, canvas);
    const fresh: DocTab = {
      id: PS.uid(),
      name: '拼图',
      width: canvas.width,
      height: canvas.height,
      layers: [bgLayer],
      activeLayerId: bgLayer.id,
      selectedIds: [bgLayer.id],
      history: [
        {
          label: '拼图',
          width: canvas.width,
          height: canvas.height,
          activeId: bgLayer.id,
          layers: [PS.cloneLayer(bgLayer)]
        }
      ],
      historyIndex: 0,
      zoom: 1,
      selection: null,
      adjust: null,
      cropNorm: { x: 0, y: 0, w: 1, h: 1 }
    };
    openNewTab(fresh);
    setCollageOpen(false);
    requestAnimationFrame(() => fitView());
  }, [collageImgs, composeCollage, openNewTab, fitView]);

  const exportCollage = useCallback(async () => {
    if (collageImgs.length === 0) {
      toast('请先添加图片');
      return;
    }
    const canvas = composeCollage();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) {
      toast.error('导出失败');
      return;
    }
    downloadBlob(blob, `拼图-${Date.now()}.png`);
    toast.success(`已导出 ${formatBytes(blob.size)}`);
  }, [collageImgs, composeCollage]);

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        deselect();
        return;
      }
      if (mod && key === 't') {
        e.preventDefault();
        beginTransform();
        return;
      }
      if (key === 'enter' && uiRef.current.transform) {
        e.preventDefault();
        commitTransform();
        return;
      }
      if (key === 'escape' && uiRef.current.transform) {
        e.preventDefault();
        cancelTransform();
        return;
      }
      if (mod && key === '0') {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        setZoom((z) => clamp(z * 1.2, ZOOM_MIN, ZOOM_MAX));
        return;
      }
      if (mod && key === '-') {
        e.preventDefault();
        setZoom((z) => clamp(z / 1.2, ZOOM_MIN, ZOOM_MAX));
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelectionArea();
        return;
      }
      if (key === '[') {
        const ui = uiRef.current;
        if (ui.tool === 'eraser') setEraser((s) => ({ ...s, size: clamp(s.size - 4, 1, 500) }));
        else if (ui.tool === 'mosaic') setMosaic((s) => ({ ...s, brush: clamp(s.brush - 4, 4, 500) }));
        else setBrush((s) => ({ ...s, size: clamp(s.size - 4, 1, 500) }));
        return;
      }
      if (key === ']') {
        const ui = uiRef.current;
        if (ui.tool === 'eraser') setEraser((s) => ({ ...s, size: clamp(s.size + 4, 1, 500) }));
        else if (ui.tool === 'mosaic') setMosaic((s) => ({ ...s, brush: clamp(s.brush + 4, 4, 500) }));
        else setBrush((s) => ({ ...s, size: clamp(s.size + 4, 1, 500) }));
        return;
      }
      if (!mod && key === 'x') {
        const ui = uiRef.current;
        setFg(ui.bg);
        setBg(ui.fg);
        return;
      }
      if (!mod && key === 'd') {
        setFg('#111827');
        setBg('#ffffff');
        return;
      }
      if (!mod) {
        if (key === 'm') {
          setTool(e.shiftKey ? 'marquee-ellipse' : 'marquee-rect');
        } else if (key === 'g') {
          setTool(e.shiftKey ? 'gradient' : 'bucket');
        } else {
          const t = TOOL_HOTKEYS[key];
          if (t) setTool(t);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectAll, deselect, deleteSelectionArea, beginTransform, commitTransform, cancelTransform]);

  /* ---------- 渲染辅助 ---------- */
  const activeTool = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
  const cursorStyle = transform
    ? 'move'
    : tool === 'move'
      ? 'move'
      : tool === 'text'
        ? 'text'
        : tool === 'crop'
          ? 'default'
          : 'crosshair';

  const onFileDocChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) openImage(file, 'doc');
    e.target.value = '';
  };
  const onFileLayerChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) openImage(file, 'layer');
    e.target.value = '';
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-background)]">
      {/* 顶部工具选项条 */}
      <div className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 text-xs">
        <div className="flex items-center gap-1.5 whitespace-nowrap font-medium">
          <activeTool.icon className="h-4 w-4 text-[var(--color-primary)]" />
          {activeTool.label}
        </div>
        <div className="h-4 w-px shrink-0 bg-[var(--color-border)]" />
        <div className="flex items-center gap-3 whitespace-nowrap">
          {tool === 'brush' && (
            <>
              <MiniSlider label="大小" value={brush.size} min={1} max={500} onChange={(v) => setBrush({ ...brush, size: v })} />
              <MiniSlider label="硬度" value={brush.hardness} min={0} max={100} onChange={(v) => setBrush({ ...brush, hardness: v })} />
              <MiniSlider label="不透明度" value={brush.opacity} min={1} max={100} onChange={(v) => setBrush({ ...brush, opacity: v })} />
              <ColorInput value={fg} onChange={setFg} title="前景色" />
            </>
          )}
          {tool === 'eraser' && (
            <>
              <MiniSlider label="大小" value={eraser.size} min={1} max={500} onChange={(v) => setEraser({ ...eraser, size: v })} />
              <MiniSlider label="硬度" value={eraser.hardness} min={0} max={100} onChange={(v) => setEraser({ ...eraser, hardness: v })} />
              <MiniSlider label="不透明度" value={eraser.opacity} min={1} max={100} onChange={(v) => setEraser({ ...eraser, opacity: v })} />
            </>
          )}
          {tool === 'mosaic' && (
            <>
              <MiniSlider label="格子" value={mosaic.size} min={3} max={64} onChange={(v) => setMosaic({ ...mosaic, size: v })} />
              <MiniSlider label="笔刷" value={mosaic.brush} min={4} max={500} onChange={(v) => setMosaic({ ...mosaic, brush: v })} />
              <span className="text-[10px] text-[var(--color-muted-foreground)]">
                拖拽涂抹打码，受选区限制
              </span>
            </>
          )}
          {tool === 'ai-cutout' && (
            <>
              <span className="text-[10px] leading-relaxed text-[var(--color-muted-foreground)]">
                图片会上传到本地抠图服务（servers/cutout-api）去背景，不发往第三方
              </span>
              <span className="text-[10px] font-medium text-[var(--color-foreground)]">
                {cutoutBusy ? '抠图中…' : '首次调用较慢'}
              </span>
              <ChipButton onClick={() => void runAiCutout('document')} disabled={cutoutBusy}>
                整图抠图
              </ChipButton>
              <ChipButton onClick={() => void runAiCutout('layer')} disabled={cutoutBusy || !activeLayer}>
                抠当前图层
              </ChipButton>
              <ChipButton
                onClick={() => void runAiCutout('selection')}
                disabled={cutoutBusy || !selection}
                active={!!selection}
              >
                {selection ? '抠选区内' : '抠选区内（先画选区）'}
              </ChipButton>
            </>
          )}
          {tool === 'bucket' && (
            <>
              <MiniSlider label="容差" value={tolerance} min={0} max={200} onChange={setTolerance} />
              <ColorInput value={fg} onChange={setFg} title="填充色" />
            </>
          )}
          {tool === 'gradient' && (
            <>
              <Select
                value={gradient.kind}
                onChange={(e) => setGradient({ ...gradient, kind: e.target.value as PS.GradientKind })}
                className="h-8 w-28 text-xs"
              >
                <option value="linear">线性渐变</option>
                <option value="radial">径向渐变</option>
              </Select>
              <Select
                value={gradient.toBg ? 'bg' : 'transparent'}
                onChange={(e) => setGradient({ ...gradient, toBg: e.target.value === 'bg' })}
                className="h-8 w-32 text-xs"
              >
                <option value="transparent">前景 → 透明</option>
                <option value="bg">前景 → 背景</option>
              </Select>
              <ColorInput value={fg} onChange={setFg} title="前景色" />
              <ColorInput value={bg} onChange={setBg} title="背景色" />
            </>
          )}
          {tool === 'text' && (
            <>
              <Select
                value={textOpts.font}
                onChange={(e) => setTextOpts({ ...textOpts, font: e.target.value as PS.FontId })}
                className="h-8 w-24 text-xs"
              >
                {PS.PS_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <MiniSlider label="字号" value={textOpts.size} min={8} max={400} onChange={(v) => setTextOpts({ ...textOpts, size: v })} width="w-28" />
              <ChipButton active={textOpts.bold} onClick={() => setTextOpts({ ...textOpts, bold: !textOpts.bold })}>
                加粗
              </ChipButton>
              <ChipButton active={textOpts.italic} onClick={() => setTextOpts({ ...textOpts, italic: !textOpts.italic })}>
                斜体
              </ChipButton>
              <ColorInput value={textOpts.color} onChange={(v) => setTextOpts({ ...textOpts, color: v })} title="文字颜色" />
            </>
          )}
          {tool === 'shape' && (
            <>
              <Select
                value={shape.kind}
                onChange={(e) => setShape({ ...shape, kind: e.target.value as PS.ShapeKind })}
                className="h-8 w-24 text-xs"
              >
                <option value="rect">矩形</option>
                <option value="ellipse">椭圆</option>
                <option value="line">直线</option>
                <option value="arrow">箭头</option>
              </Select>
              <ChipButton active={shape.fill} onClick={() => setShape({ ...shape, fill: !shape.fill })}>
                {shape.fill ? '填充' : '描边'}
              </ChipButton>
              {!shape.fill && (
                <MiniSlider label="线宽" value={shape.lineWidth} min={1} max={100} onChange={(v) => setShape({ ...shape, lineWidth: v })} />
              )}
              <ColorInput value={fg} onChange={setFg} title="形状颜色" />
            </>
          )}
          {(tool === 'marquee-rect' || tool === 'marquee-ellipse' || tool === 'lasso' || tool === 'magic-wand') && (
            <>
              {tool === 'magic-wand' && (
                <MiniSlider label="容差" value={tolerance} min={0} max={200} onChange={setTolerance} />
              )}
              <MiniSlider label="羽化" value={feather} min={0} max={100} onChange={setFeather} />
              <ChipButton onClick={featherCurrent}>羽化</ChipButton>
              <ChipButton onClick={selectAll}>全选</ChipButton>
              <ChipButton onClick={invertSel}>反选</ChipButton>
              <ChipButton onClick={deselect}>取消选择</ChipButton>
              <ChipButton onClick={deleteSelectionArea}>删除</ChipButton>
              <ChipButton onClick={fillSelectionColor}>填充前景色</ChipButton>
            </>
          )}
          {tool === 'crop' && (
            <>
              <ChipButton active onClick={applyCrop}>
                应用裁剪
              </ChipButton>
              <ChipButton onClick={() => setCropNorm({ x: 0, y: 0, w: 1, h: 1 })}>重置</ChipButton>
            </>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 whitespace-nowrap">
          <IconBtn title="撤销 (Ctrl+Z)" onClick={undo} disabled={indexRef.current <= 0}>
            <Undo2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={indexRef.current >= historyRef.current.length - 1}>
            <Redo2 className="h-4 w-4" />
          </IconBtn>
          <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <IconBtn title="新建文档" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="打开图片" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="置入图层" onClick={() => layerFileRef.current?.click()}>
            <FilePlus2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="拼图" onClick={() => setCollageOpen(true)}>
            <LayoutGrid className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="导出" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" />
          </IconBtn>
          <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <IconBtn title="缩小 (Ctrl+-)" onClick={() => setZoom((z) => clamp(z / 1.2, ZOOM_MIN, ZOOM_MAX))}>
            <ZoomOut className="h-4 w-4" />
          </IconBtn>
          <button
            type="button"
            onClick={fitView}
            className="min-w-12 rounded px-1 text-center text-[11px] tabular-nums hover:bg-[var(--color-accent)]"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconBtn title="放大 (Ctrl++)" onClick={() => setZoom((z) => clamp(z * 1.2, ZOOM_MIN, ZOOM_MAX))}>
            <ZoomIn className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="适应窗口" onClick={fitView}>
            <Maximize className="h-4 w-4" />
          </IconBtn>
          <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <IconBtn title="快捷键配置" onClick={() => setShortcutsOpen(true)}>
            <Keyboard className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            title={sidebarOpen ? '收起右侧面板' : '展开右侧面板'}
            active={!sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </IconBtn>
        </div>
      </div>

      {/* 文档标签页 */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-background)] px-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const name = isActive ? docName : tab.name;
          return (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              onDoubleClick={() => setRenamingTabId(tab.id)}
              title={`${tab.width} × ${tab.height} px`}
              className={cn(
                'group flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs transition-colors',
                isActive
                  ? 'bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm ring-1 ring-[var(--color-border)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]'
              )}
            >
              {renamingTabId === tab.id ? (
                <input
                  autoFocus
                  defaultValue={name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => renameTab(tab.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameTab(tab.id, e.currentTarget.value);
                    else if (e.key === 'Escape') setRenamingTabId(null);
                  }}
                  className="w-24 rounded border border-[var(--color-primary)] bg-[var(--color-background)] px-1 text-[11px] text-[var(--color-foreground)] outline-none"
                />
              ) : (
                <span className="max-w-[140px] truncate">{name}</span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                title="关闭"
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded text-[var(--color-muted-foreground)] transition-all hover:bg-[var(--color-border)] hover:text-[var(--color-foreground)]',
                  isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={newTab}
          title="新建文档"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 工具条 */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-card)] py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={`${t.label} (${t.hotkey})`}
              onClick={() => selectTool(t.id)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]',
                tool === t.id &&
                  'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]/90 hover:text-white'
              )}
            >
              <t.icon className="h-4 w-4" />
            </button>
          ))}
          <div className="my-1 h-px w-6 bg-[var(--color-border)]" />
          <div className="relative h-11 w-10">
            <input
              type="color"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              title="背景色"
              className="absolute bottom-0 right-0 h-6 w-6 cursor-pointer rounded-md border border-[var(--color-border)] p-0.5"
            />
            <input
              type="color"
              value={fg}
              onChange={(e) => setFg(e.target.value)}
              title="前景色"
              className="absolute left-0 top-0 h-6 w-6 cursor-pointer rounded-md border border-[var(--color-border)] p-0.5"
            />
          </div>
          <button
            type="button"
            title="交换前景/背景色 (X)"
            onClick={() => {
              const cur = uiRef.current;
              setFg(cur.bg);
              setBg(cur.fg);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="默认颜色 (D)"
            onClick={() => {
              setFg('#111827');
              setBg('#ffffff');
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          >
            D
          </button>
        </div>

        {/* 画布区 */}
        <div
          ref={viewportRef}
          className="relative min-w-0 flex-1 overflow-auto bg-[#1e1e20]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="flex min-h-full min-w-full items-center justify-center p-8">
            <div className="relative shrink-0 shadow-2xl ring-1 ring-black/20" style={{ width: dispW, height: dispH }}>
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: CHECKER,
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                  backgroundColor: '#ffffff'
                }}
              />
              <canvas
                ref={canvasRef}
                width={bmpW}
                height={bmpH}
                className="absolute inset-0"
                style={{ width: dispW, height: dispH }}
              />
              <canvas
                ref={overlayRef}
                width={bmpW}
                height={bmpH}
                className="absolute inset-0 touch-none"
                style={{ width: dispW, height: dispH, cursor: cursorStyle }}
                onPointerDown={handlePointerDown}
                onPointerMove={handleHover}
                onPointerLeave={handleLeave}
              />
              {tool === 'crop' && (
                <ImageCropOverlay
                  imageRect={{ left: 0, top: 0, width: dispW, height: dispH }}
                  crop={cropNorm}
                  aspect={null}
                  active
                  onChange={setCropNorm}
                />
              )}
              {textEdit && (
                <div className="absolute z-30" style={{ left: textEdit.x * zoom, top: textEdit.y * zoom }}>
                  <textarea
                    autoFocus
                    rows={2}
                    value={textEdit.value}
                    placeholder="输入文字，Ctrl+Enter 确认"
                    onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setTextEdit(null);
                      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText();
                    }}
                    className="block resize-none rounded border border-dashed border-sky-400 bg-transparent p-0.5 outline-none"
                    style={{
                      width: Math.max(120, PS.textBlockSize(textEdit.value || ' ', textOpts).width * zoom + 16),
                      color: textOpts.color,
                      fontSize: textOpts.size * zoom,
                      lineHeight: 1.25,
                      fontFamily: PS.fontStackOf(textOpts.font),
                      fontWeight: textOpts.bold ? 700 : 400,
                      fontStyle: textOpts.italic ? 'italic' : 'normal'
                    }}
                  />
                  <div className="mt-1 flex gap-1">
                    <button
                      type="button"
                      onClick={commitText}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-primary)] text-white shadow"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTextEdit(null)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧面板 */}
        {sidebarOpen && (
        <aside className="flex w-[304px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-background)]">
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            <Panel title="颜色" icon={Palette}>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[10px] text-[var(--color-muted-foreground)]">前景色</div>
                  <input
                    type="color"
                    value={fg}
                    onChange={(e) => setFg(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-lg border border-[var(--color-border)] p-0.5"
                  />
                </div>
                <button
                  type="button"
                  title="交换前景/背景色 (X)"
                  onClick={() => {
                    setFg(bg);
                    setBg(fg);
                  }}
                  className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[10px] text-[var(--color-muted-foreground)]">背景色</div>
                  <input
                    type="color"
                    value={bg}
                    onChange={(e) => setBg(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-lg border border-[var(--color-border)] p-0.5"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">HEX</span>
                <input
                  value={fg}
                  onChange={(e) => setFg(e.target.value)}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 font-mono text-[11px] uppercase outline-none focus:border-[var(--color-primary)]"
                />
                <span
                  className="h-5 w-5 shrink-0 rounded-md border border-[var(--color-border)]"
                  style={{ backgroundColor: fg }}
                />
              </div>
              <div className="grid grid-cols-8 gap-1.5 pt-0.5">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => setFg(c)}
                    className="h-5 w-full rounded-md transition-transform ring-[var(--color-border)] hover:scale-110 hover:ring-1"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="图层" icon={Layers}>
              <div className="-mx-1 flex items-center gap-0.5 rounded-lg bg-[var(--color-muted)]/60 px-1 py-1">
                <IconBtn title="新建图层" onClick={() => addLayer('图层')}>
                  <Plus className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="复制图层" onClick={duplicateLayer}>
                  <Copy className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="删除图层" onClick={removeLayer}>
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
                <div className="flex-1" />
                <IconBtn title="上移" onClick={() => moveLayer(-1)}>
                  <ChevronUp className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="下移" onClick={() => moveLayer(1)}>
                  <ChevronDown className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="向下合并" onClick={mergeDownLayer}>
                  <Merge className="h-4 w-4" />
                </IconBtn>
              </div>

              {selectedIds.length >= 2 && (
                <div className="flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)]/10 px-2 py-1.5 text-[11px]">
                  <span className="shrink-0 font-medium text-[var(--color-primary)]">
                    已选 {selectedIds.length} 个图层
                  </span>
                  <div className="flex-1" />
                  <ChipButton onClick={mergeSelected}>合并</ChipButton>
                  <ChipButton onClick={() => focusLayer(activeId)}>取消多选</ChipButton>
                </div>
              )}

              <div className="space-y-1">
                {layers.map((layer) => {
                  const isSelected = selectedIds.includes(layer.id);
                  return (
                  <div
                    key={layer.id}
                    onClick={(e) => selectLayer(layer.id, e)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors',
                      isSelected
                        ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10'
                        : 'border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-accent)]',
                      layer.id === activeId && isSelected && 'ring-1 ring-[var(--color-primary)]/40'
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVisible(layer.id);
                      }}
                      className={cn(
                        'transition-colors',
                        layer.visible
                          ? 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
                          : 'text-[var(--color-border)] hover:text-[var(--color-muted-foreground)]'
                      )}
                    >
                      {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <LayerThumb layer={layer} revision={revision} />
                    <div
                      className="min-w-0 flex-1"
                      onDoubleClick={() => {
                        setRenamingId(layer.id);
                      }}
                    >
                      {renamingId === layer.id ? (
                        <input
                          autoFocus
                          defaultValue={layer.name}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => renameLayer(layer.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') renameLayer(layer.id, e.currentTarget.value);
                            else if (e.key === 'Escape') setRenamingId(null);
                          }}
                          className="w-full rounded border border-[var(--color-primary)] bg-[var(--color-background)] px-1 text-xs text-[var(--color-foreground)] outline-none"
                        />
                      ) : (
                        <div className="truncate text-xs font-medium text-[var(--color-foreground)]">{layer.name}</div>
                      )}
                      <div className="text-[10px] text-[var(--color-muted-foreground)]">
                        {layer.blend !== 'normal' ? `${BLEND_LABEL[layer.blend]} · ` : ''}
                        {Math.round(layer.opacity * 100)}%
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              {activeLayer && (
                <div className="space-y-2.5 border-t border-[var(--color-border)] pt-2.5">
                  <PanelRange
                    label="不透明度"
                    value={Math.round(activeLayer.opacity * 100)}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(v) => updateLayer(activeLayer.id, { opacity: v / 100 })}
                  />
                  <label className="flex items-center gap-2 text-[11px]">
                    <span className="shrink-0 text-[var(--color-muted-foreground)]">混合</span>
                    <Select
                      value={activeLayer.blend}
                      onChange={(e) => updateLayer(activeLayer.id, { blend: e.target.value as PS.BlendModeId })}
                      className="h-8 min-w-0 flex-1 rounded-lg text-xs"
                    >
                      {PS.BLEND_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {activeLayer.mask ? (
                      <>
                        <ChipButton active={maskEditing} onClick={toggleMaskEditing}>
                          {maskEditing ? '蒙版编辑中' : '编辑蒙版'}
                        </ChipButton>
                        <ChipButton onClick={toggleMaskEnabled}>
                          {activeLayer.maskEnabled ? '停用蒙版' : '启用蒙版'}
                        </ChipButton>
                        <ChipButton onClick={removeMask}>删除蒙版</ChipButton>
                      </>
                    ) : (
                      <ChipButton onClick={addMask}>添加蒙版</ChipButton>
                    )}
                  </div>
                  {maskEditing && (
                    <p className="text-[10px] leading-relaxed text-[var(--color-muted-foreground)]">
                      画笔 = 显示（白）· 橡皮擦 = 隐藏，红色区域为被隐藏部分
                    </p>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="调整" icon={SlidersHorizontal}>
              {activeLayer ? (
                <>
                  <PanelRange
                    label="亮度"
                    value={adjust?.brightness ?? 0}
                    min={-100}
                    max={100}
                    onChange={(v) => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), brightness: v }))}
                    onReset={() => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), brightness: 0 }))}
                  />
                  <PanelRange
                    label="对比度"
                    value={adjust?.contrast ?? 0}
                    min={-100}
                    max={100}
                    onChange={(v) => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), contrast: v }))}
                    onReset={() => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), contrast: 0 }))}
                  />
                  <PanelRange
                    label="饱和度"
                    value={adjust?.saturation ?? 0}
                    min={-100}
                    max={100}
                    onChange={(v) => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), saturation: v }))}
                    onReset={() => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), saturation: 0 }))}
                  />
                  <PanelRange
                    label="色相"
                    value={adjust?.hue ?? 0}
                    min={-180}
                    max={180}
                    suffix="°"
                    onChange={(v) => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), hue: v }))}
                    onReset={() => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), hue: 0 }))}
                  />
                  <PanelRange
                    label="模糊"
                    value={adjust?.blur ?? 0}
                    min={0}
                    max={50}
                    suffix="px"
                    onChange={(v) => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), blur: v }))}
                    onReset={() => setAdjust((a) => ({ ...(a ?? PS.DEFAULT_ADJUST), blur: 0 }))}
                  />
                  <div className="flex gap-1.5 pt-0.5">
                    <ChipButton active onClick={applyAdjust}>
                      应用调整
                    </ChipButton>
                    <ChipButton onClick={() => setAdjust(null)}>取消</ChipButton>
                  </div>
                  <div className="flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-2.5">
                    <ChipButton onClick={() => quickFilter('invert(1)', '反相')}>反相</ChipButton>
                    <ChipButton onClick={() => quickFilter('grayscale(1)', '去色')}>去色</ChipButton>
                    <ChipButton onClick={quickSharpen}>锐化</ChipButton>
        <ChipButton onClick={applyMosaic}>马赛克</ChipButton>
                  </div>
                </>
              ) : (
                <p className="py-1 text-center text-[11px] text-[var(--color-muted-foreground)]">请先选择图层</p>
              )}
            </Panel>

            <Panel title="变换" icon={FlipHorizontal2}>
              <ChipButton
                block
                active={!!transform}
                onClick={() => (transform ? cancelTransform() : beginTransform())}
              >
                自由变换 (Ctrl+T)
              </ChipButton>
              {transform && (
                <div className="rounded-lg bg-[var(--color-primary)]/10 px-2 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
                  拖动框内移动 · 角点缩放（Shift 等比例）· 顶部手柄旋转
                  <div className="mt-1 flex gap-1.5">
                    <ChipButton active onClick={commitTransform}>
                      应用 (Enter)
                    </ChipButton>
                    <ChipButton onClick={cancelTransform}>取消 (Esc)</ChipButton>
                  </div>
                </div>
              )}
              <p className="text-[10px] font-medium tracking-wider text-[var(--color-muted-foreground)]">当前图层</p>
              <div className="grid grid-cols-2 gap-1.5">
                <ChipButton onClick={() => layerFlip('h')}>水平翻转</ChipButton>
                <ChipButton onClick={() => layerFlip('v')}>垂直翻转</ChipButton>
                <ChipButton onClick={() => layerRotate('cw')}>旋转 90°</ChipButton>
                <ChipButton onClick={() => layerRotate('ccw')}>旋转 -90°</ChipButton>
              </div>
              <p className="pt-1 text-[10px] font-medium tracking-wider text-[var(--color-muted-foreground)]">整幅图像</p>
              <div className="grid grid-cols-2 gap-1.5">
                <ChipButton onClick={() => imageFlip('h')}>水平翻转</ChipButton>
                <ChipButton onClick={() => imageFlip('v')}>垂直翻转</ChipButton>
                <ChipButton onClick={() => imageRotate('cw')}>旋转 90°</ChipButton>
                <ChipButton onClick={() => imageRotate('ccw')}>旋转 -90°</ChipButton>
              </div>
              <ChipButton block onClick={flattenAll}>
                合并可见图层
              </ChipButton>
            </Panel>

            <Panel title="图像" icon={Maximize}>
              <div className="grid grid-cols-2 gap-1.5">
                <ChipButton onClick={openResize}>图像大小</ChipButton>
                <ChipButton onClick={openCanvasSize}>画布大小</ChipButton>
              </div>
              <p className="text-[10px] text-[var(--color-muted-foreground)]">
                当前 {doc.width} × {doc.height} px
              </p>
            </Panel>

            <Panel title="历史记录" icon={History}>
              <div className="flex items-center gap-0.5">
                <IconBtn title="撤销 (Ctrl+Z)" onClick={undo} disabled={indexRef.current <= 0}>
                  <Undo2 className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={indexRef.current >= historyRef.current.length - 1}>
                  <Redo2 className="h-4 w-4" />
                </IconBtn>
                <span className="ml-auto font-mono text-[10px] text-[var(--color-muted-foreground)]">
                  {historyState.index + 1} / {historyState.list.length}
                </span>
              </div>
              <div className="max-h-52 space-y-0.5 overflow-y-auto pr-0.5">
                {[...historyState.list]
                  .map((snap, i) => ({ snap, i }))
                  .reverse()
                  .map(({ snap, i }) => (
                    <button
                      key={`${i}-${snap.label}`}
                      type="button"
                      onClick={() => jumpTo(i)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition-colors',
                        i === historyState.index
                          ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                          : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]'
                      )}
                    >
                      <span className={cn('w-4 shrink-0 text-right font-mono', i === historyState.index && 'opacity-70')}>
                        {i + 1}
                      </span>
                      <span className="truncate">{snap.label}</span>
                    </button>
                  ))}
              </div>
            </Panel>
          </div>
        </aside>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--color-border)] bg-[var(--color-card)] px-3 text-[11px] text-[var(--color-muted-foreground)]">
        <span className="font-mono">
          {doc.width} × {doc.height} px
        </span>
        <span>缩放 {Math.round(zoom * 100)}%</span>
        <span>
          坐标 <span ref={cursorLabelRef} className="font-mono">—</span>
        </span>
        <span>{selection ? '有选区' : '无选区'}</span>
        <span>图层 {layers.length}</span>
        <span className="ml-auto truncate text-[var(--color-muted-foreground)]">
          {transform
            ? '自由变换：Enter 应用 · Esc 取消 · Shift 等比例缩放'
            : maskEditing
              ? '蒙版编辑：画笔 = 显示 · 橡皮擦 = 隐藏'
              : activeTool.hint}
        </span>
      </div>

      {/* 隐藏的文件输入 */}
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFileDocChange} />
      <input ref={layerFileRef} type="file" accept="image/*" hidden onChange={onFileLayerChange} />
      <input
        ref={collageFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void loadCollageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 新建文档弹窗 */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setNewOpen(false)}>
          <div className="w-[380px] rounded-xl bg-[var(--color-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold">新建文档</h3>
            <div className="mb-3 flex gap-3">
              <label className="flex-1 text-xs text-[var(--color-muted-foreground)]">
                宽度
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={newW}
                  onChange={(e) => setNewW(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] outline-none"
                />
              </label>
              <label className="flex-1 text-xs text-[var(--color-muted-foreground)]">
                高度
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={newH}
                  onChange={(e) => setNewH(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] outline-none"
                />
              </label>
            </div>
            <div className="mb-3 flex flex-wrap gap-1">
              {SIZE_PRESETS.map((p) => (
                <ChipButton key={p.label} onClick={() => { setNewW(p.w); setNewH(p.h); }}>
                  {p.label}
                </ChipButton>
              ))}
            </div>
            <label className="mb-4 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={newBgWhite} onChange={(e) => setNewBgWhite(e.target.checked)} />
              白色背景（取消则为透明）
            </label>
            <div className="flex justify-end gap-2">
              <ChipButton onClick={() => setNewOpen(false)}>取消</ChipButton>
              <ChipButton active onClick={createNewDoc}>
                创建
              </ChipButton>
            </div>
          </div>
        </div>
      )}

      {/* 导出弹窗 */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setExportOpen(false)}>
          <div className="w-[380px] rounded-xl bg-[var(--color-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold">导出图像</h3>
            <div className="mb-3 font-mono text-xs text-[var(--color-muted-foreground)]">
              {doc.width} × {doc.height} px
            </div>
            <div className="mb-3 flex items-center gap-2 text-xs">
              <span>格式</span>
              <Select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)} className="flex-1">
                <option value="png">PNG</option>
                <option value="jpeg">JPG</option>
                {supportsWebp() && <option value="webp">WEBP</option>}
              </Select>
            </div>
            {exportFormat !== 'png' && (
              <PanelRange label="质量" value={exportQuality} min={1} max={100} suffix="%" onChange={setExportQuality} />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <ChipButton onClick={() => setExportOpen(false)}>取消</ChipButton>
              <ChipButton active onClick={doExport}>
                导出
              </ChipButton>
            </div>
          </div>
        </div>
      )}

      {/* 拼图弹窗 */}
      {collageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCollageOpen(false)}>
          <div
            className="max-h-[90vh] w-[440px] overflow-y-auto rounded-xl bg-[var(--color-card)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-semibold">拼图 / 拼接</h3>

            <div className="mb-3">
              <p className="mb-1.5 text-[11px] text-[var(--color-muted-foreground)]">布局</p>
              <div className="grid grid-cols-4 gap-1.5">
                {COLLAGE_LAYOUTS.map((l) => (
                  <ChipButton key={l.id} active={collageLayout === l.id} onClick={() => setCollageLayout(l.id)}>
                    {l.label}
                  </ChipButton>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <p className="mb-1.5 text-[11px] text-[var(--color-muted-foreground)]">
                图片（已添加 {collageImgs.length} 张）
              </p>
              <div className="flex gap-1.5">
                <ChipButton onClick={() => collageFileRef.current?.click()}>
                  <ImagePlus className="mr-1 h-3 w-3" />
                  添加图片
                </ChipButton>
                <ChipButton onClick={() => setCollageImgs([])}>清空</ChipButton>
              </div>
            </div>

            <div className="mb-3 space-y-2.5">
              <PanelRange label="间距" value={collageGap} min={0} max={80} suffix="px" onChange={setCollageGap} />
              <PanelRange label="输出宽度" value={collageWidth} min={400} max={4000} step={50} onChange={setCollageWidth} />
              <PanelRange label="圆角" value={collageRadius} min={0} max={80} suffix="px" onChange={setCollageRadius} />
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-[var(--color-muted-foreground)]">背景色</span>
                <input
                  type="color"
                  value={collageBg}
                  onChange={(e) => setCollageBg(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-[var(--color-border)] p-0.5"
                />
              </div>
            </div>

            {collageImgs.length > 0 && (
              <div className="mb-3 flex justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2">
                <canvas ref={collagePreviewRef} className="max-w-full rounded" />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <ChipButton onClick={() => setCollageOpen(false)}>取消</ChipButton>
              <ChipButton onClick={() => void exportCollage()}>导出 PNG</ChipButton>
              <ChipButton active onClick={applyCollage}>
                生成到新文档
              </ChipButton>
            </div>
          </div>
        </div>
      )}

      {/* 图像大小弹窗 */}
      {resizeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setResizeOpen(false)}>
          <div className="w-[380px] rounded-xl bg-[var(--color-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold">图像大小（重采样）</h3>
            <div className="mb-3 text-xs text-[var(--color-muted-foreground)]">
              原尺寸 {doc.width} × {doc.height} px
            </div>
            <div className="mb-3 flex gap-3">
              <label className="flex-1 text-xs text-[var(--color-muted-foreground)]">
                宽度
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={resizeW}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setResizeW(v);
                    if (resizeKeep && v > 0) setResizeH(Math.round((v * doc.height) / doc.width));
                  }}
                  className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] outline-none"
                />
              </label>
              <label className="flex-1 text-xs text-[var(--color-muted-foreground)]">
                高度
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={resizeH}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setResizeH(v);
                    if (resizeKeep && v > 0) setResizeW(Math.round((v * doc.width) / doc.height));
                  }}
                  className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] outline-none"
                />
              </label>
            </div>
            <label className="mb-4 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={resizeKeep} onChange={(e) => setResizeKeep(e.target.checked)} />
              保持宽高比
            </label>
            <div className="flex justify-end gap-2">
              <ChipButton onClick={() => setResizeOpen(false)}>取消</ChipButton>
              <ChipButton active onClick={applyResize}>
                应用
              </ChipButton>
            </div>
          </div>
        </div>
      )}

      {/* 画布大小弹窗 */}
      {canvasSizeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCanvasSizeOpen(false)}>
          <div className="w-[380px] rounded-xl bg-[var(--color-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold">画布大小</h3>
            <div className="mb-3 text-xs text-[var(--color-muted-foreground)]">
              原尺寸 {doc.width} × {doc.height} px
            </div>
            <div className="mb-3 flex gap-3">
              <label className="flex-1 text-xs text-[var(--color-muted-foreground)]">
                宽度
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={canvasW}
                  onChange={(e) => setCanvasW(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] outline-none"
                />
              </label>
              <label className="flex-1 text-xs text-[var(--color-muted-foreground)]">
                高度
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={canvasH}
                  onChange={(e) => setCanvasH(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] outline-none"
                />
              </label>
            </div>
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] text-[var(--color-muted-foreground)]">锚点（原内容位置）</p>
              <div className="mx-auto grid w-fit grid-cols-3 gap-1">
                {ANCHORS.map((a) => (
                  <button
                    key={`${a.x}-${a.y}`}
                    type="button"
                    onClick={() => {
                      setAnchorX(a.x);
                      setAnchorY(a.y);
                    }}
                    className={cn(
                      'h-7 w-7 rounded border text-[10px] transition-colors',
                      anchorX === a.x && anchorY === a.y
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/20'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]'
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <ChipButton onClick={() => setCanvasSizeOpen(false)}>取消</ChipButton>
              <ChipButton active onClick={applyCanvasSize}>
                应用
              </ChipButton>
            </div>
          </div>
        </div>
      )}

      {/* 快捷键弹窗 */}
      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShortcutsOpen(false)}>
          <div
            className="max-h-[85vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-xl bg-[var(--color-card)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-[var(--color-primary)]" />
              <h3 className="text-sm font-semibold">快捷键</h3>
              <span className="ml-auto text-[11px] text-[var(--color-muted-foreground)]">
                共 {SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0)} 项
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <p className="text-[10px] font-medium tracking-wider text-[var(--color-muted-foreground)]">
                    {group.title}
                  </p>
                  {group.items.map((item) => (
                    <div
                      key={`${group.title}-${item.label}-${item.keys.join('+')}`}
                      className="flex items-start gap-2 text-[11px]"
                    >
                      <span className="flex shrink-0 gap-0.5">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className="min-w-[18px] rounded border border-[var(--color-border)] bg-[var(--color-muted)]/60 px-1.5 py-0.5 text-center font-mono text-[10px] leading-none text-[var(--color-foreground)]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                      <span className="min-w-0 flex-1 text-[var(--color-muted-foreground)]">
                        {item.label}
                        {item.note && (
                          <span className="mt-0.5 block text-[10px] text-amber-600">⚠ {item.note}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-[10px] text-[var(--color-muted-foreground)]">
                快捷键在输入框聚焦时不生效
              </span>
              <ChipButton active onClick={() => setShortcutsOpen(false)}>
                关闭
              </ChipButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
