import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from 'react';
import Konva from 'konva';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { Circle, Group, Layer, Line, Shape, Stage, Transformer } from 'react-konva';
import {
  approach,
  buildMosaicSource,
  filterCss,
  markBounds,
  orientedSize,
  paintMarks,
  scaleMark,
  translateMark,
  type AdjustParams,
  type CropRect,
  type FontKind,
  type Mark,
  type ShapeKind,
  type TextAlignKind
} from '@pmp/image-kit';
import { ImageCropOverlay } from '@pmp/image-kit';
import {
  ancestorsOf,
  BASE_LAYER_ID,
  collectSnapTargets,
  findLayerDeep,
  isGroup,
  isMark,
  isPhoto,
  layerBounds,
  leavesOf,
  snapBounds,
  type CanvasLayer,
  type PhotoLayer,
  type SnapGuide
} from '../lib/layer-model';

export interface DrawConfig {
  tool: string;
  color: string;
  size: number;
  opacity: number;
  shape: ShapeKind;
  filled: boolean;
  text: string;
  font: FontKind;
  stroke: boolean;
  bg: string | null;
  lineHeight: number;
  align: TextAlignKind;
  sticker: string;
  stickerSize: number;
}

export interface KonvaCanvasHandle {
  /** 导出为 1:1 画布（不含选中框），供页面做水印 / 尺寸 / 压缩 */
  exportCanvas: (pixelRatio: number) => HTMLCanvasElement | null;
  /** 把归一化坐标转成容器坐标，供外部覆盖层定位 */
  normToClient: (x: number, y: number) => { x: number; y: number } | null;
  /** 视图缩放（0.2 ~ 8 倍，仅影响预览） */
  zoomBy: (factor: number) => void;
  /** 视图复位 / 适应窗口 */
  resetView: () => void;
  /** 图层在容器中的屏幕矩形（供文字内联编辑的浮层定位） */
  layerScreenRect: (id: number) =>
    | { x: number; y: number; width: number; height: number; rotation: number; scale: number }
    | null;
}

export interface KonvaCanvasProps {
  ref?: Ref<KonvaCanvasHandle>;
  baseSrc: string | null;
  /** 直接以画布作底图（优先于 baseSrc）：用于美颜等逐像素预处理后的底图，免去来回编解码 */
  baseCanvas?: HTMLCanvasElement | null;
  baseSize: { w: number; h: number };
  originalSrc: string | null;
  /** 直接以画布作「原图」对比层 */
  originalCanvas?: HTMLCanvasElement | null;
  rotate: number;
  fineRotate: number;
  flipH: boolean;
  flipV: boolean;
  scaleX: number;
  scaleY: number;
  adjust: AdjustParams;
  layers: CanvasLayer[];
  /** 选中集合（多选）；BASE_LAYER_ID 表示选中底图 */
  selectedLayerIds: number[];
  /** additive = 按住 Shift / ⌘ / Ctrl 追加选择 */
  onSelectLayer: (id: number | null, opts?: { additive?: boolean }) => void;
  onLayerChange: (id: number, patch: Partial<PhotoLayer>) => void;
  onMarkChange: (id: number, mark: Mark) => void;
  draw: DrawConfig;
  compare: boolean;
  cropMode: boolean;
  crop: CropRect;
  aspect: number | null;
  onCropChange: (c: CropRect) => void;
  onMarkCommit: (mark: Mark) => void;
  /** 透视校正模式：四角可拖拽 */
  perspectiveMode: boolean;
  perspective: [number, number][];
  onPerspectiveChange: (points: [number, number][]) => void;
  /** 视图缩放变化回调（供页面状态条展示） */
  onViewChange?: (zoom: number) => void;
  /** 双击文本标注：请求页面打开内联文本编辑 */
  onEditText?: (id: number) => void;
  /** 底图 / 原图位图解码失败回调（源变了但位图没跟上时用于提示） */
  onImageError?: () => void;
  /** 底图位图真实尺寸与画布尺寸不一致时回调（用于自动校正画布尺寸） */
  onBaseSizeMismatch?: (w: number, h: number) => void;
  /** 拖动时的吸附（默认开启） */
  snapping?: boolean;
}

interface AnimState {
  rotate: number;
  flipH: number;
  flipV: number;
  scaleX: number;
  scaleY: number;
  appear: number;
  adjust: AdjustParams;
}

const MARK_TOOLS = ['brush', 'eraser', 'mosaic', 'rect', 'shape', 'text', 'sticker'];

/* ---------- 擦拭：把底图按笔迹形状「贴回来」 ----------
 * 底图与图层现在共用一个画布（混合模式才能和底图正确混色），
 * 因此擦拭不能再简单用 destination-out（会把底图画穿），而是：
 *   1. 用笔迹形状做遮罩，先把该区域的现有内容擦掉（含底图）；
 *   2. 再把「底图 ∩ 笔迹」重新贴回去（含滤镜与暗角，保证与周围像素一致）。
 */
const eraserCanvases: { mask: HTMLCanvasElement | null; patch: HTMLCanvasElement | null } = {
  mask: null,
  patch: null
};

function ensureCanvas(which: 'mask' | 'patch', w: number, h: number) {
  let canvas = eraserCanvases[which];
  if (!canvas) {
    canvas = document.createElement('canvas');
    eraserCanvases[which] = canvas;
  }
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  return canvas;
}

/** 在遮罩画布上描出笔迹（白色） */
function strokeToMask(
  canvas: HTMLCanvasElement,
  points: { x: number; y: number }[],
  width: number,
  height: number,
  lineWidth: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, lineWidth);
  ctx.beginPath();
  if (points.length === 1) {
    ctx.arc(points[0].x * width, points[0].y * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return ctx;
  }
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x * width, points[i].y * height);
  ctx.stroke();
  return ctx;
}

function paintEraser(
  ctx: CanvasRenderingContext2D,
  mark: { points: { x: number; y: number }[]; size: number; opacity: number },
  width: number,
  height: number,
  base: CanvasImageSource | null,
  filter: string | null,
  vignette: number
) {
  if (!base) return;
  const lineWidth = Math.max(1, mark.size * width);
  // 1) 擦掉该区域的现有内容（含底图）
  const mask = ensureCanvas('mask', width, height);
  if (!strokeToMask(mask, mark.points, width, height, lineWidth)) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0, width, height);
  ctx.restore();

  // 2) 重新贴回「底图 ∩ 笔迹」（带滤镜与暗角）
  const patch = ensureCanvas('patch', width, height);
  const pc = strokeToMask(patch, mark.points, width, height, lineWidth);
  if (!pc) return;
  pc.globalCompositeOperation = 'source-in';
  if (filter) pc.filter = filter;
  pc.drawImage(base, 0, 0, patch.width, patch.height);
  pc.filter = 'none';
  if (vignette > 0) {
    // 暗角也按笔迹取交集后叠回，避免擦除区域比周围亮
    const vc = strokeToMask(mask, mark.points, width, height, lineWidth);
    if (vc) {
      vc.globalCompositeOperation = 'source-in';
      const grad = vc.createRadialGradient(
        mask.width / 2,
        mask.height / 2,
        (Math.min(mask.width, mask.height) / 2) * 0.35,
        mask.width / 2,
        mask.height / 2,
        Math.hypot(mask.width, mask.height) / 2
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${(0.85 * vignette) / 100})`);
      vc.fillStyle = grad;
      vc.fillRect(0, 0, mask.width, mask.height);
      pc.globalCompositeOperation = 'source-over';
      pc.drawImage(mask, 0, 0, patch.width, patch.height);
    }
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, mark.opacity));
  ctx.drawImage(patch, 0, 0, width, height);
  ctx.restore();
}

const DEFAULT_PERSPECTIVE: [number, number][] = [
  [0.06, 0.06],
  [0.94, 0.06],
  [0.94, 0.94],
  [0.06, 0.94]
];

/** 取位图的真实像素尺寸：图片用 naturalWidth，画布用 width */
function bitmapSize(img: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return { w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 };
  }
  const c = img as HTMLCanvasElement;
  return { w: c.width || 0, h: c.height || 0 };
}

export function KonvaCanvas({
  ref,
  baseSrc,
  baseCanvas = null,
  baseSize,
  originalSrc,
  originalCanvas = null,
  rotate,
  fineRotate,
  flipH,
  flipV,
  scaleX,
  scaleY,
  adjust,
  layers,
  selectedLayerIds,
  onSelectLayer,
  onLayerChange,
  onMarkChange,
  draw,
  compare,
  cropMode,
  crop,
  aspect,
  onCropChange,
  onMarkCommit,
  perspectiveMode,
  perspective,
  onPerspectiveChange,
  onViewChange,
  onEditText,
  onImageError,
  onBaseSizeMismatch,
  snapping = true
}: KonvaCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const overlayRef = useRef<Konva.Layer>(null);
  /** 底图与所有图层所在的 Group（同一画布，混合模式才能与底图正确混色） */
  const groupRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const animRef = useRef<AnimState | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const draftRef = useRef<Mark | null>(null);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);
  /** 已成功解码的 src：只有与当前 baseSrc 一致时底图才允许绘制 */
  const [baseImgSrc, setBaseImgSrc] = useState<string | null>(null);
  const [originalImg, setOriginalImg] = useState<HTMLImageElement | null>(null);
  const [originalImgSrc, setOriginalImgSrc] = useState<string | null>(null);
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({});
  const [draft, setDraft] = useState<Mark | null>(null);
  const [viewZoom, setViewZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState<SnapGuide[]>([]);

  /** 用 ref 持有回调，避免回调引用变化导致底图被重复解码 */
  const onImageErrorRef = useRef(onImageError);
  onImageErrorRef.current = onImageError;
  const onBaseSizeMismatchRef = useRef(onBaseSizeMismatch);
  onBaseSizeMismatchRef.current = onBaseSizeMismatch;

  const oriented = useMemo(
    () => orientedSize(baseSize.w || 1, baseSize.h || 1, rotate as 0 | 90 | 180 | 270),
    [baseSize.w, baseSize.h, rotate]
  );
  const canvasW = Math.max(1, oriented.w * (scaleX / 100));
  const canvasH = Math.max(1, oriented.h * (scaleY / 100));

  useEffect(() => {
    if (!baseSrc) {
      setBaseImg(null);
      setBaseImgSrc(null);
      return;
    }
    const el = new window.Image();
    el.onload = () => {
      setBaseImg(el);
      setBaseImgSrc(baseSrc);
    };
    // 解码失败：必须清掉旧位图，否则会用旧图去填新的画布尺寸 → 底图被拉伸变形且无法恢复
    el.onerror = () => {
      setBaseImg(null);
      setBaseImgSrc(baseSrc);
      onImageErrorRef.current?.();
    };
    el.src = baseSrc;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [baseSrc]);

  useEffect(() => {
    if (!originalSrc) {
      setOriginalImg(null);
      setOriginalImgSrc(null);
      return;
    }
    const el = new window.Image();
    el.onload = () => {
      setOriginalImg(el);
      setOriginalImgSrc(originalSrc);
    };
    el.onerror = () => {
      setOriginalImg(null);
      setOriginalImgSrc(originalSrc);
    };
    el.src = originalSrc;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [originalSrc]);

  /**
   * 底图 / 原图位图是否可用（尺寸变动期间绝不画旧图）。
   * 画布模式下由外部直接给定位图，无需解码对齐。
   */
  const baseReady = baseCanvas ? true : !!baseImg && baseImgSrc === baseSrc;
  const originalReady = originalCanvas ? true : !!originalImg && originalImgSrc === originalSrc;
  /** 实际参与绘制的底图 / 原图 */
  const baseBitmap: CanvasImageSource | null = baseCanvas ?? (baseReady ? baseImg : null);
  const originalBitmap: CanvasImageSource | null =
    originalCanvas ?? (originalReady ? originalImg : null);

  /** 自愈：位图真实尺寸与画布尺寸不一致时通知页面校正，避免出现拉伸变形的死状态 */
  useEffect(() => {
    if (baseCanvas || !baseReady || !baseImg) return;
    const nw = baseImg.naturalWidth;
    const nh = baseImg.naturalHeight;
    if (nw < 1 || nh < 1 || baseSize.w < 1 || baseSize.h < 1) return;
    if (Math.abs(nw - baseSize.w) > 1 || Math.abs(nh - baseSize.h) > 1) {
      onBaseSizeMismatchRef.current?.(nw, nh);
    }
  }, [baseCanvas, baseReady, baseImg, baseSize.w, baseSize.h]);

  /** 马赛克笔刷的像素化源图（由底图生成，绘制时按笔迹遮罩贴回） */
  const mosaicSource = useMemo(
    () => (baseBitmap ? buildMosaicSource(baseBitmap) : null),
    [baseBitmap]
  );

  /** 懒加载所有图片类图层的位图 */
  useEffect(() => {
    const need = layers.filter((l) => l.kind === 'photo' && !imgs[l.src]);
    if (need.length === 0) return;
    let alive = true;
    need.forEach((l) => {
      if (l.kind !== 'photo') return;
      const el = new window.Image();
      el.onload = () => {
        if (!alive) return;
        setImgs((prev) => ({ ...prev, [l.src]: el }));
      };
      el.src = l.src;
    });
    return () => {
      alive = false;
    };
  }, [layers, imgs]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!box.w || !box.h) return 0;
    return Math.min(box.w / canvasW, box.h / canvasH, 3.2);
  }, [box.w, box.h, canvasW, canvasH]);

  const applyViewport = () => {
    const stage = stageRef.current;
    if (!stage || !fit) return;
    stage.width(box.w);
    stage.height(box.h);
    stage.scale({ x: fit * viewZoom, y: fit * viewZoom });
    stage.position({
      x: (box.w - canvasW * fit * viewZoom) / 2 + offset.x,
      y: (box.h - canvasH * fit * viewZoom) / 2 + offset.y
    });
  };

  useEffect(applyViewport, [box.w, box.h, fit, viewZoom, offset.x, offset.y, canvasW, canvasH]);

  /** ---------- 逐帧插值动画（底图与图层共用一个变换） ---------- */
  useEffect(() => {
    const layer = groupRef.current?.getLayer();
    if (!layer) return;
    const state = animRef.current ?? {
      rotate: 0,
      flipH: flipH ? -1 : 1,
      flipV: flipV ? -1 : 1,
      scaleX,
      scaleY,
      appear: 0,
      adjust: { ...adjust }
    };
    animRef.current = state;
    let last = performance.now();
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const dt = Math.min(0.05, (frame.time - last) / 1000);
      last = frame.time;
      let diff = rotate + fineRotate - state.rotate;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      state.rotate = approach(state.rotate, state.rotate + diff, 9, dt);
      state.flipH = approach(state.flipH, flipH ? -1 : 1, 11, dt);
      state.flipV = approach(state.flipV, flipV ? -1 : 1, 11, dt);
      state.scaleX = approach(state.scaleX, scaleX, 10, dt);
      state.scaleY = approach(state.scaleY, scaleY, 10, dt);
      state.appear = approach(state.appear, 1, 6, dt);
      const a = state.adjust;
      (Object.keys(adjust) as (keyof AdjustParams)[]).forEach((key) => {
        a[key] = approach(a[key], adjust[key], key === 'blur' ? 12 : 14, dt);
      });
      const g = groupRef.current;
      if (g) {
        g.rotation(state.rotate);
        g.scaleX(state.flipH * (state.scaleX / 100));
        g.scaleY(state.flipV * (state.scaleY / 100));
        g.opacity(Math.min(1, state.appear));
      }
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [rotate, fineRotate, flipH, flipV, scaleX, scaleY, adjust]);

  /** 选中集合展开成实际节点：选中组 = 选中组内所有叶子图层 */
  const selectedNodes = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return [] as Konva.Node[];
    const ids = new Set<number>();
    selectedLayerIds.forEach((id) => {
      if (id === BASE_LAYER_ID) return;
      const layer = findLayerDeep(layers, id);
      if (!layer) return;
      if (isGroup(layer)) leavesOf(layer).forEach((leaf) => ids.add(leaf.id));
      else ids.add(layer.id);
    });
    const nodes: Konva.Node[] = [];
    ids.forEach((id) => {
      const node = stage.findOne(`#layer-${id}`);
      if (node && !node.attrs.locked) nodes.push(node);
    });
    return nodes;
  }, [layers, selectedLayerIds]);

  /** ---------- Transformer 绑定选中集合（多选时整体变换 / 拖动由 Konva 代理） ---------- */
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    tr.nodes(selectedNodes());
    tr.getLayer()?.batchDraw();
  }, [selectedNodes]);

  /**
   * 画布内点选：Shift / ⌘ / Ctrl 追加选择；已选中的元素保持多选（便于整体拖动）。
   * 与 Figma 一致：优先选中最外层组，组已选中则再点会「钻」进下一层；被锁定的图层不响应。
   */
  const selectNode = (
    layer: CanvasLayer,
    evt?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }
  ) => {
    const chain = ancestorsOf(layers, layer.id);
    if (layer.locked || chain.some((g) => g.locked)) return;
    const target = chain.find((g) => !selectedLayerIds.includes(g.id)) ?? layer;
    const additive = !!evt && (evt.shiftKey || evt.metaKey || evt.ctrlKey);
    if (additive) {
      onSelectLayer(target.id, { additive: true });
      return;
    }
    if (!selectedLayerIds.includes(target.id)) onSelectLayer(target.id);
  };

  /* ---------- 拖动吸附：把当前节点中心同步到辅助线 ---------- */
  const dragSnap = (node: Konva.Node, layerId: number) => {
    if (!snapping) return;
    const layer = findLayerDeep(layers, layerId);
    if (!layer || isGroup(layer)) return;
    const b = layerBounds(layer);
    // 当前节点中心（归一化）
    const cx = (node.x() + baseSize.w / 2) / baseSize.w;
    const cy = (node.y() + baseSize.h / 2) / baseSize.h;
    const moved = { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h };
    const scale = Math.max(0.05, fit * viewZoom);
    const targets = collectSnapTargets(layers, selectedLayerIds);
    const { dx, dy, guides: next } = snapBounds(
      moved,
      targets,
      8 / scale / Math.max(1, baseSize.w),
      8 / scale / Math.max(1, baseSize.h)
    );
    if (dx !== 0) node.x(node.x() + dx * baseSize.w);
    if (dy !== 0) node.y(node.y() + dy * baseSize.h);
    setGuides(next);
  };

  /** ---------- 坐标换算 ---------- */
  const toNorm = (stagePoint: { x: number; y: number }) => {    const g = groupRef.current;
    if (!g || !baseReady) return null;
    const p = g.getAbsoluteTransform().copy().invert().point(stagePoint);
    return { x: (p.x + baseSize.w / 2) / baseSize.w, y: (p.y + baseSize.h / 2) / baseSize.h };
  };
  const pointerNorm = () => {
    const pos = stageRef.current?.getPointerPosition();
    return pos ? toNorm(pos) : null;
  };

  /** ---------- 绘制交互 ---------- */
  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    if (!stage || !baseReady) return;
    if (perspectiveMode) return;
    if (draw.tool === 'none' || e.evt.button === 1) {
      panRef.current = { sx: e.evt.clientX, sy: e.evt.clientY, ox: offset.x, oy: offset.y };
      return;
    }
    if (cropMode) return;
    if (draw.tool === 'select') {
      if (e.target === stage || e.target === groupRef.current) onSelectLayer(null);
      return;
    }
    if (!MARK_TOOLS.includes(draw.tool)) return;
    const p = pointerNorm();
    if (!p) return;
    if (draw.tool === 'text') {
      if (!draw.text.trim()) return;
      onMarkCommit({
        id: Date.now() % 1e6,
        mode: 'text',
        x: p.x,
        y: p.y - (draw.size / 100) * 0.7,
        w: 0,
        h: 0,
        text: draw.text,
        color: draw.color,
        opacity: 1,
        size: draw.size / 100,
        font: draw.font,
        stroke: draw.stroke,
        bg: draw.bg,
        lineHeight: draw.lineHeight,
        align: draw.align,
        rotation: 0
      });
      return;
    }
    if (draw.tool === 'sticker') {
      onMarkCommit({
        id: Date.now() % 1e6,
        mode: 'sticker',
        sticker: draw.sticker,
        x: p.x,
        y: p.y,
        size: draw.stickerSize / 100,
        color: draw.color,
        opacity: 1,
        rotation: 0
      });
      return;
    }
    const created: Mark =
      draw.tool === 'rect'
        ? {
            id: Date.now() % 1e6,
            mode: 'rect',
            x: p.x,
            y: p.y,
            w: 0,
            h: 0,
            color: draw.color,
            opacity: draw.opacity / 100,
            size: draw.size / 100
          }
        : draw.tool === 'shape'
          ? {
              id: Date.now() % 1e6,
              mode: 'shape',
              shape: draw.shape,
              filled: draw.filled,
              x: p.x,
              y: p.y,
              w: 0,
              h: 0,
              color: draw.color,
              opacity: draw.opacity / 100,
              size: draw.size / 100
            }
          : {
              id: Date.now() % 1e6,
              mode: draw.tool as 'brush' | 'eraser' | 'mosaic',
              points: [p],
              color: draw.color,
              opacity: draw.opacity / 100,
              size: draw.size / 100
            };
    draftRef.current = created;
    setDraft(created);
  };

  const onPointerMove = () => {
    const d = draftRef.current;
    if (!d) return;
    const p = pointerNorm();
    if (!p) return;
    if (d.mode === 'rect' || d.mode === 'shape') {
      d.w = p.x - d.x;
      d.h = p.y - d.y;
    } else if (d.mode === 'brush' || d.mode === 'eraser' || d.mode === 'mosaic') {
      const last = d.points[d.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.0025) d.points.push(p);
    }
    setDraft(d.mode === 'brush' || d.mode === 'eraser' || d.mode === 'mosaic' ? { ...d, points: [...d.points] } : { ...d });
  };

  const onPointerUp = () => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    if (d.mode === 'rect' || d.mode === 'shape') {
      if (Math.abs(d.w) < 0.01 || Math.abs(d.h) < 0.01) return;
      if (d.w < 0) {
        d.x += d.w;
        d.w = -d.w;
      }
      if (d.h < 0) {
        d.y += d.h;
        d.h = -d.h;
      }
    }
    onMarkCommit({ ...d });
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = panRef.current;
      if (!p) return;
      setOffset({ x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) });
    };
    const onUp = () => {
      panRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setViewZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setViewZoom((z) => Math.min(8, Math.max(0.2, z * factor)));
  }, []);

  const resetView = useCallback(() => {
    setViewZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    onViewChange?.(viewZoom);
  }, [viewZoom, onViewChange]);

  const imageRect = useMemo(() => {
    if (!fit) return { left: 0, top: 0, width: 0, height: 0 };
    const k = fit * viewZoom;
    return {
      left: (box.w - canvasW * k) / 2 + offset.x,
      top: (box.h - canvasH * k) / 2 + offset.y,
      width: canvasW * k,
      height: canvasH * k
    };
  }, [box.w, box.h, canvasW, canvasH, fit, viewZoom, offset.x, offset.y]);

  useImperativeHandle(
    ref,
    () => ({
      exportCanvas: (pixelRatio) => {
        const stage = stageRef.current;
        if (!stage || !baseReady) return null;
        const keep = { width: stage.width(), height: stage.height() };
        overlayRef.current?.hide();
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.size({ width: canvasW, height: canvasH });
        stage.draw();
        const canvas = stage.toCanvas({ pixelRatio });
        stage.size(keep);
        overlayRef.current?.show();
        applyViewport();
        stage.draw();
        return canvas;
      },
      normToClient: (x, y) => {
        const g = groupRef.current;
        if (!g) return null;
        const p = g.getAbsoluteTransform().point({ x: (x - 0.5) * baseSize.w, y: (y - 0.5) * baseSize.h });
        return { x: p.x, y: p.y };
      },
      zoomBy,
      resetView,
      layerScreenRect: (id) => {
        const g = groupRef.current;
        const layer = findLayerDeep(layers, id);
        if (!g || !layer || isGroup(layer)) return null;
        const b = layerBounds(layer);
        const tf = g.getAbsoluteTransform();
        const center = tf.point({
          x: (b.x + b.w / 2) * baseSize.w - baseSize.w / 2,
          y: (b.y + b.h / 2) * baseSize.h - baseSize.h / 2
        });
        const k = Math.max(0.05, fit * viewZoom);
        const own = isMark(layer) ? layer.mark.rotation ?? 0 : isPhoto(layer) ? layer.rotation : 0;
        return {
          x: center.x,
          y: center.y,
          width: b.w * baseSize.w * (scaleX / 100) * k,
          height: b.h * baseSize.h * (scaleY / 100) * k,
          rotation: rotate + fineRotate + own,
          scale: k
        };
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseReady, baseSize.w, baseSize.h, canvasW, canvasH, fit, viewZoom, offset.x, offset.y, box.w, box.h, zoomBy, resetView, layers, rotate, fineRotate, scaleX, scaleY]
  );

  const rawCtx = (ctx: Konva.Context) =>
    (ctx as unknown as { _context: CanvasRenderingContext2D })._context;

  const guideScale = Math.max(0.05, fit * viewZoom);

  /** 辅助线：按分组变换换算到舞台坐标（画布旋转时依然贴合） */
  const guideLines = useMemo(() => {
    const g = groupRef.current;
    if (!g || guides.length === 0) return [];
    const W = Math.max(1, baseSize.w);
    const H = Math.max(1, baseSize.h);
    const tf = g.getAbsoluteTransform();
    return guides.map((gd) => {
      const a =
        gd.axis === 'x'
          ? tf.point({ x: gd.value * W - W / 2, y: -H / 2 })
          : tf.point({ x: -W / 2, y: gd.value * H - H / 2 });
      const b =
        gd.axis === 'x'
          ? tf.point({ x: gd.value * W - W / 2, y: H / 2 })
          : tf.point({ x: W / 2, y: gd.value * H - H / 2 });
      return { points: [a.x, a.y, b.x, b.y], kind: gd.kind };
    });
  }, [guides, baseSize.w, baseSize.h]);

  /** 当前底图绘制用的位图与滤镜（擦拭要用同一份，保证补回来的像素一致） */
  const baseImage = compare ? originalBitmap : baseBitmap;
  const baseFilter = compare ? null : filterCss(adjust);
  const baseVignette = compare ? 0 : adjust.vignette;

  /** 递归渲染图层：组渲染成 Konva Group，可见性 / 不透明度 / 混合模式沿组继承 */
  const renderLayer = (layer: CanvasLayer, lockedByAncestor: boolean): ReactNode => {
    const locked = layer.locked || lockedByAncestor;
    if (isGroup(layer)) {
      return (
        <Group
          key={layer.id}
          visible={layer.visible}
          opacity={layer.opacity}
          globalCompositeOperation={layer.blend === 'normal' ? undefined : layer.blend}
        >
          {layer.children.map((child) => renderLayer(child, locked))}
        </Group>
      );
    }
    const blend = layer.blend === 'normal' ? undefined : layer.blend;
    const interactive = draw.tool === 'select' && !cropMode && !locked && !compare;

    if (isPhoto(layer)) {
      const img = imgs[layer.src];
      const w = layer.width * baseSize.w;
      const h = layer.height * baseSize.h;
      return (
        <Shape
          key={layer.id}
          id={`layer-${layer.id}`}
          name="photo"
          /* 分组坐标以画布中心为原点：归一化中心 * 画布尺寸 - 半个画布 */
          x={layer.x * baseSize.w - baseSize.w / 2}
          y={layer.y * baseSize.h - baseSize.h / 2}
          width={w}
          height={h}
          rotation={layer.rotation}
          offsetX={w / 2}
          offsetY={h / 2}
          scaleX={layer.flipH ? -1 : 1}
          scaleY={layer.flipV ? -1 : 1}
          opacity={layer.opacity}
          visible={layer.visible}
          locked={layer.locked}
          globalCompositeOperation={blend}
          draggable={interactive}
          onMouseDown={(e) => selectNode(layer, e.evt)}
          onTap={(e) => selectNode(layer, e.evt)}
          onDragMove={(e) => dragSnap(e.target, layer.id)}
          onDragEnd={(e) => {
            setGuides([]);
            const n = e.target;
            onLayerChange(layer.id, {
              x: (n.x() + baseSize.w / 2) / baseSize.w,
              y: (n.y() + baseSize.h / 2) / baseSize.h
            });
          }}
          onTransformEnd={(e) => {
            const n = e.target;
            const sx = n.scaleX();
            const sy = n.scaleY();
            n.scaleX(sx < 0 ? -1 : 1);
            n.scaleY(sy < 0 ? -1 : 1);
            onLayerChange(layer.id, {
              x: (n.x() + baseSize.w / 2) / baseSize.w,
              y: (n.y() + baseSize.h / 2) / baseSize.h,
              width: layer.width * Math.abs(sx),
              height: layer.height * Math.abs(sy),
              rotation: n.rotation(),
              flipH: sx < 0,
              flipV: sy < 0
            });
          }}
          sceneFunc={(ctx, shape) => {
            const c = rawCtx(ctx);
            if (!img) return;
            c.save();
            c.imageSmoothingQuality = 'high';
            c.globalAlpha = ctx.globalAlpha;
            c.drawImage(img, 0, 0, shape.width(), shape.height());
            c.restore();
          }}
          hitFunc={(ctx, shape) => {
            ctx.beginPath();
            ctx.rect(0, 0, shape.width(), shape.height());
            ctx.closePath();
            ctx.fillStrokeShape(shape);
          }}
        />
      );
    }

    const m = layer.mark;
    const b = markBounds(m);
    const w = Math.max(0.001, b.w) * baseSize.w;
    const h = Math.max(0.001, b.h) * baseSize.h;
    return (
      <Shape
        key={layer.id}
        id={`layer-${layer.id}`}
        name="mark"
        x={(b.x + b.w / 2) * baseSize.w - baseSize.w / 2}
        y={(b.y + b.h / 2) * baseSize.h - baseSize.h / 2}
        width={w}
        height={h}
        offsetX={w / 2}
        offsetY={h / 2}
        rotation={m.rotation ?? 0}
        opacity={layer.opacity}
        visible={layer.visible}
        locked={layer.locked}
        globalCompositeOperation={blend}
        draggable={interactive}
        onMouseDown={(e) => selectNode(layer, e.evt)}
        onTap={(e) => selectNode(layer, e.evt)}
        onDragMove={(e) => dragSnap(e.target, layer.id)}
        onDragEnd={(e) => {
          // 节点中心 = 元素包围盒中心，按中心差值平移归一化坐标
          const n = e.target;
          setGuides([]);
          translateMark(
            m,
            (n.x() + baseSize.w / 2) / baseSize.w - (b.x + b.w / 2),
            (n.y() + baseSize.h / 2) / baseSize.h - (b.y + b.h / 2)
          );
          onMarkChange(layer.id, { ...m });
        }}
        onTransformEnd={(e) => {
          const n = e.target;
          const sx = n.scaleX();
          const sy = n.scaleY();
          n.scaleX(1);
          n.scaleY(1);
          const k = (Math.abs(sx) + Math.abs(sy)) / 2;
          scaleMark(m, k);
          const nb = markBounds(m);
          translateMark(
            m,
            (n.x() + baseSize.w / 2) / baseSize.w - (nb.x + nb.w / 2),
            (n.y() + baseSize.h / 2) / baseSize.h - (nb.y + nb.h / 2)
          );
          m.rotation = n.rotation();
          onMarkChange(layer.id, { ...m });
        }}
        sceneFunc={(ctx) => {
          const c = rawCtx(ctx);
          c.save();
          c.globalAlpha = ctx.globalAlpha;
          // 旋转交给节点，绘制时用去旋转副本，避免重复旋转
          c.translate(-b.x * baseSize.w, -b.y * baseSize.h);
          if (m.mode === 'eraser') {
            paintEraser(c, m, baseSize.w, baseSize.h, baseImage, baseFilter, baseVignette);
          } else {
            paintMarks(c, [{ ...m, rotation: 0 } as Mark], baseSize.w, baseSize.h, null, mosaicSource);
          }
          c.restore();
        }}
        hitFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.rect(0, 0, shape.width(), shape.height());
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
      />
    );
  };

  const perspPoints = perspective.length === 4 ? perspective : DEFAULT_PERSPECTIVE;

  const hint = cropMode
    ? '拖拽边框或手柄调整裁剪区域'
    : perspectiveMode
      ? '透视：拖动四角围出需要拉直的区域'
      : draw.tool === 'select'
        ? '选择：点击元素后拖动 / 缩放 / 旋转，Delete 删除'
        : draw.tool === 'brush'
          ? '涂抹：按住拖拽绘制'
          : draw.tool === 'eraser'
            ? '擦拭：拖拽擦除笔迹'
            : draw.tool === 'mosaic'
              ? '马赛克：按住拖拽打码'
              : draw.tool === 'rect'
                ? '涂层：拖拽绘制色块'
                : draw.tool === 'shape'
                  ? '形状：拖拽绘制'
                  : draw.tool === 'sticker'
                    ? '贴纸：点击图片放置，再切到选择工具调整'
                    : draw.tool === 'text'
                      ? '文本：单击图片放置文字，再切到选择工具调整'
                      : null;

  return (
    <div ref={wrapRef} data-konva-stage className="relative h-full w-full overflow-hidden">
      <Stage
        ref={stageRef}
        width={box.w || 1}
        height={box.h || 1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDblClick={(e) => {
          // 双击文本标注 → 内联编辑；双击空白 → 复位视图
          const hit = /^layer-(\d+)$/.exec(e.target.id() ?? '');
          const layer = hit ? findLayerDeep(layers, Number(hit[1])) : undefined;
          if (layer && isMark(layer) && layer.mark.mode === 'text' && onEditText) {
            onSelectLayer(layer.id);
            onEditText(layer.id);
            return;
          }
          resetView();
        }}
        style={{
          cursor: cropMode || perspectiveMode ? 'default' : draw.tool === 'none' ? 'grab' : draw.tool === 'select' ? 'default' : 'crosshair'
        }}
      >
        <Layer>
          <Group
            ref={groupRef}
            x={canvasW / 2}
            y={canvasH / 2}
            rotation={rotate + fineRotate}
            scaleX={(flipH ? -1 : 1) * (scaleX / 100)}
            scaleY={(flipV ? -1 : 1) * (scaleY / 100)}
          >
            {/* 背景（底图）：滤镜 + 暗角 */}
            <Shape
              id="background-layer"
              x={-baseSize.w / 2}
              y={-baseSize.h / 2}
              width={Math.max(1, baseSize.w)}
              height={Math.max(1, baseSize.h)}
              listening={draw.tool === 'select' && !cropMode}
              onMouseDown={() => onSelectLayer(BASE_LAYER_ID)}
              onTap={() => onSelectLayer(BASE_LAYER_ID)}
              sceneFunc={(ctx) => {
                const c = rawCtx(ctx);
                // 位图与当前底图源不一致时不绘制，避免旧图被拉伸填满新尺寸的画布
                const img = baseImage;
                if (!img) return;
                c.save();
                if (!compare) c.filter = filterCss(adjust);
                // 位图比例与画布尺寸不一致时按 contain 居中绘制，绝不拉伸变形
                const { w: nw, h: nh } = bitmapSize(img);
                const warped =
                  nw > 0 &&
                  nh > 0 &&
                  (Math.abs(nw - baseSize.w) > 1 || Math.abs(nh - baseSize.h) > 1);
                if (warped) {
                  const k = Math.min(baseSize.w / nw, baseSize.h / nh);
                  const dw = nw * k;
                  const dh = nh * k;
                  c.drawImage(img, (baseSize.w - dw) / 2, (baseSize.h - dh) / 2, dw, dh);
                } else {
                  c.drawImage(img, 0, 0, baseSize.w, baseSize.h);
                }
                c.filter = 'none';
                if (!compare && adjust.vignette > 0) {
                  const v = adjust.vignette;
                  const g = c.createRadialGradient(
                    baseSize.w / 2,
                    baseSize.h / 2,
                    (Math.min(baseSize.w, baseSize.h) / 2) * 0.35,
                    baseSize.w / 2,
                    baseSize.h / 2,
                    Math.hypot(baseSize.w, baseSize.h) / 2
                  );
                  g.addColorStop(0, 'rgba(0,0,0,0)');
                  g.addColorStop(1, `rgba(0,0,0,${(0.85 * v) / 100})`);
                  c.fillStyle = g;
                  c.fillRect(0, 0, baseSize.w, baseSize.h);
                }
                c.restore();
              }}
              hitFunc={(ctx, shape) => {
                ctx.beginPath();
                ctx.rect(0, 0, shape.width(), shape.height());
                ctx.closePath();
                ctx.fillStrokeShape(shape);
              }}
            />

            {/* 画布元素：数组顺序即从下到上（组会渲染成嵌套的 Konva Group） */}
            {layers.map((layer) => renderLayer(layer, false))}

            {/* 绘制草稿 */}
            <Shape
              x={-baseSize.w / 2}
              y={-baseSize.h / 2}
              width={baseSize.w}
              height={baseSize.h}
              listening={false}
              sceneFunc={(ctx) => {
                if (!draft || compare) return;
                const c = rawCtx(ctx);
                c.save();
                paintMarks(c, [], baseSize.w, baseSize.h, draft, mosaicSource);
                c.restore();
              }}
            />

            {/* 透视校正四角 */}
            {perspectiveMode &&
              perspPoints.map((pt, i) => (
                <Circle
                  key={i}
                  x={(pt[0] - 0.5) * baseSize.w}
                  y={(pt[1] - 0.5) * baseSize.h}
                  radius={7 / Math.max(0.08, fit * viewZoom)}
                  fill="#ffffff"
                  stroke="#8b5cf6"
                  strokeWidth={2 / Math.max(0.08, fit * viewZoom)}
                  draggable
                  onDragMove={(e) => {
                    const n = e.target;
                    const nx = n.x() / baseSize.w + 0.5;
                    const ny = n.y() / baseSize.h + 0.5;
                    const next = perspPoints.map((p, k) =>
                      k === i ? ([Math.min(0.995, Math.max(0.005, nx)), Math.min(0.995, Math.max(0.005, ny))] as [number, number]) : p
                    );
                    onPerspectiveChange(next);
                  }}
                />
              ))}
          </Group>
        </Layer>

        {/* 选中框层（导出时隐藏） */}
        <Layer ref={overlayRef}>
          <Transformer
            ref={trRef}
            rotateEnabled
            /* 多选时把包围盒内部也做成可拖拽区域：拖动即整体移动（Konva 会代理所有附加节点） */
            shouldOverdrawWholeArea={selectedLayerIds.length > 1}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            anchorSize={10}
            anchorStroke="#8b5cf6"
            anchorFill="#ffffff"
            anchorCornerRadius={5}
            borderStroke="#8b5cf6"
            borderDash={[4, 4]}
            rotateAnchorOffset={26}
            anchorScaleX={1 / Math.max(0.05, fit * viewZoom)}
            anchorScaleY={1 / Math.max(0.05, fit * viewZoom)}
            borderScaleFactor={1 / Math.max(0.05, fit * viewZoom)}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 14 || newBox.height < 14 ? oldBox : newBox)}
          />
          {/* 吸附对齐辅助线 */}
          {guideLines.map((g, i) => (
            <Line
              key={i}
              points={g.points}
              stroke={g.kind === 'canvas' ? '#8b5cf6' : '#ec4899'}
              strokeWidth={1 / guideScale}
              dash={[5 / guideScale, 4 / guideScale]}
              listening={false}
            />
          ))}
        </Layer>
      </Stage>

      {cropMode && (
        <ImageCropOverlay imageRect={imageRect} crop={crop} aspect={aspect} active onChange={onCropChange} />
      )}

      {hint && !compare && !!(baseSrc || baseCanvas) && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-violet-400/90 px-3 py-1 text-[11px] font-medium text-white shadow-sm">
          {hint}
        </div>
      )}

      {/* 视图缩放控制（仅影响预览，不影响导出） */}
      <div className="absolute right-3 top-3 flex items-center gap-0.5 rounded-full border border-violet-100 bg-white/90 px-1.5 py-1 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.2)}
          title="缩小预览（仅影响查看，不影响导出）"
          className="flex h-6 w-6 items-center justify-center rounded-full text-violet-500 transition-colors hover:bg-violet-100"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={resetView}
          title="复位视图（双击画面同样生效）"
          className="w-12 rounded-full py-0.5 text-center font-mono text-[11px] text-violet-500 transition-colors hover:bg-violet-100"
        >
          {Math.round(viewZoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.2)}
          title="放大预览（仅影响查看，不影响导出）"
          className="flex h-6 w-6 items-center justify-center rounded-full text-violet-500 transition-colors hover:bg-violet-100"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-violet-100" />
        <button
          type="button"
          onClick={resetView}
          title="适应窗口"
          className="flex h-6 w-6 items-center justify-center rounded-full text-violet-500 transition-colors hover:bg-violet-100"
        >
          <Maximize className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
