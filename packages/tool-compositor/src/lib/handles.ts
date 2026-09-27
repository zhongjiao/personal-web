import type { CompTransform } from './comp-format';
import { boxLocalToDoc, docToBoxLocal, type RasterLayer } from './document';

/**
 * 变换手柄的几何与拖拽求解。
 *
 * 全部计算都在**图层框局部坐标**（`0..size`）里做：指针先经 `docToBoxLocal` 反向映射进来，
 * 于是旋转与翻转都被自动抵消，求解就退化成「轴对齐矩形改一条边」。
 * 改完之后再解出新 `origin`，让**对侧手柄在文档坐标里保持不动**。
 */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const SCALE_HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 手柄在图层框局部坐标中的位置 */
function handleLocal(id: HandleId, w: number, h: number): [number, number] {
  const mx = w / 2;
  const my = h / 2;
  switch (id) {
    case 'nw':
      return [0, 0];
    case 'n':
      return [mx, 0];
    case 'ne':
      return [w, 0];
    case 'e':
      return [w, my];
    case 'se':
      return [w, h];
    case 's':
      return [mx, h];
    case 'sw':
      return [0, h];
    case 'w':
      return [0, my];
  }
}

/** 拖某个手柄时，对侧那个手柄是谁 —— 它就是缩放时保持不动的锚点 */
const OPPOSITE: Record<HandleId, HandleId> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e'
};

export interface HandlePoint {
  id: HandleId;
  point: [number, number];
}

/** 八个缩放手柄在文档坐标中的位置 */
export function scaleHandlePoints(t: CompTransform): HandlePoint[] {
  const [w, h] = t.size;
  return SCALE_HANDLES.map((id) => ({
    id,
    point: boxLocalToDoc(t, ...handleLocal(id, w, h))
  }));
}

/**
 * 旋转手柄：从「上边中点」沿框的局部 −y 方向外推一段距离。
 * 图层框局部坐标本身就是文档尺度（旋转/翻转是等距变换），所以外推量直接就是文档像素。
 */
export function rotateHandlePoint(t: CompTransform, offsetDoc: number): [number, number] {
  const [w] = t.size;
  return boxLocalToDoc(t, w / 2, -offsetDoc);
}

/** 命中测试；`tolerance` 为文档像素单位（调用方按缩放比换算） */
export function hitTestHandle(
  t: CompTransform,
  x: number,
  y: number,
  tolerance: number,
  rotateOffsetDoc: number
): HandleId | 'rotate' | null {
  let best: HandleId | 'rotate' | null = null;
  let bestDistance = tolerance;
  for (const { id, point } of scaleHandlePoints(t)) {
    const d = Math.hypot(point[0] - x, point[1] - y);
    if (d <= bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  const rp = rotateHandlePoint(t, rotateOffsetDoc);
  const rd = Math.hypot(rp[0] - x, rp[1] - y);
  if (rd <= tolerance) return 'rotate';
  return best;
}

/**
 * 由「锚点在文档坐标中应保持不动」反解 `origin`。
 *
 * `boxLocalToDoc = o + s/2 + R·F·(anchor − s/2)`，所以
 * `o = docAnchor − s/2 − R·F·(anchor − s/2)`。
 */
function originForAnchor(
  base: CompTransform,
  size: [number, number],
  anchorLocal: [number, number],
  docAnchor: [number, number]
): [number, number] {
  const [w, h] = size;
  let px = anchorLocal[0] - w / 2;
  let py = anchorLocal[1] - h / 2;
  if (base.flipX) px = -px;
  if (base.flipY) py = -py;
  const rad = (base.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    docAnchor[0] - (px * cos - py * sin) - w / 2,
    docAnchor[1] - (px * sin + py * cos) - h / 2
  ];
}

export interface ScaleOptions {
  /** Shift：等比 */
  proportional: boolean;
  /** Alt：以中心为锚点 */
  fromCenter: boolean;
}

/**
 * 拖动缩放手柄，返回新的 `origin` 与 `size`（其余字段原样保留）。
 *
 * 尺寸的算法很朴素：把指针反向映射进**当前**的图层框，量出它到锚点的距离。
 * 因为旋转/翻转都在反向映射里抵消了，这个距离就是新边长。
 */
export function resolveScale(
  layer: RasterLayer,
  handle: HandleId,
  pointer: [number, number],
  options: ScaleOptions
): { origin: [number, number]; size: [number, number] } {
  const base = layer.transform;
  const [w, h] = base.size;
  const [bx, by] = docToBoxLocal(layer, pointer[0], pointer[1]);

  const anchorId = OPPOSITE[handle];
  const anchorLocal = handleLocal(anchorId, w, h);
  // 左右手柄只改宽、上下手柄只改高
  const onlyWidth = handle === 'e' || handle === 'w';
  const onlyHeight = handle === 'n' || handle === 's';

  let newW: number;
  let newH: number;
  if (options.fromCenter) {
    newW = onlyHeight ? w : Math.max(1, Math.abs(bx - w / 2) * 2);
    newH = onlyWidth ? h : Math.max(1, Math.abs(by - h / 2) * 2);
  } else {
    newW = onlyHeight ? w : Math.max(1, Math.abs(bx - anchorLocal[0]));
    newH = onlyWidth ? h : Math.max(1, Math.abs(by - anchorLocal[1]));
  }

  if (options.proportional) {
    if (onlyWidth) newH = Math.max(1, h * (newW / w));
    else if (onlyHeight) newW = Math.max(1, w * (newH / h));
    else {
      const k = Math.max(newW / w, newH / h);
      newW = Math.max(1, w * k);
      newH = Math.max(1, h * k);
    }
  }

  const size: [number, number] = [newW, newH];
  if (options.fromCenter) {
    const docCenter = boxLocalToDoc(base, w / 2, h / 2);
    return {
      size,
      origin: [docCenter[0] - newW / 2, docCenter[1] - newH / 2]
    };
  }

  const docAnchor = boxLocalToDoc(base, anchorLocal[0], anchorLocal[1]);
  const anchorInNew = handleLocal(anchorId, newW, newH);
  return { size, origin: originForAnchor(base, size, anchorInNew, docAnchor) };
}

/** 拖动旋转手柄：中心保持不动，只改角度 */
export function resolveRotation(
  base: CompTransform,
  pointer: [number, number],
  grabAngleDeg: number,
  startRotation: number,
  snap: boolean
): number {
  const cx = base.origin[0] + base.size[0] / 2;
  const cy = base.origin[1] + base.size[1] / 2;
  const current = (Math.atan2(pointer[1] - cy, pointer[0] - cx) * 180) / Math.PI;
  let rotation = startRotation + (current - grabAngleDeg);
  if (snap) rotation = Math.round(rotation / 15) * 15;
  // 归一化到 (-180, 180]，避免长时间旋转后数字失控
  rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
  return rotation;
}

/** 抓取旋转手柄时的起始角（度） */
export function angleFromCenter(base: CompTransform, pointer: [number, number]): number {
  const cx = base.origin[0] + base.size[0] / 2;
  const cy = base.origin[1] + base.size[1] / 2;
  return (Math.atan2(pointer[1] - cy, pointer[0] - cx) * 180) / Math.PI;
}
