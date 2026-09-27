import type { CompBlendMode, CompTransform } from './comp-format';
import { ADJUSTMENT_LABELS, createAdjustment, type Adjustment, type AdjustmentKind } from './adjustments';
// 仅类型引用：effects.ts / text-shape.ts 反过来要用本模块的 `createCanvas`，
// 用 `import type` 保证运行时不成环
import type { LayerEffects } from './effects';
import type { ShapeState, TextState } from './text-shape';

/**
 * 编辑器**运行时**文档模型。
 *
 * 与 `comp-format.ts` 里的 `.comp` 线格式（扁平数组 + `parentID`、同级自下而上）不同，
 * 运行时用**嵌套树**表达图层组 —— 重排、成组、解组都好写；
 * 两者互转放到里程碑 3 的 reader/writer 里。
 *
 * 模型是**可变**的（canvas 对象没法廉价地做不可变拷贝），
 * React 侧靠一个自增的 `revision` 触发重渲染，见 `page.tsx`。
 *
 * 重绘范围由 `EditorDocument.dirty` 表达：涂抹蒙版这类只影响一小块的操作会带上脏矩形，
 * 合成器便只重算该区域（见 `render.ts`）。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 图层蒙版。
 *
 * `gray` 是唯一的真源（也是 `.comp` 里要写出的 `<id>.mask.png`：8-bit 灰度、白显黑隐）；
 * `alpha` 是 Canvas2D 合成需要的派生件（同一张图，把亮度搬到 alpha 上）。
 * 涂抹时只把**笔刷覆盖的那块**标脏，下次合成时增量同步，避免每次落笔都全量遍历像素。
 */
export interface LayerMask {
  gray: HTMLCanvasElement;
  alpha: HTMLCanvasElement;
  /** alpha 是否与 gray 一致 */
  alphaSynced: boolean;
  /** 待同步区域（图像像素坐标）；`null` 表示整张，仅在 alphaSynced 为 false 时有意义 */
  dirty: Rect | null;
  /**
   * 该 gray 画布是否仍被某个历史快照引用。
   * 为 true 时任何就地改写都必须先经 `ownMaskGray` 复制一份，否则会改掉历史里的像素。
   */
  grayShared: boolean;
}

interface LayerCommon {
  id: string;
  name: string;
  /** 自身可见性；组的可见性向下继承，不改变子图层的该标记 */
  visible: boolean;
  /** 0–1 */
  opacity: number;
  blendMode: CompBlendMode;
  mask: LayerMask | null;
  maskEnabled: boolean;
}

/** 自带像素的图层（栅格 / 组）可以挂图层效果 */
interface PixelLayerCommon extends LayerCommon {
  effects: LayerEffects | null;
}

export interface RasterLayer extends PixelLayerCommon {
  kind: 'raster';
  /** 源像素；为空表示空白图层。文字 / 形状图层也靠它做显示与导出回退 */
  image: HTMLCanvasElement | null;
  transform: CompTransform;
  /** 可编辑文字元数据；`image` 一旦被破坏性操作改写就应置空 */
  text: TextState | null;
  /** 可编辑形状元数据 */
  shape: ShapeState | null;
}

export interface GroupLayer extends PixelLayerCommon {
  kind: 'group';
  /** 自下而上：数组最后一项在最上层 */
  children: LayerNode[];
  /** 仅 UI 状态，不参与合成 */
  expanded: boolean;
}

/** 调整图层：没有像素，作用于其下方已合成的内容 */
export interface AdjustmentLayer extends LayerCommon {
  kind: 'adjustment';
  adjustment: Adjustment;
}

export type LayerNode = RasterLayer | GroupLayer | AdjustmentLayer;

/** 待重绘区域：`'all'` 全量，`Rect` 局部，`null` 表示当前画面已是最新 */
export type DirtyRegion = 'all' | Rect | null;

export interface EditorDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 每英寸像素 */
  resolution: number;
  /** 自下而上：数组最后一项在最上层 */
  layers: LayerNode[];
  activeLayerID: string | null;
  /** 由 `invalidate()` 维护、由合成器消费 */
  dirty: DirtyRegion;
  /**
   * 选区（文档尺寸的 alpha 蒙版）。会话状态，不进 `.comp`。
   * 每次选区操作都产出新画布，因此历史快照存引用即可。
   */
  selection: HTMLCanvasElement | null;
}

let idSeq = 0;

/** 图层 id。做 `.comp` I/O 时会被直接当作 PNG 文件名（大写形式）使用 */
export function createLayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  idSeq += 1;
  return `layer-${Date.now().toString(36)}-${idSeq}`;
}

/* ────────────────────────────── 矩形工具 ────────────────────────────── */

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y
  };
}

export function roundOutRect(r: Rect): Rect {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

/** 裁剪到 `[0,w] × [0,h]`；完全在外则返回 null */
export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(w, Math.ceil(r.x + r.w));
  const bottom = Math.min(h, Math.ceil(r.y + r.h));
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

export function documentRect(doc: EditorDocument): Rect {
  return { x: 0, y: 0, w: doc.width, h: doc.height };
}

/**
 * 标记待重绘区域。
 * - 不传 `rect`：全量失效（新增/删除图层、改混合模式、变换等都要全量）
 * - 传 `rect`：局部失效；若已经是全量则无需收窄
 */
export function invalidate(doc: EditorDocument, rect?: Rect | null): void {
  if (!rect) {
    doc.dirty = 'all';
    return;
  }
  if (doc.dirty === 'all') return;
  const clamped = clampRect(rect, doc.width, doc.height);
  if (!clamped) return;
  doc.dirty = doc.dirty ? unionRect(doc.dirty, clamped) : clamped;
}

/* ────────────────────────────── canvas 工具 ────────────────────────────── */

export function createCanvas(w: number, h: number, readFrequently = false) {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: readFrequently });
  if (!ctx) throw new Error('无法创建 2D 绘图上下文');
  return { canvas, ctx };
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

function whiteCanvas(w: number, h: number): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/* ────────────────────────────── 蒙版 ────────────────────────────── */

/** 新建蒙版：灰度与 alpha 都全白（全部显示） */
export function createLayerMask(width: number, height: number): LayerMask {
  return {
    gray: whiteCanvas(width, height),
    alpha: whiteCanvas(width, height),
    alphaSynced: true,
    dirty: null,
    grayShared: false
  };
}

/**
 * 用一张既有灰度画布构造蒙版（撤销 / 重做复用快照像素、或从 `.comp` 解码出来），alpha 待重建。
 * @param shared 该画布是否仍被历史快照引用 —— 撤销恢复时为 true，刚从文件解码出来时为 false
 */
export function maskFromGray(gray: HTMLCanvasElement, shared = true): LayerMask {
  return {
    gray,
    alpha: whiteCanvas(gray.width, gray.height),
    alphaSynced: false,
    dirty: null,
    grayShared: shared
  };
}

export function cloneLayerMask(mask: LayerMask): LayerMask {
  return {
    gray: cloneCanvas(mask.gray),
    alpha: whiteCanvas(mask.alpha.width, mask.alpha.height),
    alphaSynced: false,
    dirty: null,
    grayShared: false
  };
}

/**
 * 写时复制：gray 若仍被历史快照引用，先复制一份再交出控制权。
 * 这是「历史只存元数据、像素按需复制」能成立的关键，见 `history.ts`。
 */
export function ownMaskGray(mask: LayerMask): void {
  if (!mask.grayShared) return;
  mask.gray = cloneCanvas(mask.gray);
  mask.grayShared = false;
}

/**
 * 灰度蒙版像素 → 覆盖率（0–255）。
 *
 * **所有蒙版换算都必须走这里**：`ensureMaskAlpha` 用它把灰度搬到 alpha，
 * `png.ts` 用它把蒙版编码回 8-bit 灰度 PNG。两处算法一旦有分歧，往返一次就漂移一个色阶。
 *
 * 必须用**四舍五入**：`Uint8ClampedArray` 赋值是四舍五入，而 `Uint8Array` 是截断 ——
 * `0.299 + 0.587 + 0.114` 在浮点下可能算出 `v - ε`，截断就会把 v 变成 v-1 并且逐次累积。
 */
export function maskCoverage(r: number, g: number, b: number, a: number): number {
  return Math.round((0.299 * r + 0.587 * g + 0.114 * b) * (a / 255));
}

/** 把某块区域标脏（图像像素坐标）；下一次 `ensureMaskAlpha` 只重算这块 */
export function markMaskDirty(mask: LayerMask, rect: Rect): void {
  const clamped = clampRect(rect, mask.gray.width, mask.gray.height);
  if (!clamped) return;
  mask.alphaSynced = false;
  mask.dirty = mask.dirty ? unionRect(mask.dirty, clamped) : clamped;
}

/** 整张失效（反相等全图操作） */
export function invalidateLayerMask(mask: LayerMask): void {
  mask.alphaSynced = false;
  mask.dirty = null;
}

/**
 * 保证 alpha 与 gray 一致，返回 alpha 画布。
 * 只有被标脏的区域会被重算 —— 这是涂抹性能的关键。
 */
export function ensureMaskAlpha(mask: LayerMask): HTMLCanvasElement {
  if (mask.alphaSynced) return mask.alpha;

  const { width, height } = mask.gray;
  const region = mask.dirty
    ? clampRect(mask.dirty, width, height)
    : { x: 0, y: 0, w: width, h: height };

  if (region) {
    const gctx = mask.gray.getContext('2d', { willReadFrequently: true });
    const actx = mask.alpha.getContext('2d');
    if (gctx && actx) {
      const image = gctx.getImageData(region.x, region.y, region.w, region.h);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        // 白显黑隐：把覆盖率搬到 alpha 上，RGB 统一置白
        const coverage = maskCoverage(d[i], d[i + 1], d[i + 2], d[i + 3]);
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = coverage;
      }
      actx.putImageData(image, region.x, region.y);
    }
  }

  mask.alphaSynced = true;
  mask.dirty = null;
  return mask.alpha;
}

/* ────────────────────────────── 变换几何 ────────────────────────────── */

export function createTransform(
  origin: [number, number],
  size: [number, number]
): CompTransform {
  return { origin, size, rotation: 0, flipX: false, flipY: false, sampling: 'High quality' };
}

/**
 * 变换后四角在文档坐标中的位置。
 * 与渲染端的绘制顺序一致：先以尺寸中心为原点缩放（含翻转），再旋转，最后平移到中心。
 */
export function transformCorners(t: CompTransform): [number, number][] {
  const [ox, oy] = t.origin;
  const [w, h] = t.size;
  const cx = ox + w / 2;
  const cy = oy + h / 2;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = t.flipX ? -1 : 1;
  const sy = t.flipY ? -1 : 1;
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h]
  ];
  return corners.map(([lx, ly]): [number, number] => {
    const px = (lx - w / 2) * sx;
    const py = (ly - h / 2) * sy;
    return [cx + px * cos - py * sin, cy + px * sin + py * cos];
  });
}

/** 图层在文档坐标中的包围盒；空组 / 空图层 / 调整图层返回 null（调整图层没有自身像素） */
export function layerBounds(layer: LayerNode): Rect | null {
  if (layer.kind === 'adjustment') return null;
  if (layer.kind === 'group') {
    let out: Rect | null = null;
    for (const child of layer.children) {
      const b = layerBounds(child);
      if (!b) continue;
      out = out ? unionRect(out, b) : b;
    }
    return out;
  }
  if (!layer.image) return null;
  const pts = transformCorners(layer.transform);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  return { x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y };
}

/**
 * 图像像素坐标 → 文档坐标。
 * 与渲染端 `drawRaster` 的绘制顺序严格互逆。
 */
export function imageLocalToDoc(layer: RasterLayer, u: number, v: number): [number, number] {
  const t = layer.transform;
  const iw = layer.image?.width ?? layer.mask?.gray.width ?? t.size[0];
  const ih = layer.image?.height ?? layer.mask?.gray.height ?? t.size[1];
  let px = (u / iw - 0.5) * t.size[0];
  let py = (v / ih - 0.5) * t.size[1];
  if (t.flipX) px = -px;
  if (t.flipY) py = -py;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [t.origin[0] + t.size[0] / 2 + px * cos - py * sin, t.origin[1] + t.size[1] / 2 + px * sin + py * cos];
}

/** 图像像素坐标下的矩形 → 文档坐标包围盒（仿射映射下取四角包围盒即为精确结果） */
export function imageRectToDocBounds(layer: RasterLayer, rect: Rect): Rect {
  const pts: [number, number][] = [
    imageLocalToDoc(layer, rect.x, rect.y),
    imageLocalToDoc(layer, rect.x + rect.w, rect.y),
    imageLocalToDoc(layer, rect.x + rect.w, rect.y + rect.h),
    imageLocalToDoc(layer, rect.x, rect.y + rect.h)
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return roundOutRect({
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys)
  });
}

/**
 * 给 ctx 套上「图像像素 → 文档坐标」的变换。
 * 与渲染端 `drawRaster` 的绘制顺序严格互逆，用于把**文档空间**的选区套到图像空间的画布上。
 *
 * 顺序：图像像素 → 图层框（比例缩放）→ 居中 → 翻转 → 旋转 → 平移到图层中心
 */
export function imageToDocTransform(
  ctx: CanvasRenderingContext2D,
  layer: RasterLayer,
  imageWidth: number,
  imageHeight: number
): void {
  const t = layer.transform;
  const [w, h] = t.size;
  ctx.translate(t.origin[0] + w / 2, t.origin[1] + h / 2);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
  ctx.translate(-w / 2, -h / 2);
  ctx.scale(w / imageWidth, h / imageHeight);
}

/**
 * `imageToDocTransform` 的逆：文档坐标 → 图像像素坐标。
 *
 * 注意顺序必须严格求逆：`imageToDoc` 是
 * `T(c)·R(θ)·S(f)·T(−s/2)·S(w/iw, h/ih)`，所以逆是
 * `S(iw/w, ih/h)·T(s/2)·S(f)·R(−θ)·T(−c)` —— **比例在最外层**。
 * 若图层图片尺寸恰好等于图层框尺寸，比例退化成单位阵、写反了也看不出来，
 * 一旦两者不等就会整块错位。
 */
export function docToImageTransform(
  ctx: CanvasRenderingContext2D,
  layer: RasterLayer,
  imageWidth: number,
  imageHeight: number
): void {
  const t = layer.transform;
  const [w, h] = t.size;
  ctx.scale(imageWidth / w, imageHeight / h);
  ctx.translate(w / 2, h / 2);
  ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
  ctx.rotate((-t.rotation * Math.PI) / 180);
  ctx.translate(-(t.origin[0] + w / 2), -(t.origin[1] + h / 2));
}

/**
 * 文档坐标 → 图层**图像像素**坐标（蒙版与图像同尺寸，因此同一套逆变换通用）。
 * 用于把画布上的指针位置换算成蒙版涂抹位置。
 */
export function docToImageLocal(layer: RasterLayer, x: number, y: number): [number, number] {
  const t = layer.transform;
  const iw = layer.image?.width ?? layer.mask?.gray.width ?? t.size[0];
  const ih = layer.image?.height ?? layer.mask?.gray.height ?? t.size[1];
  const cx = t.origin[0] + t.size[0] / 2;
  const cy = t.origin[1] + t.size[1] / 2;
  const rad = (-t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  let px = dx * cos - dy * sin;
  let py = dx * sin + dy * cos;
  if (t.flipX) px = -px;
  if (t.flipY) py = -py;
  return [(px / t.size[0] + 0.5) * iw, (py / t.size[1] + 0.5) * ih];
}

/**
 * 图层框局部坐标（`0..size`）→ 文档坐标。
 * 与 `drawRaster` 的绘制顺序一致；变换手柄的几何全部建立在它之上。
 */
export function boxLocalToDoc(t: CompTransform, bx: number, by: number): [number, number] {
  const [w, h] = t.size;
  let px = bx - w / 2;
  let py = by - h / 2;
  if (t.flipX) px = -px;
  if (t.flipY) py = -py;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    t.origin[0] + w / 2 + px * cos - py * sin,
    t.origin[1] + h / 2 + px * sin + py * cos
  ];
}

/** 文档坐标 → 图层框局部坐标（`docToImageLocal` 的「不做图像比例缩放大」版本） */
export function docToBoxLocal(layer: RasterLayer, x: number, y: number): [number, number] {
  const t = layer.transform;
  const [w, h] = t.size;
  const cx = t.origin[0] + w / 2;
  const cy = t.origin[1] + h / 2;
  const rad = (-t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  let px = dx * cos - dy * sin;
  let py = dx * sin + dy * cos;
  if (t.flipX) px = -px;
  if (t.flipY) py = -py;
  return [px + w / 2, py + h / 2];
}

/** 图像像素坐标下的一单位长度对应文档坐标长度 */
export function imageScaleOf(layer: RasterLayer): number {
  const iw = layer.image?.width ?? layer.mask?.gray.width ?? layer.transform.size[0];
  return layer.transform.size[0] / iw;
}

/* ────────────────────────────── 图层构造 ────────────────────────────── */

export function createRasterLayer(opts: {
  name: string;
  image?: HTMLCanvasElement | null;
  origin?: [number, number];
  size?: [number, number];
}): RasterLayer {
  const image = opts.image ?? null;
  const w = opts.size?.[0] ?? image?.width ?? 100;
  const h = opts.size?.[1] ?? image?.height ?? 100;
  return {
    kind: 'raster',
    id: createLayerId(),
    name: opts.name,
    visible: true,
    opacity: 1,
    blendMode: 'Normal',
    mask: null,
    maskEnabled: true,
    effects: null,
    image,
    transform: createTransform(opts.origin ?? [0, 0], [w, h]),
    text: null,
    shape: null
  };
}

export function createGroupLayer(name = '图层组'): GroupLayer {
  return {
    kind: 'group',
    id: createLayerId(),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'Normal',
    mask: null,
    maskEnabled: true,
    effects: null,
    children: [],
    expanded: true
  };
}

export function createAdjustmentLayer(kind: AdjustmentKind): AdjustmentLayer {
  return {
    kind: 'adjustment',
    id: createLayerId(),
    name: ADJUSTMENT_LABELS[kind],
    visible: true,
    opacity: 1,
    blendMode: 'Normal',
    mask: null,
    maskEnabled: true,
    adjustment: createAdjustment(kind)
  };
}

export function createSolidLayer(
  name: string,
  width: number,
  height: number,
  color: string
): RasterLayer {
  const { canvas, ctx } = createCanvas(width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return createRasterLayer({ name, image: canvas });
}

export function createDocument(width: number, height: number, name = '未命名.comp'): EditorDocument {
  const background = createSolidLayer('背景', width, height, '#ffffff');
  return {
    id: createLayerId(),
    name,
    width,
    height,
    resolution: 72,
    layers: [background],
    activeLayerID: background.id,
    dirty: 'all',
    selection: null
  };
}

/* ────────────────────────────── 树操作 ────────────────────────────── */

export function walk(
  nodes: LayerNode[],
  visit: (layer: LayerNode, parent: GroupLayer | null) => void,
  parent: GroupLayer | null = null
): void {
  for (const node of nodes) {
    visit(node, parent);
    if (node.kind === 'group') walk(node.children, visit, node);
  }
}

/** 展平为深度优先列表（含组本身） */
export function flatten(nodes: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  walk(nodes, (layer) => out.push(layer));
  return out;
}

export function findLayer(nodes: LayerNode[], id: string): LayerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === 'group') {
      const hit = findLayer(node.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export interface LayerSlot {
  /** 该图层所在的同级数组 */
  siblings: LayerNode[];
  index: number;
  parent: GroupLayer | null;
}

export function findSlot(
  nodes: LayerNode[],
  id: string,
  parent: GroupLayer | null = null
): LayerSlot | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.id === id) return { siblings: nodes, index: i, parent };
    if (node.kind === 'group') {
      const hit = findSlot(node.children, id, node);
      if (hit) return hit;
    }
  }
  return null;
}

export function cloneLayer(layer: LayerNode): LayerNode {
  const common = {
    id: createLayerId(),
    name: `${layer.name} 副本`,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    mask: layer.mask ? cloneLayerMask(layer.mask) : null,
    maskEnabled: layer.maskEnabled
  };
  if (layer.kind === 'group') {
    return {
      ...common,
      kind: 'group',
      effects: layer.effects ? { ...layer.effects } : null,
      children: layer.children.map(cloneLayer),
      expanded: true
    };
  }
  if (layer.kind === 'adjustment') {
    return { ...common, kind: 'adjustment', adjustment: structuredClone(layer.adjustment) };
  }
  const [ox, oy] = layer.transform.origin;
  return {
    ...common,
    kind: 'raster',
    effects: layer.effects ? structuredClone(layer.effects) : null,
    image: layer.image,
    transform: { ...layer.transform, origin: [ox + 24, oy + 24] },
    text: layer.text ? structuredClone(layer.text) : null,
    shape: layer.shape ? structuredClone(layer.shape) : null
  };
}

/* ────────────────────────────── 外部输入 ────────────────────────────── */

export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const { canvas, ctx } = createCanvas(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/** 等比缩放到不超过 max 尺寸 */
export function fitWithin(w: number, h: number, maxW: number, maxH: number): [number, number] {
  const k = Math.min(1, maxW / w, maxH / h);
  return [Math.round(w * k), Math.round(h * k)];
}
