import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ClipboardCopy,
  Crop,
  Download,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  History,
  ImagePlus,
  Images,
  ArrowUpToLine,
  Keyboard,
  Link2,
  Maximize,
  Maximize2,
  Move,
  MousePointer2,
  Paintbrush,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sticker,
  Trash2,
  Type,
  Undo2,
  Unlink,
  X
} from 'lucide-react';
import { KonvaCanvas, type DrawConfig, type KonvaCanvasHandle } from './components/konva-canvas';
import { LayerPanel } from './components/layer-panel';
import { ShortcutSettingsDialog } from './components/shortcut-settings-dialog';
import { RangeRow, ResetChip, Section, ToolButton, chipClass } from '@pmp/image-kit';
import {
  ASPECT_PRESETS,
  bakeCrop,
  bakeFineRotate,
  bakeOrientation,
  bakePerspective,
  DEFAULT_ADJUST,
  DEFAULT_PERSPECTIVE,
  FILTER_PRESETS,
  FULL_CROP,
  mimeOf,
  mixAdjust,
  orientedSize,
  STICKER_EMOJI,
  STICKER_ICONS,
  type AdjustParams,
  type CropRect,
  type ExportFormat,
  type FontKind,
  type Mark,
  type RotateAngle,
  type ShapeKind,
  type TextAlignKind
} from '@pmp/image-kit';
import {
  comboFromEvent,
  formatCombo,
  loadShortcutMap,
  resolveAction,
  saveShortcutMap,
  SHORTCUT_DEF_BY_ID,
  type ShortcutMap
} from './lib/image-shortcuts';
import {
  alignLayers,
  applyZOrder,
  BASE_LAYER_ID,
  centerInCanvas,
  cloneLayers,
  distributeLayers,
  duplicateLayer,
  findLayerDeep,
  findLocation,
  fitToCanvas,
  groupLayers,
  insertInto,
  isMark,
  makeMarkLayer,
  makePhotoLayer,
  MARK_MODE_LABEL,
  moveLayer,
  patchLayer,
  patchLayers,
  removeLayers,
  resetAspect,
  ungroupLayers,
  uniqueName,
  updateMark,
  updatePhoto,
  walk,
  type AlignMode,
  type CanvasLayer,
  type LayerBase,
  type PhotoLayer,
  type ZOrderOp
} from './lib/layer-model';
import { cn } from '@pmp/ui';

const ROTATE_STEPS: RotateAngle[] = [0, 90, 180, 270];
const normalizeAngle = (v: number): RotateAngle =>
  ROTATE_STEPS[((Math.round(v / 90) % 4) + 4) % 4];

const MARK_COLORS = ['#111827', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

const DRAW_TOOLS: { mode: string; label: string; icon: typeof Paintbrush }[] = [
  { mode: 'select', label: '选择移动', icon: MousePointer2 },
  { mode: 'brush', label: '涂抹', icon: Paintbrush },
  { mode: 'eraser', label: '擦拭', icon: Eraser },
  { mode: 'mosaic', label: '马赛克', icon: Frame },
  { mode: 'rect', label: '涂层', icon: Square },
  { mode: 'shape', label: '形状', icon: Sparkles },
  { mode: 'sticker', label: '贴纸', icon: Sticker },
  { mode: 'text', label: '文本', icon: Type }
];

const SHAPE_KINDS: { id: ShapeKind; label: string }[] = [
  { id: 'arrow', label: '箭头' },
  { id: 'line', label: '直线' },
  { id: 'rectOutline', label: '方框' },
  { id: 'ellipse', label: '椭圆' }
];

interface Snap {
  label: string;
  baseSrc: string | null;
  baseSize: { w: number; h: number };
  rotate: RotateAngle;
  fineRotate: number;
  flipH: boolean;
  flipV: boolean;
  scaleX: number;
  scaleY: number;
  adjust: AdjustParams;
  crop: CropRect;
  aspect: number | null;
  layers: CanvasLayer[];
}

/** 读图 -> objectURL + 尺寸 */
function loadImageInfo(file: File): Promise<{ src: string; w: number; h: number; name: string } | null> {
  const src = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const el = new window.Image();
    el.onload = () => resolve({ src, w: el.naturalWidth, h: el.naturalHeight, name: file.name.replace(/\.[^.]+$/, '') });
    el.onerror = () => {
      URL.revokeObjectURL(src);
      resolve(null);
    };
    el.src = src;
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('底图加载失败'));
    el.src = src;
  });
}

/**
 * 画布 -> 可直接作为底图的 url：
 * 优先 objectURL（大图 dataURL 会非常长，容易解码失败），并先解码校验成功再返回。
 * 这样「画布尺寸已更新、位图却没跟上」的坏状态不会出现（底图被拉伸变形且无法恢复）。
 */
async function canvasToVerifiedUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
  try {
    await loadImageElement(url);
  } catch (e) {
    if (blob) URL.revokeObjectURL(url);
    throw e instanceof Error ? e : new Error('底图生成失败');
  }
  return url;
}

/** 收集所有图片图层 id（含组内） */
function collectPhotoIds(layers: CanvasLayer[]) {
  const ids: number[] = [];
  walk(layers, (l) => {
    if (l.kind === 'photo') ids.push(l.id);
  });
  return ids;
}

/** 把位图画到一张同尺寸画布上，供烘焙类纯函数使用 */
function imageToCanvas(img: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** 按导出格式取 dataURL（非 PNG 先铺白底，避免透明区域变黑） */
function canvasToDataUrl(canvas: HTMLCanvasElement, format: ExportFormat, quality: number) {
  let out = canvas;
  if (format !== 'png') {
    const filled = document.createElement('canvas');
    filled.width = canvas.width;
    filled.height = canvas.height;
    const ctx = filled.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, filled.width, filled.height);
      ctx.drawImage(canvas, 0, 0);
    }
    out = filled;
  }
  return out.toDataURL(mimeOf(format), format === 'png' ? undefined : quality);
}

export default function KonvaImagePage() {
  // ---- 底图与变换 ----
  const [baseSrc, setBaseSrc] = useState<string | null>(null);
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [baseSize, setBaseSize] = useState({ w: 0, h: 0 });
  const [rotate, setRotate] = useState<RotateAngle>(0);
  const [fineRotate, setFineRotate] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [scaleX, setScaleX] = useState(100);
  const [scaleY, setScaleY] = useState(100);
  const [lockAspect, setLockAspect] = useState(true);
  const [adjust, setAdjust] = useState<AdjustParams>({ ...DEFAULT_ADJUST });
  const [presetId, setPresetId] = useState('none');
  const [presetStrength, setPresetStrength] = useState(100);

  // ---- 图层（照片与标注同为图层，数组顺序即从下到上）；选中集合支持多选 ----
  const [layers, setLayers] = useState<CanvasLayer[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [library, setLibrary] = useState<{ name: string; src: string }[]>([]);

  // ---- 裁剪 / 透视 / 对比 ----
  const [mode, setMode] = useState<'view' | 'crop'>('view');
  const [crop, setCrop] = useState<CropRect>({ ...FULL_CROP });
  const [aspect, setAspect] = useState<number | null>(null);
  const [perspMode, setPerspMode] = useState(false);
  const [perspPoints, setPerspPoints] = useState<[number, number][]>(
    DEFAULT_PERSPECTIVE.map((p) => [p[0], p[1]] as [number, number])
  );
  const [compare, setCompare] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  /** 画布上的文本内联编辑 */
  const [textEdit, setTextEdit] = useState<{ id: number; value: string } | null>(null);

  // ---- 绘制工具 ----
  const [tool, setTool] = useState<string>('select');
  const [color, setColor] = useState(MARK_COLORS[2]);
  const [brushSize, setBrushSize] = useState(1.6);
  const [markOpacity, setMarkOpacity] = useState(100);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('arrow');
  const [shapeFilled, setShapeFilled] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [font, setFont] = useState<FontKind>('sans');
  const [textStroke, setTextStroke] = useState(true);
  const [textBg, setTextBg] = useState<string | null>(null);
  const lineHeight = 1.3;
  const [align, setAlign] = useState<TextAlignKind>('center');
  const [sticker, setSticker] = useState(STICKER_ICONS[0].id);
  const [stickerSize, setStickerSize] = useState(12);

  // ---- 导出 / 历史 / 快捷键 ----
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(0.92);
  const [name, setName] = useState('image');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Snap[]>([]);
  const [redoStack, setRedoStack] = useState<Snap[]>([]);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [shortcutMap, setShortcutMap] = useState<ShortcutMap>(() => loadShortcutMap());

  const canvasRef = useRef<KonvaCanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 单独的「替换底图」文件选择 */
  const baseFileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(1);
  const [dropActive, setDropActive] = useState(false);

  const oriented = useMemo(() => orientedSize(baseSize.w || 1, baseSize.h || 1, rotate), [baseSize, rotate]);
  const outW = Math.round(oriented.w * (scaleX / 100));
  const outH = Math.round(oriented.h * (scaleY / 100));
  const leafCounts = useMemo(() => {
    let photos = 0;
    let marks = 0;
    walk(layers, (l) => {
      if (l.kind === 'photo') photos += 1;
      else if (l.kind === 'mark') marks += 1;
    });
    return { photos, marks };
  }, [layers]);
  const photoCount = leafCounts.photos;
  const markCount = leafCounts.marks;
  const layerSelection = selectedIds.filter((id) => id !== BASE_LAYER_ID);
  const photoSelection = layerSelection.filter((id) => {
    const l = findLayerDeep(layers, id);
    return !!l && l.kind === 'photo';
  });
  const selectedLabel =
    selectedIds.length === 0
      ? '无'
      : selectedIds.length === 1
        ? selectedIds[0] === BASE_LAYER_ID
          ? '底图'
          : (findLayerDeep(layers, selectedIds[0])?.name ?? '无')
        : `${selectedIds.length} 个图层`;
  /** 正在编辑的文本层与浮层位置 */
  const editLayer = textEdit ? findLayerDeep(layers, textEdit.id) : undefined;
  const editMark = editLayer && isMark(editLayer) && editLayer.mark.mode === 'text' ? editLayer.mark : null;
  const editRect = textEdit ? canvasRef.current?.layerScreenRect(textEdit.id) ?? null : null;
  const editFontSize = editMark && editRect ? Math.max(11, editMark.size * baseSize.w * editRect.scale) : 14;

  const snap = useCallback(
    (label: string): Snap => ({
      label,
      baseSrc,
      baseSize,
      rotate,
      fineRotate,
      flipH,
      flipV,
      scaleX,
      scaleY,
      adjust: { ...adjust },
      crop: { ...crop },
      aspect,
      layers: cloneLayers(layers)
    }),
    [baseSrc, baseSize, rotate, fineRotate, flipH, flipV, scaleX, scaleY, adjust, crop, aspect, layers]
  );

  const pushHistory = useCallback(
    (label: string) => {
      if (!baseSrc) return;
      setHistory((h) => [...h.slice(-19), snap(label)]);
      setRedoStack([]);
    },
    [baseSrc, snap]
  );

  const applySnap = useCallback((s: Snap) => {
    setBaseSrc(s.baseSrc);
    setBaseSize(s.baseSize);
    setRotate(s.rotate);
    setFineRotate(s.fineRotate);
    setFlipH(s.flipH);
    setFlipV(s.flipV);
    setScaleX(s.scaleX);
    setScaleY(s.scaleY);
    setAdjust({ ...s.adjust });
    setCrop({ ...s.crop });
    setAspect(s.aspect);
    setLayers(cloneLayers(s.layers));
    setSelectedIds([]);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) {
        toast.info('没有可撤销的操作');
        return h;
      }
      const last = h[h.length - 1];
      setRedoStack((r) => [...r, snap(last.label)]);
      applySnap(last);
      toast.success(`已撤销「${last.label}」`);
      return h.slice(0, -1);
    });
  }, [applySnap, snap]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) {
        toast.info('没有可重做的操作');
        return r;
      }
      const last = r[r.length - 1];
      setHistory((h) => [...h, snap(last.label)]);
      applySnap(last);
      toast.success(`已重做「${last.label}」`);
      return r.slice(0, -1);
    });
  }, [applySnap, snap]);

  /** 历史步骤：回退到某一步之前 */
  const undoToStep = (index: number) => {
    const target = history[index];
    if (!target) return;
    setRedoStack((r) => [...r, snap(target.label)]);
    applySnap(target);
    setHistory((h) => h.slice(0, index));
    toast.success(`已回退到「${target.label}」之前`);
  };

  /**
   * 把图片变成新图层：按画布 contain 适配（最大 60%）、居中并级联错开，
   * 插到图层栈最上方（与 Figma / PS 粘贴新内容的行为一致）。
   */
  const buildPhotoLayers = (
    infos: { name: string; src: string; w: number; h: number }[],
    canvas: { w: number; h: number },
    existing: CanvasLayer[],
    cascadeStart: number
  ): PhotoLayer[] => {
    const out: PhotoLayer[] = [];
    infos.forEach((info, i) => {
      out.push(
        makePhotoLayer({
          id: idRef.current++,
          name: uniqueName([...existing, ...out], info.name),
          src: info.src,
          natural: { w: info.w, h: info.h },
          canvas,
          cascade: cascadeStart + i
        })
      );
    });
    return out;
  };

  /** 导入：没有底图时第一张作为底图，其余全部作为新图层叠加 */
  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) {
        toast.error('请选择图片文件');
        return;
      }
      const infos = (await Promise.all(images.map(loadImageInfo))).filter(
        (x): x is NonNullable<typeof x> => !!x
      );
      if (infos.length === 0) {
        toast.error('图片解析失败');
        return;
      }
      const first = infos[0];
      const rest = infos.slice(1);
      setLibrary((prev) => [...prev, ...infos.map((i) => ({ name: i.name, src: i.src }))]);

      if (!baseSrc) {
        setBaseSrc(first.src);
        setOriginalSrc(first.src);
        setBaseSize({ w: first.w, h: first.h });
        setName(first.name);
        setHistory([]);
        setRedoStack([]);
        setRotate(0);
        setFineRotate(0);
        setFlipH(false);
        setFlipV(false);
        setScaleX(100);
        setScaleY(100);
        setAdjust({ ...DEFAULT_ADJUST });
        setPresetId('none');
        setCrop({ ...FULL_CROP });
        setAspect(null);
        // 画布尺寸由底图决定，其余图片按该画布落位
        const created = buildPhotoLayers(rest, { w: first.w, h: first.h }, [], 0);
        setLayers(created);
        setSelectedIds(created.map((l) => l.id));
        toast.success(
          rest.length > 0
            ? `已载入 ${infos.length} 张：第 1 张为底图，其余 ${rest.length} 张成为图层`
            : `已载入 ${first.w} × ${first.h}`
        );
      } else {
        const created = buildPhotoLayers(infos, baseSize, layers, layers.length);
        setLayers((prev) => insertInto(prev, created, null));
        setSelectedIds(created.map((l) => l.id));
        toast.success(`已加入 ${created.length} 个图层（叠在最上方）`);
      }
    },
    [baseSrc, baseSize, layers]
  );

  /** 把图库里的某张作为新图层放回画布 */
  const addLibraryToCanvas = async (item: { name: string; src: string }) => {
    if (!baseSrc) return;
    try {
      const el = await loadImageElement(item.src);
      const [layer] = buildPhotoLayers(
        [{ ...item, w: el.naturalWidth, h: el.naturalHeight }],
        baseSize,
        layers,
        layers.length
      );
      pushHistory('添加图片图层');
      setLayers((prev) => insertInto(prev, [layer], null));
      setSelectedIds([layer.id]);
      toast.success(`已把「${item.name}」放到画布`);
    } catch {
      toast.error('图片加载失败');
    }
  };

  /** 从图库移除一张（不影响已放到画布上的图层与当前底图） */
  const removeLibraryItem = (index: number) => {
    setLibrary((prev) => prev.filter((_, i) => i !== index));
    toast.success('已从图库移除');
  };

  /**
   * 切换底图：只替换底图与其画布尺寸，**保留画布上的图层**
   * （图层坐标是相对底图的归一化值，换底图后会按新画布比例重新落位）。
   */
  const applyAsBase = async (src: string, label: string, size?: { w: number; h: number }) => {
    try {
      const el = size ? null : await loadImageElement(src);
      const w = size?.w ?? el?.naturalWidth ?? baseSize.w;
      const h = size?.h ?? el?.naturalHeight ?? baseSize.h;
      pushHistory('切换底图');
      setBaseSrc(src);
      setOriginalSrc(src);
      setBaseSize({ w, h });
      // 画布宽高比变了：按新画布重算图片图层比例，避免被非等比拉伸
      setLayers((prev) => resetAspect(prev, collectPhotoIds(prev), { w, h }));
      setName(label);
      setRotate(0);
      setFineRotate(0);
      setFlipH(false);
      setFlipV(false);
      setScaleX(100);
      setScaleY(100);
      setCrop({ ...FULL_CROP });
      setAspect(null);
      setMode('view');
      setPerspMode(false);
      toast.success(
        layers.length > 0
          ? `已切换底图为「${label}」，${layers.length} 个图层已保留`
          : `已切换底图为「${label}」`
      );
    } catch {
      toast.error('图片加载失败');
    }
  };

  /** 用文件替换底图（保留图层，便于单独换背景图） */
  const replaceBaseFromFile = async (file: File) => {
    const info = await loadImageInfo(file);
    if (!info) {
      toast.error('图片解析失败');
      return;
    }
    setLibrary((prev) => [...prev, { name: info.name, src: info.src }]);
    await applyAsBase(info.src, info.name, { w: info.w, h: info.h });
  };

  /**
   * 底图转为可编辑图层：画布尺寸不变，底图换成同尺寸透明画布，
   * 原底图成为最底层的图片图层，可以像普通图层一样移动 / 缩放 / 旋转 / 删除。
   */
  const baseToLayer = async () => {
    if (!baseSrc) return;
    try {
      const el = await loadImageElement(baseSrc);
      const w = el.naturalWidth || baseSize.w;
      const h = el.naturalHeight || baseSize.h;
      const transparent = document.createElement('canvas');
      transparent.width = Math.max(1, w);
      transparent.height = Math.max(1, h);
      const url = await canvasToVerifiedUrl(transparent);

      const layer = makePhotoLayer({
        id: idRef.current++,
        name: uniqueName(layers, name || '底图'),
        src: baseSrc,
        natural: { w, h },
        canvas: { w, h }
      });
      // 与原底图 1:1 对齐：铺满整张画布
      layer.width = 1;
      layer.height = 1;
      layer.x = 0.5;
      layer.y = 0.5;

      pushHistory('底图转为图层');
      setLayers((prev) => insertInto(prev, [layer], null, 0));
      setBaseSrc(url);
      setOriginalSrc(url);
      setBaseSize({ w, h });
      setRotate(0);
      setFineRotate(0);
      setFlipH(false);
      setFlipV(false);
      setScaleX(100);
      setScaleY(100);
      setCrop({ ...FULL_CROP });
      setAspect(null);
      setSelectedIds([layer.id]);
      toast.success('底图已转为图层：现在可以像普通图层一样移动 / 缩放 / 旋转');
    } catch {
      toast.error('操作失败');
    }
  };

  /** 把选中的图片图层设为底图（保留其翻转 / 90° 旋转，烘焙进新底图） */
  const promoteToBase = async (id: number) => {
    const layer = findLayerDeep(layers, id);
    if (!layer || layer.kind !== 'photo') {
      toast.info('请在图层里选中一个图片图层，再「设为底图」');
      return;
    }
    try {
      const rot = (((Math.round(layer.rotation / 90) * 90) % 360) + 360) % 360;
      const needsBake = layer.flipH || layer.flipV || rot !== 0;
      let src = layer.src;
      let w = layer.natural.w;
      let h = layer.natural.h;
      if (needsBake) {
        const el = await loadImageElement(layer.src);
        const baked = bakeOrientation(el, el.naturalWidth, el.naturalHeight, rot as RotateAngle, layer.flipH, layer.flipV);
        src = await canvasToVerifiedUrl(baked);
        w = baked.width;
        h = baked.height;
      }
      pushHistory('设为底图');
      setBaseSrc(src);
      setOriginalSrc(src);
      setBaseSize({ w, h });
      // 画布尺寸变了：其余图片图层按新画布重算比例，避免被拉伸
      setLayers((prev) => resetAspect(prev, collectPhotoIds(prev), { w, h }));
      setName(layer.name);
      setRotate(0);
      setFineRotate(0);
      setFlipH(false);
      setFlipV(false);
      setScaleX(100);
      setScaleY(100);
      setCrop({ ...FULL_CROP });
      setAspect(null);
      setMode('view');
      setPerspMode(false);
      setLayers((prev) => removeLayers(prev, [id]));
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      toast.success(`已把「${layer.name}」设为底图`);
    } catch {
      toast.error('操作失败');
    }
  };

  /** 变换操作 */
  const rotateBy = (delta: number) => {
    if (!baseSrc) return;
    pushHistory(delta > 0 ? '右转 90°' : '左转 90°');
    setRotate((r) => normalizeAngle(r + delta));
  };

  const resetAll = () => {
    if (!baseSrc) return;
    pushHistory('重置全部');
    setRotate(0);
    setFineRotate(0);
    setFlipH(false);
    setFlipV(false);
    setScaleX(100);
    setScaleY(100);
    setAdjust({ ...DEFAULT_ADJUST });
    setPresetId('none');
    setCrop({ ...FULL_CROP });
    setAspect(null);
    setLayers([]);
    setSelectedIds([]);
    setMode('view');
    setPerspMode(false);
  };

  /**
   * 几何烘焙：把一次性操作（裁剪 / 拉直 / 透视）合进底图。
   * 底图尺寸与坐标系变了，画布元素无法沿用，因此一并重置。
   */
  const bakeBase = async (
    label: string,
    done: string,
    make: (src: HTMLCanvasElement, sw: number, sh: number) => HTMLCanvasElement
  ) => {
    if (!baseSrc) return;
    setBusy(true);
    try {
      const img = await loadImageElement(baseSrc);
      // 以位图真实尺寸为准，避免沿用错位的画布尺寸把图片拉伸后固化
      const sw = img.naturalWidth || baseSize.w;
      const sh = img.naturalHeight || baseSize.h;
      const next = make(imageToCanvas(img, sw, sh), sw, sh);
      if (next.width < 1 || next.height < 1) throw new Error('结果尺寸无效');
      // 先确认新底图能解码，再提交状态：避免画布尺寸与位图不匹配导致底图被拉伸变形
      const url = await canvasToVerifiedUrl(next);
      pushHistory(label);
      setBaseSrc(url);
      setOriginalSrc(url);
      setBaseSize({ w: next.width, h: next.height });
      setRotate(0);
      setFineRotate(0);
      setFlipH(false);
      setFlipV(false);
      setScaleX(100);
      setScaleY(100);
      setCrop({ ...FULL_CROP });
      setAspect(null);
      setMode('view');
      setPerspMode(false);
      setLayers([]);
      setSelectedIds([]);
      toast.success(`${done}：${next.width} × ${next.height}（画布元素已重置）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处理失败');
    } finally {
      setBusy(false);
    }
  };

  /** 应用裁剪：旋转/翻转 + 裁剪一起烘焙进底图 */
  const applyCrop = async () => {
    if (!baseSrc) return;
    if (crop.w >= 0.999 && crop.h >= 0.999) {
      toast.info('裁剪框已是完整画面');
      setMode('view');
      return;
    }
    await bakeBase('应用裁剪', '已裁剪', (src, sw, sh) =>
      bakeCrop(bakeOrientation(src, sw, sh, rotate, flipH, flipV), crop)
    );
  };

  /** 应用拉直：微调角度烘焙进底图，自动裁掉四角空白 */
  const applyFineRotate = async () => {
    if (fineRotate === 0) return;
    await bakeBase('应用拉直', '已拉直', (src, sw, sh) =>
      bakeFineRotate(bakeOrientation(src, sw, sh, rotate, flipH, flipV), fineRotate)
    );
  };

  /** 应用透视：四角围出的四边形拉直为矩形（角点相对原始底图归一化） */
  const applyPerspective = async () => {
    if (!perspMode) return;
    await bakeBase('透视校正', '已校正透视', (src) =>
      bakePerspective(
        src,
        perspPoints.map(([x, y]) => [x * src.width, y * src.height] as [number, number])
      )
    );
  };

  const toggleCropMode = () => {
    if (!baseSrc) return;
    if (mode === 'crop') {
      setMode('view');
      return;
    }
    if (fineRotate !== 0) {
      toast.info('存在拉直角度，请先点「应用拉直」再裁剪');
      return;
    }
    setCrop({ ...FULL_CROP });
    setAspect(null);
    setPerspMode(false);
    setSelectedIds([]);
    setMode('crop');
  };

  /** 选择裁剪比例（同时进入裁剪模式） */
  const pickAspect = (value: number | null) => {
    if (!baseSrc) return;
    if (fineRotate !== 0) {
      toast.info('存在拉直角度，请先点「应用拉直」再裁剪');
      return;
    }
    setAspect(value);
    setPerspMode(false);
    setMode('crop');
  };

  const startPerspective = () => {
    if (!baseSrc) return;
    if (perspMode) {
      setPerspMode(false);
      return;
    }
    if (fineRotate !== 0) {
      toast.info('存在拉直角度，请先点「应用拉直」再做透视校正');
      return;
    }
    setMode('view');
    setSelectedIds([]);
    setPerspPoints(DEFAULT_PERSPECTIVE.map((p) => [p[0], p[1]] as [number, number]));
    setPerspMode(true);
  };

  /** 导出：Konva 舞台 1:1 取图，预览与导出天然一致 */
  const handleDownload = () => {
    if (!baseSrc) {
      toast.info('请先选择图片');
      return;
    }
    setBusy(true);
    try {
      const canvas = canvasRef.current?.exportCanvas(2);
      if (!canvas) throw new Error('导出失败');
      const url = canvasToDataUrl(canvas, format, quality);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || 'image'}-konva.${ext}`;
      a.click();
      toast.success(`已导出 ${canvas.width} × ${canvas.height} · ${ext.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!baseSrc) return;
    setBusy(true);
    try {
      const canvas = canvasRef.current?.exportCanvas(2);
      if (!canvas) throw new Error('导出失败');
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('导出失败');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败，浏览器可能不支持剪贴板图片');
    } finally {
      setBusy(false);
    }
  };

  /** 绘制配置 */
  const drawConfig: DrawConfig = {
    tool,
    color,
    size: brushSize,
    opacity: markOpacity,
    shape: shapeKind,
    filled: shapeFilled,
    text: textValue,
    font,
    stroke: textStroke,
    bg: textBg,
    lineHeight,
    align,
    sticker,
    stickerSize
  };

  /** 新标注落成独立图层：命名去重、置顶、自动选中 */
  const commitMark = (mark: Mark) => {
    const id = idRef.current++;
    const label = MARK_MODE_LABEL[mark.mode];
    const layer = makeMarkLayer(id, uniqueName(layers, label), mark);
    pushHistory(`添加${label}`);
    setLayers((prev) => insertInto(prev, [layer], null));
    setSelectedIds([id]);
  };

  /** 切换绘制工具（再次点同一工具则退出） */
  const pickTool = (m: string) => {
    setTool((cur) => (cur === m ? 'none' : m));
    setMode('view');
  };

  /* ---------- 选中集合的批量操作（图层面板 / 画布共用） ---------- */

  /** 画布点选：additive = Shift / ⌘ / Ctrl 追加 */
  const selectLayer = (id: number | null, opts?: { additive?: boolean }) => {
    if (id === null) {
      setSelectedIds([]);
      return;
    }
    if (opts?.additive) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      return;
    }
    setSelectedIds([id]);
  };

  /** 画布交互回写：图片图层的位置 / 尺寸 / 旋转，标注图层的归一化模型 */
  const patchPhoto = (id: number, patch: Partial<PhotoLayer>) =>
    setLayers((prev) => updatePhoto(prev, id, patch));

  const patchMark = (id: number, mark: Mark) => setLayers((prev) => updateMark(prev, id, mark));

  const patchSelected = (ids: number[], patch: Partial<LayerBase>, label?: string) => {
    if (ids.length === 0) return;
    if (label) pushHistory(label);
    setLayers((prev) => patchLayers(prev, ids, patch));
  };

  const renameLayer = (id: number, name: string) => {
    if (!name.trim()) return;
    pushHistory('重命名图层');
    setLayers((prev) => patchLayer(prev, id, { name: name.trim() }));
  };

  /** 拖拽排序：把图层移到指定父级的指定下标 */
  const moveLayerTo = (id: number, parentId: number | null, index: number) => {
    pushHistory('调整图层顺序');
    setLayers((prev) => moveLayer(prev, id, parentId, index));
  };

  const zOrderSelected = (ids: number[], op: ZOrderOp) => {
    if (ids.length === 0) return;
    pushHistory({ front: '置于顶层', back: '置于底层', forward: '上移一层', backward: '下移一层' }[op]);
    setLayers((prev) => applyZOrder(prev, ids, op));
  };

  /** 复制：副本插在原图层正上方（同一父级内），与 Figma 一致 */
  const duplicateSelected = (ids: number[]) => {
    if (ids.length === 0) return;
    const tasks = ids
      .map((id) => ({ layer: findLayerDeep(layers, id), loc: findLocation(layers, id) }))
      .filter((t): t is { layer: CanvasLayer; loc: NonNullable<ReturnType<typeof findLocation>> } => !!t.layer && !!t.loc)
      .sort((a, b) => a.loc.index - b.loc.index);
    if (tasks.length === 0) return;
    const created: CanvasLayer[] = [];
    const offset = new Map<string, number>();
    let tree = layers;
    tasks.forEach((t) => {
      const parentId = t.loc.parent?.id ?? null;
      const key = String(parentId);
      const shift = offset.get(key) ?? 0;
      offset.set(key, shift + 1);
      const node = duplicateLayer(t.layer, () => idRef.current++);
      tree = insertInto(tree, [node], parentId, t.loc.index + 1 + shift);
      created.push(node);
    });
    pushHistory(`复制 ${created.length} 个图层`);
    setLayers(tree);
    setSelectedIds(created.map((l) => l.id));
    toast.success(`已复制 ${created.length} 个图层`);
  };

  /** 双击文本标注 → 在画布对应位置打开内联编辑 */
  const openTextEdit = (id: number) => {
    const layer = findLayerDeep(layers, id);
    if (!layer || !isMark(layer) || layer.mark.mode !== 'text') return;
    setTextEdit({ id, value: layer.mark.text });
  };

  const commitTextEdit = () => {
    if (!textEdit) return;
    const { id, value } = textEdit;
    setTextEdit(null);
    const layer = findLayerDeep(layers, id);
    if (!layer || !isMark(layer)) return;
    const mark = layer.mark;
    if (mark.mode !== 'text' || mark.text === value) return;
    pushHistory('编辑文本');
    setLayers((prev) => updateMark(prev, id, { ...mark, text: value }));
  };

  const removeLayersByIds = (ids: number[]) => {
    const targets = ids.filter((id) => id !== BASE_LAYER_ID);
    if (targets.length === 0) return;
    const label =
      targets.length === 1 ? findLayerDeep(layers, targets[0])?.name ?? '图层' : `${targets.length} 个图层`;
    pushHistory(`删除${label}`);
    setLayers((prev) => removeLayers(prev, targets));
    setSelectedIds((prev) => prev.filter((id) => !targets.includes(id)));
  };

  /** 编组 / 解组 */
  const groupSelected = (ids: number[]) => {
    if (ids.length === 0) return;
    const groupId = idRef.current++;
    const res = groupLayers(layers, ids, groupId, uniqueName(layers, '组'));
    if (res.groupId < 0) return;
    pushHistory('编组');
    setLayers(res.layers);
    setSelectedIds([res.groupId]);
    toast.success('已编组');
  };

  const ungroupSelected = (ids: number[]) => {
    const targets = ids.filter((id) => {
      const l = findLayerDeep(layers, id);
      return !!l && l.kind === 'group';
    });
    if (targets.length === 0) {
      toast.info('选中的图层里没有组');
      return;
    }
    const res = ungroupLayers(layers, targets);
    pushHistory('解组');
    setLayers(res.layers);
    setSelectedIds(res.released);
    toast.success('已解组');
  };

  const toggleCollapse = (id: number) =>
    setLayers((prev) =>
      prev.map(function visit(l): CanvasLayer {
        if (l.id === id && l.kind === 'group') return { ...l, collapsed: !l.collapsed };
        if (l.kind === 'group') return { ...l, children: l.children.map(visit) };
        return l;
      })
    );

  const removeSelected = () => {
    if (selectedIds.includes(BASE_LAYER_ID) && layerSelection.length === 0) {
      toast.info('底图不可删除，可用「底图转为图层」把它变成普通图层后再删除');
      return;
    }
    if (layerSelection.length === 0) return;
    removeLayersByIds(layerSelection);
  };

  /** 对齐：多个元素相对选区、单个元素相对画布 */
  const alignSelected = (ids: number[], mode: AlignMode) => {
    if (ids.length === 0) return;
    const label: Record<AlignMode, string> = {
      left: '左对齐',
      centerX: '水平居中对齐',
      right: '右对齐',
      top: '顶对齐',
      centerY: '垂直居中对齐',
      bottom: '底对齐'
    };
    pushHistory(label[mode]);
    setLayers((prev) => alignLayers(prev, ids, mode));
  };

  const distributeSelected = (ids: number[], axis: 'x' | 'y') => {
    if (ids.length < 3) return;
    pushHistory(axis === 'x' ? '水平等距分布' : '垂直等距分布');
    setLayers((prev) => distributeLayers(prev, ids, axis));
  };

  const centerSelected = (ids: number[], axis: 'x' | 'y') => {
    if (ids.length === 0) return;
    pushHistory(axis === 'x' ? '画布水平居中' : '画布垂直居中');
    setLayers((prev) => centerInCanvas(prev, ids, axis));
  };

  const fitSelected = (ids: number[]) => {
    if (ids.length === 0) return;
    pushHistory('适应画布');
    setLayers((prev) => fitToCanvas(prev, ids, baseSize));
  };

  /** 恢复原始比例（保持当前宽度，按原图宽高比改高度） */
  const resetAspectSelected = (ids: number[]) => {
    if (ids.length === 0) return;
    pushHistory('恢复原始比例');
    setLayers((prev) => resetAspect(prev, ids, baseSize));
  };

  const clearMarks = () => {
    if (markCount === 0) return;
    const ids: number[] = [];
    walk(layers, (l) => {
      if (l.kind === 'mark') ids.push(l.id);
    });
    pushHistory('清空标注');
    setLayers((prev) => removeLayers(prev, ids));
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    toast.success('已清空标注');
  };

  /** 应用滤镜预设 */
  const applyPreset = (id: string, strength = presetStrength) => {
    const preset = FILTER_PRESETS.find((p) => p.id === id) ?? FILTER_PRESETS[0];
    const k = Math.max(0, Math.min(1, strength / 100));
    pushHistory(`滤镜：${preset.name}`);
    setPresetId(id);
    setPresetStrength(strength);
    setAdjust(mixAdjust(DEFAULT_ADJUST, preset.adjust, k));
  };

  const setScale = (axis: 'x' | 'y', value: number) => {
    const v = Math.max(10, Math.min(300, Math.round(value)));
    pushHistory('调整尺寸');
    if (axis === 'x') {
      setScaleX(v);
      if (lockAspect) setScaleY(v);
    } else {
      setScaleY(v);
      if (lockAspect) setScaleX(v);
    }
  };

  // ---------- 快捷键 ----------
  const actionsRef = useRef<Record<string, (() => void) | undefined>>({});
  actionsRef.current = {
    open: () => fileRef.current?.click(),
    export: handleDownload,
    copy: () => void handleCopy(),
    undo,
    redo,
    resetAll,
    deleteSelected: removeSelected,
    duplicate: () => duplicateSelected(selectedIds),
    selectAll: () => setSelectedIds(layers.map((l) => l.id)),
    deselect: () => setSelectedIds([]),
    group: () => groupSelected(selectedIds.filter((id) => id !== BASE_LAYER_ID)),
    ungroup: () => ungroupSelected(selectedIds.filter((id) => id !== BASE_LAYER_ID)),
    rotateLeft: () => rotateBy(-90),
    rotateRight: () => rotateBy(90),
    flipH: () => {
      if (!baseSrc) return;
      pushHistory('水平翻转');
      setFlipH((v) => !v);
    },
    flipV: () => {
      if (!baseSrc) return;
      pushHistory('垂直翻转');
      setFlipV((v) => !v);
    },
    sizeUp: () => setScale('x', scaleX * 1.1),
    sizeDown: () => setScale('x', scaleX / 1.1),
    fitView: () => canvasRef.current?.resetView(),
    cropMode: toggleCropMode,
    applyCrop: () => {
      if (mode === 'crop') void applyCrop();
    },
    compare: () => setCompare(true),
    'compare:release': () => setCompare(false),
    toolSelect: () => pickTool('select'),
    toolBrush: () => pickTool('brush'),
    toolEraser: () => pickTool('eraser'),
    toolMosaic: () => pickTool('mosaic'),
    toolShape: () => pickTool('shape'),
    toolRect: () => pickTool('rect'),
    toolSticker: () => pickTool('sticker'),
    toolText: () => pickTool('text'),
    cancelTool: () => {
      if (perspMode) setPerspMode(false);
      else if (mode === 'crop') setMode('view');
      else if (tool !== 'none') setTool('none');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const node = e.target as HTMLElement | null;
      const typing = !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
      // 固定手势（不参与键位配置）：
      // ⌘/Ctrl + D 复制、⌘/Ctrl + A 全选、⌘/Ctrl + G 编组、⌘/Ctrl + ⇧ + G 解组
      if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyD' && !e.shiftKey) {
          e.preventDefault();
          actionsRef.current.duplicate?.();
          return;
        }
        if (e.code === 'KeyA' && !e.shiftKey) {
          e.preventDefault();
          actionsRef.current.selectAll?.();
          return;
        }
        if (e.code === 'KeyG') {
          e.preventDefault();
          if (e.shiftKey) actionsRef.current.ungroup?.();
          else actionsRef.current.group?.();
          return;
        }
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = resolveAction(combo, shortcutMap);
      if (!action) return;
      const hasMod = combo.includes('ctrl+') || combo.includes('meta+') || combo.includes('alt+');
      if (typing && !hasMod) return;
      const def = SHORTCUT_DEF_BY_ID[action];
      if (e.repeat && def?.kind !== 'repeat') {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      actionsRef.current[action]?.();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = resolveAction(combo, shortcutMap);
      if (action && SHORTCUT_DEF_BY_ID[action]?.kind === 'hold') {
        actionsRef.current[`${action}:release`]?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [shortcutMap]);

  // 粘贴导入
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) void addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const sc = (id: string) => formatCombo(shortcutMap[id] ?? null);
  const hasImage = !!baseSrc;
  const historyLabels = history.map((h) => h.label);
  const redoLabels = redoStack.map((r) => r.label);

  return (
    <div className="flex-1 overflow-auto bg-white text-zinc-800 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
      <div className="px-5 py-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {/* 顶部工具条 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-4 py-3 shadow-[0_6px_20px_-12px_rgba(124,58,237,0.45)] transition-shadow duration-300 hover:shadow-[0_10px_26px_-12px_rgba(124,58,237,0.5)] lg:shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 text-white shadow-md shadow-violet-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight text-zinc-900">
                Konva 图片编辑器
              </h2>
              <p className="text-xs text-violet-500">
                Konva 图层 + 逐帧插值动画 · 旋转 / 拉伸 / 调色 / 裁剪 / 标注 / 导出
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToolButton
              onClick={() => setShortcutOpen(true)}
              icon={Keyboard}
              title="查看与自定义快捷键"
            >
              快捷键
            </ToolButton>
            <ToolButton
              onClick={() => fileRef.current?.click()}
              icon={ImagePlus}
              title={`选择图片（${sc('open')}）`}
            >
              选择图片
            </ToolButton>
            <ToolButton onClick={undo} icon={Undo2} disabled={!hasImage || history.length === 0} title={`撤销（${sc('undo')}）`}>
              撤销
            </ToolButton>
            <ToolButton onClick={redo} icon={Redo2} disabled={!hasImage || redoStack.length === 0} title={`重做（${sc('redo')}）`}>
              重做
            </ToolButton>
            <ToolButton onClick={resetAll} icon={RotateCcw} disabled={!hasImage} title={`重置全部（${sc('resetAll')}）`}>
              重置
            </ToolButton>
            <ToolButton onClick={handleCopy} icon={ClipboardCopy} disabled={!hasImage || busy} title={`复制到剪贴板（${sc('copy')}）`}>
              复制
            </ToolButton>
            <ToolButton
              variant="primary"
              onClick={handleDownload}
              icon={Download}
              disabled={!hasImage || busy}
              title={`导出图片（${sc('export')}）`}
            >
              导出图片
            </ToolButton>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void addFiles(files);
            e.target.value = '';
          }}
        />

        <input
          ref={baseFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void replaceBaseFromFile(file);
            e.target.value = '';
          }}
        />

        <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
          {/* 预览区（大屏下位于右侧，独立滚动，不随左侧面板滚动） */}
          <div className="order-1 flex flex-col gap-6 lg:order-2 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <div
              className={cn(
                'relative h-[52vh] min-h-80 overflow-hidden rounded-2xl border bg-white shadow-[0_1px_26px_-16px_rgba(124,58,237,0.5)] transition-all duration-300 lg:h-auto lg:flex-1',
                dropActive
                  ? 'border-violet-300 bg-violet-50 shadow-[0_18px_40px_-16px_rgba(124,58,237,0.6)]'
                  : 'border-violet-100'
              )}
              style={{
                backgroundImage:
                  'linear-gradient(45deg,#faf5ff 25%,transparent 25%),linear-gradient(-45deg,#faf5ff 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#faf5ff 75%),linear-gradient(-45deg,transparent 75%,#faf5ff 75%)',
                backgroundSize: '18px 18px',
                backgroundPosition: '0 0,0 9px,9px -9px,-9px 0'
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropActive(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length) void addFiles(files);
              }}
            >
              <KonvaCanvas
                ref={canvasRef}
                baseSrc={baseSrc}
                baseSize={baseSize}
                originalSrc={originalSrc}
                rotate={rotate}
                fineRotate={fineRotate}
                flipH={flipH}
                flipV={flipV}
                scaleX={scaleX}
                scaleY={scaleY}
                adjust={adjust}
                layers={layers}
                selectedLayerIds={selectedIds}
                onSelectLayer={selectLayer}
                onLayerChange={patchPhoto}
                onMarkChange={patchMark}
                draw={drawConfig}
                compare={compare}
                cropMode={mode === 'crop'}
                crop={crop}
                aspect={aspect}
                onCropChange={setCrop}
                onMarkCommit={commitMark}
                perspectiveMode={perspMode}
                perspective={perspPoints}
                onPerspectiveChange={setPerspPoints}
                onViewChange={setViewZoom}
                onEditText={openTextEdit}
                onImageError={() => toast.error('底图解码失败，请重新导入该图片')}
                onBaseSizeMismatch={(w, h) => {
                  setBaseSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
                  setLayers((prev) => resetAspect(prev, collectPhotoIds(prev), { w, h }));
                  toast.info(`已按图片实际尺寸校正画布：${w} × ${h}`);
                }}
              />

              {markCount > 0 && (
                <div className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-violet-500 shadow-sm">
                  标注 {markCount} 笔
                </div>
              )}

              {hasImage && (
                <button
                  type="button"
                  onPointerDown={() => setCompare(true)}
                  onPointerUp={() => setCompare(false)}
                  onPointerLeave={() => setCompare(false)}
                  onPointerCancel={() => setCompare(false)}
                  className={cn(
                    'absolute left-3 bottom-3 rounded-full border px-3 py-1 text-[11px] font-medium backdrop-blur transition-colors',
                    compare
                      ? 'border-violet-300 bg-violet-500 text-white'
                      : 'border-violet-100 bg-white/90 text-violet-500 hover:border-violet-200 hover:bg-violet-50'
                  )}
                >
                  按住看原图（{sc('compare')}）
                </button>
              )}

              {!hasImage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100/80 text-violet-400">
                    <ImagePlus className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-700">
                      拖拽图片到这里，或点击「选择图片」
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">支持 PNG / JPG / WEBP / GIF，也可直接 Ctrl+V 粘贴</p>
                  </div>
                  <ToolButton variant="primary" onClick={() => fileRef.current?.click()} icon={ImagePlus}>
                    选择图片
                  </ToolButton>
                </div>
              )}

              {/* 文本内联编辑：双击画布上的文字标注后出现，Enter 换行、失焦保存、Esc 取消 */}
              {textEdit && editRect && (
                <textarea
                  autoFocus
                  value={textEdit.value}
                  onChange={(e) => setTextEdit({ id: textEdit.id, value: e.target.value })}
                  onBlur={commitTextEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setTextEdit(null);
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      commitTextEdit();
                    }
                  }}
                  className="absolute z-30 resize-none rounded-lg border-2 border-violet-400 bg-white/90 px-1.5 py-1 text-center leading-tight text-zinc-800 shadow-lg outline-none"
                  style={{
                    left: editRect.x,
                    top: editRect.y,
                    width: Math.max(90, editRect.width),
                    height: Math.max(30, editRect.height),
                    transform: `translate(-50%, -50%) rotate(${editRect.rotation}deg)`,
                    fontSize: editFontSize
                  }}
                />
              )}
            </div>

            {/* 状态条 */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-2 text-[11px] text-zinc-500 shadow-[0_4px_14px_-8px_rgba(124,58,237,0.4)] lg:shrink-0">
              <span>
                原始：
                <b className="text-violet-500">{hasImage ? `${baseSize.w} × ${baseSize.h}` : '--'}</b>
              </span>
              <span>
                输出：
                <b className="text-violet-500">{outW} × {outH}</b>
              </span>
              <span>
                拉伸 <b className="text-violet-500">{(scaleX / 100).toFixed(2)}x</b>
              </span>
              <span>
                视图 <b className="text-violet-500">{Math.round(viewZoom * 100)}%</b>
              </span>
              <span>
                旋转 <b className="text-violet-500">{(rotate + fineRotate).toFixed(1)}°</b>
              </span>
              {mode === 'crop' && (
                <span className="text-violet-500">
                  裁剪框 {(crop.w * 100).toFixed(0)}% × {(crop.h * 100).toFixed(0)}%
                </span>
              )}
              <span>
                图层 <b className="text-violet-500">{photoCount}</b>
              </span>
              <span>
                标注 <b className="text-violet-500">{markCount}</b>
              </span>
              <span>
                选中 <b className="text-violet-500">{selectedLabel}</b>
              </span>
            </div>
          </div>

          {/* 操作面板（大屏下位于左侧，超出可视高度时自身滚动） */}
          <div className="order-2 flex flex-col gap-3 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <Section
              id="draw"
              title="涂抹 / 标注"
              icon={Paintbrush}
              action={
                <button
                  type="button"
                  onClick={clearMarks}
                  className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-500 transition-colors hover:border-violet-300 hover:bg-violet-100 hover:text-violet-600"
                >
                  清空
                </button>
              }
            >
              <div className="grid grid-cols-2 gap-2">
                {DRAW_TOOLS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <ToolButton
                      key={t.mode}
                      onClick={() => pickTool(t.mode)}
                      icon={Icon}
                      active={tool === t.mode}
                      disabled={!hasImage}
                      block
                      title={t.label}
                    >
                      {t.label}
                    </ToolButton>
                  );
                })}
              </div>

              {tool !== 'none' && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-500">颜色</span>
                    <div className="flex flex-1 flex-wrap items-center gap-1">
                      {MARK_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`颜色 ${c}`}
                          onClick={() => setColor(c)}
                          className={cn(
                            'h-5 w-5 rounded-full border transition-transform duration-200',
                            color === c
                              ? 'scale-110 border-violet-400 ring-1 ring-violet-200'
                              : 'border-violet-100 hover:scale-110'
                          )}
                          style={{ background: c }}
                        />
                      ))}
                      <label className="relative ml-1 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-violet-200 bg-white text-[9px] text-violet-400">
                        +
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                    </div>
                  </div>

                  {tool === 'shape' && (
                    <div className="flex flex-wrap gap-1.5">
                      {SHAPE_KINDS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setShapeKind(s.id)}
                          className={chipClass(shapeKind === s.id)}
                        >
                          {s.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShapeFilled((v) => !v)}
                        className={chipClass(shapeFilled)}
                      >
                        {shapeFilled ? '填充' : '描边'}
                      </button>
                    </div>
                  )}

                  {tool === 'sticker' && (
                    <>
                      <div className="grid grid-cols-6 gap-1.5">
                        {STICKER_ICONS.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSticker(s.id)}
                            title={s.name}
                            className={cn(
                              'flex h-7 items-center justify-center rounded-lg border text-xs transition-all',
                              sticker === s.id
                                ? 'border-violet-300 bg-violet-100 text-violet-600'
                                : 'border-violet-200 bg-violet-50 text-violet-400 hover:border-violet-300'
                            )}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-6 gap-1.5">
                        {STICKER_EMOJI.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => setSticker(`e:${e}`)}
                            className={cn(
                              'flex h-7 items-center justify-center rounded-lg border text-base leading-none transition-all',
                              sticker === `e:${e}`
                                ? 'border-violet-300 bg-violet-100'
                                : 'border-violet-200 bg-violet-50 hover:border-violet-300'
                            )}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <RangeRow
                        label="贴纸大小"
                        value={stickerSize}
                        min={4}
                        max={40}
                        suffix="%"
                        onChange={setStickerSize}
                        onReset={() => setStickerSize(12)}
                      />
                    </>
                  )}

                  {tool === 'text' && (
                    <>
                      <textarea
                        value={textValue}
                        onChange={(e) => setTextValue(e.target.value)}
                        placeholder="输入文字后点击画面放置"
                        rows={2}
                        className="w-full resize-none rounded-lg border border-violet-100 bg-white px-2 py-1.5 text-xs text-zinc-600 outline-none transition-colors focus:border-violet-300"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {(['sans', 'serif', 'mono'] as FontKind[]).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setFont(f)}
                            className={chipClass(font === f)}
                          >
                            {f === 'sans' ? '无衬线' : f === 'serif' ? '衬线' : '等宽'}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setTextStroke((v) => !v)}
                          className={chipClass(textStroke)}
                        >
                          描边
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-500">背景</span>
                        <div className="flex flex-1 flex-wrap gap-1">
                          {['none', '#111827', '#ffffff', '#8b5cf6', '#ef4444', '#22c55e'].map((c) => (
                            <button
                              key={c}
                              type="button"
                              title={c === 'none' ? '无背景' : c}
                              onClick={() => setTextBg(c === 'none' ? null : c)}
                              className={cn(
                                'h-5 w-5 rounded border transition-transform hover:scale-110',
                                (textBg ?? 'none') === c
                                  ? 'border-violet-500 ring-2 ring-violet-200'
                                  : 'border-violet-200'
                              )}
                              style={{
                                background: c === 'none' ? 'transparent' : c,
                                backgroundImage:
                                  c === 'none'
                                    ? 'linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%)'
                                    : undefined,
                                backgroundSize: '8px 8px',
                                backgroundPosition: '0 0,4px 4px'
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {(['left', 'center', 'right'] as TextAlignKind[]).map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setAlign(a)}
                            className={cn('flex-1', chipClass(align === a))}
                          >
                            {a === 'left' ? '左对齐' : a === 'center' ? '居中' : '右对齐'}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <RangeRow
                    label={
                      tool === 'rect'
                        ? '圆角'
                        : tool === 'shape'
                          ? '线条粗细'
                          : tool === 'text'
                            ? '字号'
                            : tool === 'sticker'
                              ? '贴纸大小'
                              : '笔宽'
                    }
                    value={brushSize}
                    min={0.2}
                    max={10}
                    step={0.2}
                    decimals={1}
                    onChange={setBrushSize}
                    onReset={() => setBrushSize(1.6)}
                  />
                  {tool !== 'text' && tool !== 'sticker' && (
                    <RangeRow
                      label="不透明度"
                      value={markOpacity}
                      min={10}
                      max={100}
                      suffix="%"
                      onChange={setMarkOpacity}
                      onReset={() => setMarkOpacity(100)}
                    />
                  )}

                  <ToolButton
                    onClick={removeSelected}
                    icon={Trash2}
                    disabled={layerSelection.length === 0}
                    block
                    title="删除选中的图层（Delete）"
                  >
                    删除选中{layerSelection.length > 1 ? `（${layerSelection.length}）` : ''}
                  </ToolButton>
                </>
              )}
            </Section>

            <Section id="transform" title="变换" icon={RotateCw}>
              <div className="grid grid-cols-2 gap-2">
                <ToolButton
                  onClick={() => rotateBy(-90)}
                  icon={RotateCcw}
                  disabled={!hasImage}
                  block
                  title={`左转 90°（${sc('rotateLeft')}）`}
                >
                  左转 90°
                </ToolButton>
                <ToolButton
                  onClick={() => rotateBy(90)}
                  icon={RotateCw}
                  disabled={!hasImage}
                  block
                  title={`右转 90°（${sc('rotateRight')}）`}
                >
                  右转 90°
                </ToolButton>
                <ToolButton
                  onClick={() => {
                    if (!hasImage) return;
                    pushHistory('水平翻转');
                    setFlipH((v) => !v);
                  }}
                  icon={FlipHorizontal2}
                  disabled={!hasImage}
                  active={flipH}
                  block
                  title={`水平翻转（${sc('flipH')}）`}
                >
                  水平翻转
                </ToolButton>
                <ToolButton
                  onClick={() => {
                    if (!hasImage) return;
                    pushHistory('垂直翻转');
                    setFlipV((v) => !v);
                  }}
                  icon={FlipVertical2}
                  disabled={!hasImage}
                  active={flipV}
                  block
                  title={`垂直翻转（${sc('flipV')}）`}
                >
                  垂直翻转
                </ToolButton>
              </div>
              <RangeRow
                label="拉直角度"
                value={fineRotate}
                min={-45}
                max={45}
                step={0.5}
                decimals={1}
                suffix="°"
                disabled={!hasImage}
                onReset={() => setFineRotate(0)}
                onChange={setFineRotate}
              />
              {fineRotate !== 0 && (
                <>
                  <ToolButton
                    onClick={() => void applyFineRotate()}
                    icon={RotateCw}
                    disabled={!hasImage || busy}
                    block
                  >
                    应用拉直（裁掉空白角）
                  </ToolButton>
                  <p className="text-[10px] leading-relaxed text-zinc-400">
                    拉直状态下裁剪与元素编辑暂不可用；点上方按钮可直接烘焙进底图。
                  </p>
                </>
              )}
            </Section>

            <Section
              id="stretch"
              title="拉伸 / 尺寸"
              icon={Move}
              action={
                <button
                  type="button"
                  onClick={() => setLockAspect((v) => !v)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    lockAspect
                      ? 'border-violet-200 bg-violet-100 text-violet-500'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-400'
                  )}
                >
                  {lockAspect ? <Link2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
                  {lockAspect ? '等比' : '自由'}
                </button>
              }
            >
              <RangeRow
                label="宽度"
                value={scaleX}
                min={10}
                max={300}
                suffix="%"
                disabled={!hasImage}
                onChange={(v) => setScale('x', v)}
                onReset={() => setScale('x', 100)}
              />
              <RangeRow
                label="高度"
                value={scaleY}
                min={10}
                max={300}
                suffix="%"
                disabled={!hasImage}
                onChange={(v) => setScale('y', v)}
                onReset={() => setScale('y', 100)}
              />
              <div className="grid grid-cols-2 gap-2">
                <ToolButton
                  onClick={() => {
                    pushHistory('尺寸复位');
                    setScaleX(100);
                    setScaleY(100);
                  }}
                  icon={Maximize}
                  disabled={!hasImage}
                  block
                >
                  尺寸 100%
                </ToolButton>
                <ToolButton
                  onClick={() => canvasRef.current?.resetView()}
                  icon={Frame}
                  disabled={!hasImage}
                  block
                  title={`视图复位 / 适应窗口（${sc('fitView')}）`}
                >
                  视图复位
                </ToolButton>
              </div>
              <ToolButton
                onClick={() => resetAspectSelected(photoSelection)}
                icon={Maximize2}
                disabled={photoSelection.length === 0}
                block
                title="按原图宽高比恢复图层高度（保持当前宽度）"
              >
                恢复原始比例
              </ToolButton>
            </Section>

            <Section id="crop" title="裁剪" icon={Crop}>
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => pickAspect(p.value)}
                    className={chipClass(aspect === p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ToolButton
                  onClick={toggleCropMode}
                  icon={mode === 'crop' ? X : Crop}
                  disabled={!hasImage}
                  active={mode === 'crop'}
                  block
                  title={`${mode === 'crop' ? '退出裁剪' : '开始裁剪'}（${sc('cropMode')}）`}
                >
                  {mode === 'crop' ? '退出裁剪' : '开始裁剪'}
                </ToolButton>
                <ToolButton
                  onClick={() => void applyCrop()}
                  icon={Check}
                  variant="primary"
                  disabled={!hasImage || mode !== 'crop' || busy}
                  block
                  title={`应用裁剪（${sc('applyCrop')}）`}
                >
                  {busy ? '处理中…' : '应用裁剪'}
                </ToolButton>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ToolButton
                  onClick={startPerspective}
                  icon={Frame}
                  active={perspMode}
                  disabled={!hasImage}
                  block
                >
                  {perspMode ? '退出透视' : '透视校正'}
                </ToolButton>
                <ToolButton
                  onClick={() => void applyPerspective()}
                  icon={Check}
                  variant="primary"
                  disabled={!perspMode || busy}
                  block
                >
                  {busy ? '处理中…' : '应用透视'}
                </ToolButton>
              </div>
            </Section>

            <Section
              id="adjust"
              title="调整"
              icon={SlidersHorizontal}
              action={<ResetChip onClick={() => setAdjust({ ...DEFAULT_ADJUST })} />}
            >
              <div className="flex flex-wrap gap-1.5">
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    className={chipClass(presetId === p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {presetId !== 'none' && (
                <RangeRow
                  label="滤镜强度"
                  value={presetStrength}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(v) => applyPreset(presetId, v)}
                  onReset={() => applyPreset(presetId, 100)}
                />
              )}
              {(
                [
                  ['brightness', '亮度', 50, 150, '%', 0],
                  ['contrast', '对比度', 50, 150, '%', 0],
                  ['saturate', '饱和度', 0, 200, '%', 0],
                  ['hue', '色相', -180, 180, '°', 0],
                  ['blur', '模糊', 0, 20, 'px', 1],
                  ['grayscale', '灰度', 0, 100, '%', 0],
                  ['sepia', '复古', 0, 100, '%', 0],
                  ['invert', '反色', 0, 100, '%', 0],
                  ['vignette', '暗角', 0, 100, '%', 0]
                ] as [keyof AdjustParams, string, number, number, string, number][]
              ).map(([key, label, min, max, suffix, decimals]) => (
                <RangeRow
                  key={key}
                  label={label}
                  value={adjust[key]}
                  min={min}
                  max={max}
                  suffix={suffix}
                  decimals={decimals}
                  disabled={!hasImage}
                  onChange={(v) => setAdjust((a) => ({ ...a, [key]: v }))}
                  onReset={() => setAdjust((a) => ({ ...a, [key]: DEFAULT_ADJUST[key] }))}
                />
              ))}
            </Section>

            <Section
              id="layers"
              title="图库 / 图层"
              icon={Images}
              action={
                library.length > 0 ? (
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-500">
                    {library.length} 张
                  </span>
                ) : undefined
              }
            >
              {library.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  一次选择 / 拖入多张图片：第 1 张作为底图，其余自动放到画布上共存，可拖动 / 缩放 / 旋转。
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {library.map((item, i) => (
                    <div
                      key={`${item.name}-${i}`}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-violet-100 bg-violet-50 transition-colors hover:border-violet-300"
                    >
                      <button
                        type="button"
                        onClick={() => void addLibraryToCanvas(item)}
                        title={`${item.name}｜点击添加到画布（新图层）`}
                        className="absolute inset-0"
                      >
                        <img src={item.src} alt={item.name} className="h-full w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void addLibraryToCanvas(item);
                        }}
                        title="添加到画布（新图层）"
                        className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full border border-violet-200 bg-white/90 text-violet-500 opacity-0 transition-opacity hover:bg-violet-50 group-hover:opacity-100"
                      >
                        <ImagePlus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void applyAsBase(item.src, item.name);
                        }}
                        title="设为底图（保留画布上的图层）"
                        className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full border border-violet-200 bg-white/90 text-violet-500 opacity-0 transition-opacity hover:bg-violet-50 group-hover:opacity-100"
                      >
                        <ArrowUpToLine className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLibraryItem(i);
                        }}
                        title="从图库移除"
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-rose-200 bg-white/90 text-rose-500 opacity-0 transition-opacity hover:bg-rose-50 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <LayerPanel
                layers={layers}
                selectedIds={selectedIds}
                base={{ src: baseSrc, w: baseSize.w, h: baseSize.h }}
                onSelect={selectLayer}
                onSelectMany={setSelectedIds}
                onMove={moveLayerTo}
                onRename={renameLayer}
                onPatch={(ids, patch) => patchSelected(ids, patch)}
                onToggleCollapse={toggleCollapse}
                onZOrder={zOrderSelected}
                onDuplicate={duplicateSelected}
                onRemove={removeLayersByIds}
                onGroup={groupSelected}
                onUngroup={ungroupSelected}
                onAlign={alignSelected}
                onDistribute={distributeSelected}
                onCenterCanvas={centerSelected}
                onFit={fitSelected}
                onReplaceBase={() => baseFileRef.current?.click()}
                onBaseToLayer={() => void baseToLayer()}
                onPromoteToBase={() => void promoteToBase(photoSelection[0])}
                selectedPhotoCount={photoSelection.length}
              />
            </Section>

            <Section id="export" title="导出" icon={Save}>
              <div className="grid grid-cols-3 gap-1.5">
                {(['png', 'jpeg', 'webp'] as ExportFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={cn(
                      'rounded-lg border px-2 py-1.5 text-[11px] uppercase transition-all duration-200',
                      format === f
                        ? 'border-violet-300 bg-violet-500 text-white shadow-sm shadow-violet-200'
                        : 'border-violet-200 bg-violet-50 text-violet-500 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-600'
                    )}
                  >
                    {f === 'jpeg' ? 'jpg' : f}
                  </button>
                ))}
              </div>
              {format !== 'png' && (
                <RangeRow
                  label="质量"
                  value={Math.round(quality * 100)}
                  min={40}
                  max={100}
                  suffix="%"
                  onChange={(v) => setQuality(v / 100)}
                  onReset={() => setQuality(0.92)}
                />
              )}
              <div className="flex items-center gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] text-zinc-500">
                <span className="text-violet-500">文件名</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="image"
                  className="min-w-0 flex-1 rounded-md border border-violet-100 bg-white px-2 py-1 text-zinc-600 outline-none transition-colors focus:border-violet-300"
                />
                <span className="text-zinc-400">.{format === 'jpeg' ? 'jpg' : format}</span>
              </div>
              <ToolButton
                variant="primary"
                onClick={handleDownload}
                icon={Download}
                disabled={!hasImage || busy}
                block
              >
                {busy ? '处理中…' : `下载 ${outW * 2} × ${outH * 2}`}
              </ToolButton>
              <p className="text-[10px] leading-relaxed text-zinc-400">
                导出走 Konva 舞台 1:1 取图（2x 像素密度），预览与导出使用同一份图层与滤镜参数，不会出现位置偏差。
              </p>
            </Section>

            <Section id="history" title="历史步骤" icon={History}>
              {historyLabels.length === 0 ? (
                <p className="text-[11px] text-zinc-400">
                  暂无记录：旋转、翻转、裁剪、拉直、重置等操作会记录在这里，点击可回退到该步之前。
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {historyLabels.map((label, i) => (
                    <button
                      key={`${label}-${i}`}
                      type="button"
                      onClick={() => undoToStep(i)}
                      className="flex items-center justify-between rounded-lg border border-violet-100 bg-violet-50/50 px-2 py-1 text-[11px] text-violet-600 transition-colors hover:border-violet-300 hover:bg-violet-100"
                    >
                      <span className="truncate">{label}</span>
                      <span className="ml-2 shrink-0 text-zinc-400">回退</span>
                    </button>
                  ))}
                  {redoLabels.length > 0 && (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      已撤销：{redoLabels.join('、')}（可用「重做」恢复）
                    </p>
                  )}
                </div>
              )}
            </Section>

            <p className="px-1 text-[11px] leading-relaxed text-zinc-400">
              快捷键：{sc('open')} 打开图片，{sc('export')} 导出，{sc('undo')} / {sc('redo')} 撤销重做，
              {sc('cropMode')} 裁剪（{sc('applyCrop')} 应用），{sc('compare')} 按住看原图，
              {sc('cancelTool')} 退出工具；Ctrl / ⌘ + 滚轮调整视图，双击画面复位视图。
              全部键位可在顶部「快捷键」中自定义。
            </p>
          </div>
        </div>
      </div>

      {/* 快捷键设置 */}
      <ShortcutSettingsDialog
        open={shortcutOpen}
        value={shortcutMap}
        onClose={() => setShortcutOpen(false)}
        onSave={(map) => {
          setShortcutMap(map);
          saveShortcutMap(map);
          toast.success('快捷键已保存');
        }}
      />
    </div>
  );
}
