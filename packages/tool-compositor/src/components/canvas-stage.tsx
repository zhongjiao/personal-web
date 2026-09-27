import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react';
import { Crop, Lasso } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@pmp/ui';
import {
  createCanvas,
  docToImageLocal,
  findLayer,
  imageRectToDocBounds,
  imageScaleOf,
  imageToDocTransform,
  intersectRect,
  layerBounds,
  roundOutRect,
  transformCorners,
  unionRect,
  type EditorDocument,
  type RasterLayer,
  type Rect
} from '../lib/document';
import { applyMask, documentNeedsReadback, renderDocument } from '../lib/render';
import { createGlCompositor, type GlCompositor } from '../lib/gl/compositor';
import { paintMaskStroke, type BrushSettings } from '../lib/paint';
import {
  combineSelection,
  isEmptySelection,
  lassoSelection,
  rectSelection,
  selectionOutline,
  wandSelection,
  type Selection,
  type SelectionCombine
} from '../lib/selection';
import { objectSelection } from '../lib/object-select';
import {
  angleFromCenter,
  hitTestHandle,
  resolveRotation,
  resolveScale,
  rotateHandlePoint,
  scaleHandlePoints,
  type HandleId
} from '../lib/handles';
import { CHECKER_STYLE } from '../lib/checker';

export type ToolId =
  | 'move'
  | 'maskBrush'
  | 'marqueeRect'
  | 'marqueeEllipse'
  | 'lasso'
  | 'polygonLasso'
  | 'wand'
  | 'object'
  | 'crop';

const SELECTION_TOOLS: ToolId[] = [
  'marqueeRect',
  'marqueeEllipse',
  'lasso',
  'polygonLasso',
  'wand',
  'object'
];
const isSelectionTool = (tool: ToolId): boolean => SELECTION_TOOLS.includes(tool);

/** 多边形套索：点回起点的判定半径、相邻顶点去重距离（屏幕像素） */
const POLY_CLOSE_PX = 12;
const POLY_MIN_VERTEX_PX = 3;

/** 手柄相关的尺寸都以**屏幕像素**给出，绘制与命中时再按缩放比换算成文档像素 */
const HANDLE_SIZE_PX = 9;
const HANDLE_HIT_PX = 12;
const ROTATE_OFFSET_PX = 28;

/** 裁剪框的八个控制点，复用变换手柄的命名 */
const CROP_HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const cropHandlePoint = (r: Rect, id: HandleId): [number, number] => {
  const mx = r.x + r.w / 2;
  const my = r.y + r.h / 2;
  switch (id) {
    case 'nw':
      return [r.x, r.y];
    case 'n':
      return [mx, r.y];
    case 'ne':
      return [r.x + r.w, r.y];
    case 'e':
      return [r.x + r.w, my];
    case 'se':
      return [r.x + r.w, r.y + r.h];
    case 's':
      return [mx, r.y + r.h];
    case 'sw':
      return [r.x, r.y + r.h];
    case 'w':
      return [r.x, my];
  }
};

/**
 * 画布边缘上的手柄会被夹进画布内 1px。
 * 否则「整张画布」这个初始裁剪框的角手柄正好落在元素最外沿，有一半在元素之外、点不到。
 * 只影响绘制与命中；缩放的求解仍然用指针位置本身，所以夹紧不会改变几何语义。
 */
const clampHandleInside = (p: [number, number], w: number, h: number): [number, number] => [
  Math.min(Math.max(p[0], 0), Math.max(0, w - 1)),
  Math.min(Math.max(p[1], 0), Math.max(0, h - 1))
];

const CROP_WEST: HandleId[] = ['nw', 'w', 'sw'];
const CROP_EAST: HandleId[] = ['ne', 'e', 'se'];
const CROP_NORTH: HandleId[] = ['nw', 'n', 'ne'];
const CROP_SOUTH: HandleId[] = ['sw', 's', 'se'];

type DragState =
  | { mode: 'move'; last: [number, number] }
  | { mode: 'maskBrush'; last: [number, number] }
  | { mode: 'marquee'; start: [number, number]; current: [number, number]; combine: SelectionCombine }
  | { mode: 'lasso'; points: [number, number][]; combine: SelectionCombine }
  | { mode: 'handle'; kind: HandleId | 'rotate'; grabAngle: number; startRotation: number }
  | { mode: 'crop'; kind: 'new' | 'move' | HandleId; anchor: [number, number]; startRect: Rect };

interface Props {
  doc: EditorDocument;
  revision: number;
  zoom: number;
  tool: ToolId;
  brush: BrushSettings;
  wandTolerance: number;
  wandContiguous: boolean;
  /** 对象选择的边缘阈值（1–100） */
  objectThreshold: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** 返回脏矩形则局部重绘，返回 `null` 则全量重绘 */
  onChange: (fn: (doc: EditorDocument) => Rect | null) => void;
  /** 拖拽开始 / 结束：把整段拖拽合并成一步撤销 */
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
  /** 每次自增表示「请重新适应窗口」 */
  fitRequest: number;
  onZoomChange: (zoom: number) => void;
  onApplyCrop: (rect: Rect) => void;
  /** 是否优先走 WebGL2 合成（GPU 不可用或出错时自动退回 Canvas2D） */
  gpuEnabled: boolean;
  /** 上报上一帧实际重绘了多大区域、走的哪条后端（状态栏据此显示） */
  onFrame: (info: FrameInfo) => void;
}

export interface FrameInfo {
  width: number;
  height: number;
  /** 是否全量重绘 */
  full: boolean;
  /** 是否由 WebGL2 合成 */
  gpu: boolean;
}

function activeRaster(doc: EditorDocument): RasterLayer | null {
  if (!doc.activeLayerID) return null;
  const layer = findLayer(doc.layers, doc.activeLayerID);
  return layer && layer.kind === 'raster' ? layer : null;
}

function combineFromEvent(e: { shiftKey: boolean; altKey: boolean }): SelectionCombine {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return 'replace';
}

export function CanvasStage({
  doc,
  revision,
  zoom,
  tool,
  brush,
  wandTolerance,
  wandContiguous,
  objectThreshold,
  canvasRef,
  onChange,
  onStrokeStart,
  onStrokeEnd,
  fitRequest,
  onZoomChange,
  onApplyCrop,
  gpuEnabled,
  onFrame
}: Props) {
  const dragRef = useRef<DragState | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** 已提交选区的「蚂蚁线」轮廓层，选区变化时才重算 */
  const antsRef = useRef<HTMLCanvasElement | null>(null);
  const antsSourceRef = useRef<HTMLCanvasElement | null>(null);
  const handledFitRef = useRef(0);
  /**
   * 多边形套索的在建路径。顶点与橡皮筋端点都放在 ref 里 —— 鼠标每动一次都要重画叠加层，
   * 走 React state 等于每次 pointermove 都重渲染整个舞台。只有「顶点数」进 state（顶部提示条要显示）。
   */
  const polyRef = useRef<{ points: [number, number][]; combine: SelectionCombine } | null>(null);
  const polyCursorRef = useRef<[number, number] | null>(null);
  const [polyCount, setPolyCount] = useState(0);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const glRef = useRef<GlCompositor | null>(null);
  const prevGpuRef = useRef(gpuEnabled);
  // 走 GPU 时不需要 willReadFrequently —— 这条路径不再 getImageData 主画布
  const cpu = !gpuEnabled && documentNeedsReadback(doc);

  const fullRect: Rect = { x: 0, y: 0, w: doc.width, h: doc.height };

  // 「适应窗口」：容器尺寸由本组件持有，因此在这里量测后回传缩放比
  useEffect(() => {
    if (fitRequest === handledFitRef.current) return;
    handledFitRef.current = fitRequest;
    const el = scrollRef.current;
    if (!el) return;
    const padding = 64;
    const k = Math.min(
      (el.clientWidth - padding) / doc.width,
      (el.clientHeight - padding) / doc.height,
      1
    );
    onZoomChange(Math.max(0.05, Math.round(k * 1000) / 1000));
  }, [fitRequest, doc.width, doc.height, onZoomChange]);

  // GPU 合成器只在挂载时建一次；WebGL2 不可用就保持为 null，全程走 Canvas2D
  useEffect(() => {
    const compositor = createGlCompositor();
    glRef.current = compositor;
    return () => {
      compositor?.dispose();
      glRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 尺寸变化（含首次挂载、key 变更后的重挂）会清空画布，必须全量重绘
    const resized = canvas.width !== doc.width || canvas.height !== doc.height;
    if (resized) {
      canvas.width = doc.width;
      canvas.height = doc.height;
    }
    // 切换合成后端时必须全量，否则显示画布上会残留上一条路径的像素
    const backendChanged = prevGpuRef.current !== gpuEnabled;
    prevGpuRef.current = gpuEnabled;
    const fullRedraw = resized || doc.dirty === 'all' || backendChanged;
    if (!fullRedraw && doc.dirty === null) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: cpu });
    if (!ctx) return;

    const region: Rect | null = fullRedraw || doc.dirty === 'all' ? null : doc.dirty;
    const gl = gpuEnabled ? glRef.current : null;
    const report = (gpu: boolean) =>
      onFrame(
        region
          ? { width: region.w, height: region.h, full: false, gpu }
          : { width: doc.width, height: doc.height, full: true, gpu }
      );
    if (gl && gl.render(doc, region)) {
      report(true);
      // GPU 合成结果落在自己的画布上，这里只把它搬进显示画布；
      // 显示画布仍是普通 2D 画布，所以魔棒取色、导出 toBlob、缩略图全部照旧。
      const bounds = region ? intersectRect(region, { x: 0, y: 0, w: doc.width, h: doc.height }) : null;
      const r = bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height };
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(gl.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      ctx.restore();
      doc.dirty = null;
      return;
    }

    report(false);
    renderDocument(doc, ctx, region);
    doc.dirty = null;
  }, [doc, revision, cpu, canvasRef, gpuEnabled, onFrame]);

  /**
   * 画图层自身的变换框。
   * 必须是**旋转后的四边形**，而不是轴对齐包围盒 —— 手柄是按框局部坐标算的，
   * 画成包围盒的话旋转之后手柄会浮在框里面、对不上。
   */
  const drawTransformBox = (
    ctx: CanvasRenderingContext2D,
    corners: [number, number][],
    unit: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();
    // 先深后浅画两层，保证在任何底色上都看得见
    ctx.lineWidth = Math.max(1, 2.5 * unit);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, 1.25 * unit);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };

  /** 画叠加层：蚂蚁线 + 拖拽预览 + 变换手柄 / 裁剪框 */
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (overlay.width !== doc.width || overlay.height !== doc.height) {
      overlay.width = doc.width;
      overlay.height = doc.height;
    }
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const { width: W, height: H } = overlay;
    ctx.clearRect(0, 0, W, H);

    if (antsRef.current) ctx.drawImage(antsRef.current, 0, 0);

    // 叠加层与画布同为文档分辨率、靠 CSS 缩放显示，所以线宽要按缩放比反算
    const unit = 1 / zoom;
    const drawBox = (x: number, y: number, w: number, h: number) => {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(0.75, 1.5 * unit);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = Math.max(0.5, 1 * unit);
      ctx.beginPath();
      ctx.rect(x - 1.5 * unit, y - 1.5 * unit, w + 3 * unit, h + 3 * unit);
      ctx.stroke();
    };
    const drawHandle = (x: number, y: number, radiusDoc: number, round: boolean) => {
      ctx.beginPath();
      if (round) ctx.arc(x, y, radiusDoc, 0, Math.PI * 2);
      else ctx.rect(x - radiusDoc, y - radiusDoc, radiusDoc * 2, radiusDoc * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, 1 * unit);
      ctx.strokeStyle = '#111111';
      ctx.stroke();
    };

    const drag = dragRef.current;

    // ── 裁剪框
    if (tool === 'crop' && cropRect) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.fill('evenodd');
      ctx.restore();

      // 三分线
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(0.5, 1 * unit);
      for (let i = 1; i <= 2; i += 1) {
        const x = cropRect.x + (cropRect.w * i) / 3;
        const y = cropRect.y + (cropRect.h * i) / 3;
        ctx.beginPath();
        ctx.moveTo(x, cropRect.y);
        ctx.lineTo(x, cropRect.y + cropRect.h);
        ctx.moveTo(cropRect.x, y);
        ctx.lineTo(cropRect.x + cropRect.w, y);
        ctx.stroke();
      }

      drawBox(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      for (const id of CROP_HANDLES) {
        const [hx, hy] = clampHandleInside(cropHandlePoint(cropRect, id), W, H);
        drawHandle(hx, hy, (HANDLE_SIZE_PX / 2) * unit, false);
      }
      return;
    }

    // ── 多边形套索的在建路径
    const poly = polyRef.current;
    if (tool === 'polygonLasso' && poly && poly.points.length > 0) {
      const pts = poly.points;
      const cursor = polyCursorRef.current ?? pts[pts.length - 1];
      const chain: [number, number][] = [...pts, cursor];
      const tracePath = () => {
        ctx.beginPath();
        chain.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.stroke();
      };
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, 2.5 * unit);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      tracePath();
      ctx.lineWidth = Math.max(0.5, 1.25 * unit);
      ctx.strokeStyle = '#ffffff';
      tracePath();
      // 收口虚线：预览「再点一下会得到什么形状」
      if (pts.length >= 2) {
        ctx.setLineDash([Math.max(2, 5 * unit), Math.max(2, 5 * unit)]);
        ctx.lineWidth = Math.max(0.5, 1.25 * unit);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(cursor[0], cursor[1]);
        ctx.lineTo(pts[0][0], pts[0][1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 顶点标记；起点画大一圈，提示「点这里闭合」
      const radius = (HANDLE_SIZE_PX / 2) * unit;
      pts.forEach(([px, py], i) => drawHandle(px, py, i === 0 ? radius * 1.4 : radius, i === 0));
      ctx.restore();
      return;
    }

    // ── 选区 / 套索拖拽预览
    if (drag && (drag.mode === 'marquee' || drag.mode === 'lasso')) {
      ctx.save();
      ctx.lineWidth = Math.max(0.75, 1.5 * unit);
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([Math.max(2, 6 * unit), Math.max(2, 6 * unit)]);
      ctx.beginPath();
      if (drag.mode === 'marquee') {
        const x = Math.min(drag.start[0], drag.current[0]);
        const y = Math.min(drag.start[1], drag.current[1]);
        const w = Math.abs(drag.current[0] - drag.start[0]);
        const h = Math.abs(drag.current[1] - drag.start[1]);
        if (tool === 'marqueeEllipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(x, y, w, h);
      } else {
        drag.points.forEach(([x, y], index) => {
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    // ── 变换手柄：只在移动工具 + 栅格图层时出现
    if (tool !== 'move') return;
    const layer = activeRaster(doc);
    if (!layer?.image) return;

    const handles = scaleHandlePoints(layer.transform);
    drawTransformBox(ctx, transformCorners(layer.transform), unit);
    for (const { point } of handles) {
      drawHandle(point[0], point[1], (HANDLE_SIZE_PX / 2) * unit, false);
    }
    const north = handles.find((p) => p.id === 'n');
    const rp = rotateHandlePoint(layer.transform, ROTATE_OFFSET_PX * unit);
    if (north) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(0.75, 1.5 * unit);
      ctx.beginPath();
      ctx.moveTo(north.point[0], north.point[1]);
      ctx.lineTo(rp[0], rp[1]);
      ctx.stroke();
    }
    drawHandle(rp[0], rp[1], (HANDLE_SIZE_PX / 2) * unit, true);
  }, [doc, zoom, tool, cropRect]);

  // 选区变化 → 重算蚂蚁线
  useEffect(() => {
    if (doc.selection === antsSourceRef.current) return;
    antsSourceRef.current = doc.selection;
    antsRef.current = selectionOutline(doc.selection);
    drawOverlay();
  }, [doc, revision, drawOverlay]);

  // 文档改动 / 缩放 / 工具切换都会影响叠加层
  useEffect(() => {
    drawOverlay();
  }, [revision, zoom, tool, drawOverlay]);

  // 进入裁剪工具时把裁剪框初始化成整张画布；离开时清掉。多边形套索同理，留着半截路径会误导人。
  useEffect(() => {
    if (tool === 'crop') setCropRect({ x: 0, y: 0, w: doc.width, h: doc.height });
    else setCropRect(null);
    if (tool !== 'polygonLasso') {
      polyRef.current = null;
      polyCursorRef.current = null;
      setPolyCount(0);
    }
  }, [tool, doc.width, doc.height]);

  const applyCrop = useCallback(() => {
    if (!cropRect) return;
    const rect = roundOutRect(cropRect);
    if (rect.w < 1 || rect.h < 1) {
      toast.error('裁剪区域太小');
      return;
    }
    if (rect.w === doc.width && rect.h === doc.height && rect.x === 0 && rect.y === 0) {
      toast.info('裁剪框与画布相同，无需裁剪');
      return;
    }
    onApplyCrop(rect);
  }, [cropRect, doc.width, doc.height, onApplyCrop]);

  /** 指针位置 → 文档像素坐标（用元素实际尺寸换算，避免 CSS 缩放的舍入误差） */
  const toDoc = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) * doc.width) / rect.width,
      ((e.clientY - rect.top) * doc.height) / rect.height
    ];
  };

  const commitSelection = (next: Selection, combine: SelectionCombine) => {
    onChange((d) => {
      const merged = combineSelection(d.selection, next, combine);
      d.selection = isEmptySelection(merged) ? null : merged;
      // 选区会改变调整图层的作用范围，保守起见全量重绘
      return null;
    });
  };

  /** 提交多边形套索；顶点不足 3 个直接丢弃 */
  const commitPolygon = useCallback(
    (points: [number, number][], combine: SelectionCombine) => {
      polyRef.current = null;
      polyCursorRef.current = null;
      setPolyCount(0);
      if (points.length < 3) return;
      onChange((d) => {
        const merged = combineSelection(
          d.selection,
          lassoSelection(d.width, d.height, points),
          combine
        );
        d.selection = isEmptySelection(merged) ? null : merged;
        return null;
      });
    },
    [onChange]
  );

  const cancelPolygon = useCallback(() => {
    polyRef.current = null;
    polyCursorRef.current = null;
    setPolyCount(0);
    drawOverlay();
  }, [drawOverlay]);

  /**
   * 对象选择：优先在**选中图层的像素**上分析 —— 这样「点哪儿选哪儿」与屏幕所见一致，
   * 图层的蒙版也一并生效；没有可用的栅格图层时退回用合成结果。
   *
   * 无论走哪条路，都先把像素铺进一张**文档尺寸**的画布，于是分析结果天然就是文档空间的选区，
   * 可以与选框 / 套索 / 魔棒任意混用。
   */
  const runObjectSelection = (point: [number, number], combine: SelectionCombine) => {
    const stage = canvasRef.current;
    const layer = activeRaster(doc);
    let source: HTMLCanvasElement | null = null;

    if (layer?.image) {
      const { canvas, ctx } = createCanvas(doc.width, doc.height);
      ctx.save();
      imageToDocTransform(ctx, layer, layer.image.width, layer.image.height);
      ctx.drawImage(layer.image, 0, 0);
      ctx.restore();
      // 蒙版要作用在文档空间，所以必须先还原变换
      if (layer.mask && layer.maskEnabled) applyMask(doc, ctx, layer);
      source = canvas;
    } else if (stage) {
      source = stage;
    }
    if (!source) return;

    const result = objectSelection(source, Math.floor(point[0]), Math.floor(point[1]), {
      threshold: objectThreshold
    });
    if (result.pixels === 0) {
      toast.info('这里没有可以生长的区域');
      return;
    }
    commitSelection(result.selection, combine);
    toast.success(
      `已选中 ${result.pixels.toLocaleString()} 个像素（画布 ${(result.ratio * 100).toFixed(1)}%）` +
        (result.touchedBorder ? '；已触到画布边缘，阈值可能偏高' : '')
    );
  };

  /**
   * 蒙版涂抹。脏矩形不依赖模型改动本身，因此可以先算好再提交，
   * 让合成器只重算笔刷覆盖的那一小块。有选区时只在其内部落笔。
   */
  const paint = (from: [number, number] | null, to: [number, number]) => {
    const layer = activeRaster(doc);
    if (!layer?.mask) return;

    const localBrush: BrushSettings = { ...brush, size: brush.size / imageScaleOf(layer) };
    const targetLocal = docToImageLocal(layer, to[0], to[1]);
    const originLocal = from ? docToImageLocal(layer, from[0], from[1]) : null;

    onChange((d) => {
      const target = activeRaster(d);
      if (!target?.mask) return null;
      const imageRect = paintMaskStroke(target, originLocal, targetLocal, localBrush, d.selection);
      return imageRectToDocBounds(target, imageRect);
    });
  };

  /** 裁剪框命中测试：控制点 → 框内 → 框外（框外表示要重新拉一个） */
  const cropHit = (point: [number, number], tolerance: number): 'move' | HandleId | 'outside' => {
    if (!cropRect) return 'outside';
    for (const id of CROP_HANDLES) {
      const [hx, hy] = clampHandleInside(
        cropHandlePoint(cropRect, id),
        doc.width,
        doc.height
      );
      if (Math.hypot(hx - point[0], hy - point[1]) <= tolerance) return id;
    }
    const inside =
      point[0] >= cropRect.x &&
      point[0] <= cropRect.x + cropRect.w &&
      point[1] >= cropRect.y &&
      point[1] <= cropRect.y + cropRect.h;
    return inside ? 'move' : 'outside';
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toDoc(e);

    if (tool === 'polygonLasso') {
      const poly = polyRef.current;
      if (!poly) {
        polyRef.current = { points: [point], combine: combineFromEvent(e) };
        polyCursorRef.current = point;
        setPolyCount(1);
        drawOverlay();
        return;
      }
      const first = poly.points[0];
      const closeTolerance = POLY_CLOSE_PX / zoom;
      if (
        poly.points.length >= 3 &&
        Math.hypot(first[0] - point[0], first[1] - point[1]) <= closeTolerance
      ) {
        commitPolygon(poly.points, poly.combine);
        return;
      }
      // 双击会连发两次 pointerdown，按距离去重，免得留下一个零长度顶点
      const last = poly.points[poly.points.length - 1];
      if (Math.hypot(last[0] - point[0], last[1] - point[1]) > POLY_MIN_VERTEX_PX / zoom) {
        poly.points.push(point);
        setPolyCount(poly.points.length);
      }
      polyCursorRef.current = point;
      drawOverlay();
      return;
    }

    if (tool === 'object') {
      runObjectSelection(point, combineFromEvent(e));
      return;
    }

    if (tool === 'crop') {
      const hit = cropHit(point, HANDLE_HIT_PX / zoom);
      if (hit === 'outside') {
        // 框外按下 = 重新拉一个框
        setCropRect({ x: point[0], y: point[1], w: 0, h: 0 });
        dragRef.current = {
          mode: 'crop',
          kind: 'new',
          anchor: point,
          startRect: { x: point[0], y: point[1], w: 0, h: 0 }
        };
      } else {
        dragRef.current = {
          mode: 'crop',
          kind: hit,
          anchor: point,
          startRect: cropRect ? { ...cropRect } : { x: 0, y: 0, w: doc.width, h: doc.height }
        };
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (isSelectionTool(tool)) {
      const combine = combineFromEvent(e);
      if (tool === 'wand') {
        const stage = canvasRef.current;
        if (stage) {
          commitSelection(
            wandSelection(stage, Math.floor(point[0]), Math.floor(point[1]), wandTolerance, wandContiguous),
            combine
          );
        }
        return;
      }
      dragRef.current =
        tool === 'lasso'
          ? { mode: 'lasso', points: [point], combine }
          : { mode: 'marquee', start: point, current: point, combine };
      drawOverlay();
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === 'move') {
      const layer = activeRaster(doc);
      if (!layer?.image) return;
      const hit = hitTestHandle(
        layer.transform,
        point[0],
        point[1],
        HANDLE_HIT_PX / zoom,
        ROTATE_OFFSET_PX / zoom
      );
      if (hit === 'rotate') {
        onStrokeStart();
        dragRef.current = {
          mode: 'handle',
          kind: 'rotate',
          grabAngle: angleFromCenter(layer.transform, point),
          startRotation: layer.transform.rotation
        };
      } else if (hit) {
        onStrokeStart();
        dragRef.current = { mode: 'handle', kind: hit, grabAngle: 0, startRotation: 0 };
      } else {
        onStrokeStart();
        dragRef.current = { mode: 'move', last: point };
      }
    } else {
      const layer = activeRaster(doc);
      if (!layer?.mask) return;
      onStrokeStart();
      dragRef.current = { mode: 'maskBrush', last: point };
      paint(null, point);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toDoc(e);

    // 笔刷光标圈（直接改样式，避免每次移动都触发 React 重渲染）
    const cursor = cursorRef.current;
    if (cursor) {
      const rect = e.currentTarget.getBoundingClientRect();
      const visible = tool === 'maskBrush' && !!activeRaster(doc)?.mask;
      cursor.style.opacity = visible ? '1' : '0';
      cursor.style.width = `${brush.size * zoom}px`;
      cursor.style.height = `${brush.size * zoom}px`;
      cursor.style.transform = `translate(${e.clientX - rect.left}px, ${
        e.clientY - rect.top
      }px) translate(-50%, -50%)`;
    }

    // 多边形套索的橡皮筋：即使没在拖拽也要跟着鼠标走
    if (tool === 'polygonLasso' && polyRef.current) {
      polyCursorRef.current = point;
      drawOverlay();
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.mode === 'crop') {
      const clamp = (r: Rect): Rect => ({
        x: Math.max(0, r.x),
        y: Math.max(0, r.y),
        w: Math.min(doc.width, r.w),
        h: Math.min(doc.height, r.h)
      });
      let next: Rect;
      if (drag.kind === 'new') {
        next = roundOutRect({
          x: Math.min(drag.anchor[0], point[0]),
          y: Math.min(drag.anchor[1], point[1]),
          w: Math.abs(point[0] - drag.anchor[0]),
          h: Math.abs(point[1] - drag.anchor[1])
        });
      } else if (drag.kind === 'move') {
        const dx = point[0] - drag.anchor[0];
        const dy = point[1] - drag.anchor[1];
        next = roundOutRect({
          ...drag.startRect,
          x: drag.startRect.x + dx,
          y: drag.startRect.y + dy
        });
        next.x = Math.min(Math.max(0, next.x), doc.width - next.w);
        next.y = Math.min(Math.max(0, next.y), doc.height - next.h);
      } else {
        const r = drag.startRect;
        let x0 = r.x;
        let y0 = r.y;
        let x1 = r.x + r.w;
        let y1 = r.y + r.h;
        if (CROP_WEST.includes(drag.kind)) x0 = point[0];
        if (CROP_EAST.includes(drag.kind)) x1 = point[0];
        if (CROP_NORTH.includes(drag.kind)) y0 = point[1];
        if (CROP_SOUTH.includes(drag.kind)) y1 = point[1];
        next = roundOutRect({
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.abs(x1 - x0),
          h: Math.abs(y1 - y0)
        });
      }
      // setState 会让 drawOverlay 换新（它依赖 cropRect），叠加层随之重画
      setCropRect(clamp(next));
      return;
    }

    if (drag.mode === 'marquee') {
      drag.current = point;
      drawOverlay();
      return;
    }
    if (drag.mode === 'lasso') {
      drag.points.push(point);
      drawOverlay();
      return;
    }
    if (drag.mode === 'handle') {
      if (drag.kind === 'rotate') {
        onChange((d) => {
          const layer = activeRaster(d);
          if (!layer) return null;
          const before = layerBounds(layer);
          layer.transform.rotation = resolveRotation(
            layer.transform,
            point,
            drag.grabAngle,
            drag.startRotation,
            e.shiftKey
          );
          return before;
        });
      } else {
        onChange((d) => {
          const layer = activeRaster(d);
          if (!layer) return null;
          const before = layerBounds(layer);
          const next = resolveScale(layer, drag.kind as HandleId, point, {
            proportional: e.shiftKey,
            fromCenter: e.altKey
          });
          layer.transform.size = next.size;
          layer.transform.origin = next.origin;
          const after = layerBounds(layer);
          return before && after ? unionRect(before, after) : null;
        });
      }
      return;
    }
    if (drag.mode === 'move') {
      const dx = point[0] - drag.last[0];
      const dy = point[1] - drag.last[1];
      drag.last = point;
      if (dx === 0 && dy === 0) return;
      onChange((d) => {
        const layer = activeRaster(d);
        if (!layer) return null;
        const before = layerBounds(layer);
        const [ox, oy] = layer.transform.origin;
        layer.transform.origin = [ox + dx, oy + dy];
        const after = layerBounds(layer);
        // 移动只影响「旧位置 ∪ 新位置」
        return before && after ? unionRect(before, after) : null;
      });
      return;
    }

    const from = drag.last;
    drag.last = point;
    paint(from, point);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    if (drag.mode === 'crop') {
      // 只是点了一下没拉出面积，就当没发生
      setCropRect((current) =>
        current && current.w >= 1 && current.h >= 1
          ? current
          : { x: 0, y: 0, w: doc.width, h: doc.height }
      );
      return;
    }
    if (drag.mode === 'marquee') {
      const rect: Rect = {
        x: Math.min(drag.start[0], drag.current[0]),
        y: Math.min(drag.start[1], drag.current[1]),
        w: Math.abs(drag.current[0] - drag.start[0]),
        h: Math.abs(drag.current[1] - drag.start[1])
      };
      // 只是一次点击（没有拖出面积）就当作取消选择
      if (rect.w < 1 && rect.h < 1) {
        onChange((d) => {
          d.selection = null;
          return null;
        });
      } else {
        commitSelection(
          rectSelection(doc.width, doc.height, rect, tool === 'marqueeEllipse'),
          drag.combine
        );
      }
    } else if (drag.mode === 'lasso') {
      if (drag.points.length < 3) {
        drawOverlay();
        return;
      }
      commitSelection(lassoSelection(doc.width, doc.height, drag.points), drag.combine);
    } else {
      onStrokeEnd();
    }
    drawOverlay();
  };

  // 裁剪与多边形套索的键盘操作。放在这里而不是靠前，是因为要用到 `commitPolygon` /
  // `cancelPolygon` —— 依赖数组是在渲染期求值的，写在使用之前会撞上 TDZ。
  useEffect(() => {
    if (tool !== 'crop' && tool !== 'polygonLasso') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      if (tool === 'crop') {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCrop();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setCropRect({ x: 0, y: 0, w: doc.width, h: doc.height });
        }
        return;
      }

      const poly = polyRef.current;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (poly) commitPolygon(poly.points, poly.combine);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelPolygon();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (!poly) return;
        if (poly.points.length > 1) {
          poly.points.pop();
          polyCursorRef.current = poly.points[poly.points.length - 1];
          setPolyCount(poly.points.length);
          drawOverlay();
        } else {
          cancelPolygon();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, applyCrop, commitPolygon, cancelPolygon, drawOverlay, doc.width, doc.height]);

  const cursorStyle =
    tool === 'crop' || isSelectionTool(tool) ? 'crosshair' : tool === 'maskBrush' ? 'none' : 'move';
  const docRect = fullRect;

  return (
    <div className="relative flex min-w-0 flex-1">
      {tool === 'crop' && cropRect && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 shadow-xl">
          <Crop className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <span className="text-xs tabular-nums">
            {Math.round(cropRect.w)} × {Math.round(cropRect.h)}
          </span>
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            Enter 应用 · Esc 重置
          </span>
          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={applyCrop}>
            应用
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setCropRect(docRect)}
          >
            重置
          </Button>
        </div>
      )}

      {tool === 'polygonLasso' && polyCount > 0 && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 shadow-xl">
          <Lasso className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          <span className="shrink-0 text-xs tabular-nums">{polyCount} 个顶点</span>
          <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
            点回起点 / 双击 / Enter 闭合 · Backspace 删点 · Esc 取消
          </span>
          <Button
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={polyCount < 3}
            onClick={() => {
              const poly = polyRef.current;
              if (poly) commitPolygon(poly.points, poly.combine);
            }}
          >
            闭合
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={cancelPolygon}>
            取消
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-8"
      >
        <div
          className="relative shrink-0 ring-1 ring-black/20 shadow-2xl"
          style={{
            ...CHECKER_STYLE,
            width: doc.width * zoom,
            height: doc.height * zoom
          }}
        >
          <canvas
            key={cpu ? 'cpu' : 'gpu'}
            ref={canvasRef}
            className="block h-full w-full touch-none"
            style={{
              imageRendering: zoom >= 4 ? 'pixelated' : 'auto',
              cursor: cursorStyle
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => {
              const poly = polyRef.current;
              if (tool === 'polygonLasso' && poly) commitPolygon(poly.points, poly.combine);
            }}
            onPointerLeave={() => {
              if (cursorRef.current) cursorRef.current.style.opacity = '0';
            }}
          />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <div
            ref={cursorRef}
            className="pointer-events-none absolute left-0 top-0 rounded-full border border-white opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ width: brush.size * zoom, height: brush.size * zoom }}
          />
        </div>
      </div>
    </div>
  );
}
