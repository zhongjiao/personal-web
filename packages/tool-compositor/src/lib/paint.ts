import {
  clampRect,
  createCanvas,
  docToImageTransform,
  invalidateLayerMask,
  markMaskDirty,
  ownMaskGray,
  roundOutRect,
  type LayerMask,
  type RasterLayer,
  type Rect
} from './document';

/**
 * 蒙版涂抹。
 *
 * 蒙版是 8-bit 灰度：白显示、黑隐藏。笔刷只写黑或白，硬度 <1 时边缘用径向渐变做软过渡
 * —— 因为蒙版底色是不透明白，source-over 混合后得到的灰度值就是我们要的覆盖率。
 *
 * 每次落笔都会返回**图像像素坐标**下的脏矩形，调用方据此把文档标脏，
 * 合成器便只需重算这一小块（见 `render.ts`）。
 */

export interface BrushSettings {
  /** 直径，文档像素 */
  size: number;
  /** 0–1，1 为硬边 */
  hardness: number;
  /** 黑色=隐藏，白色=显示 */
  color: 'black' | 'white';
}

export const DEFAULT_BRUSH: BrushSettings = { size: 80, hardness: 0.6, color: 'black' };

export function stampDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  brush: BrushSettings
): void {
  const r = Math.max(0.5, brush.size / 2);
  const solid = brush.color === 'white' ? '#ffffff' : '#000000';

  if (brush.hardness >= 1) {
    ctx.fillStyle = solid;
  } else {
    const inner = r * Math.max(0, Math.min(1, brush.hardness));
    const gradient = ctx.createRadialGradient(x, y, inner, x, y, r);
    gradient.addColorStop(0, solid);
    gradient.addColorStop(
      1,
      brush.color === 'white' ? 'rgba(255, 255, 255, 0)' : 'rgba(0, 0, 0, 0)'
    );
    ctx.fillStyle = gradient;
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 沿线段连续落笔，避免快速拖动时出现断点 */
export function stampLine(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  brush: BrushSettings
): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  const step = Math.max(1, brush.size * 0.15);
  const count = Math.max(1, Math.ceil(distance / step));

  for (let i = 1; i <= count; i += 1) {
    stampDot(ctx, from[0] + (dx * i) / count, from[1] + (dy * i) / count, brush);
  }
}

/** 线段（或单点）加上笔刷半径后的包围盒 */
function strokeBounds(
  from: [number, number] | null,
  to: [number, number],
  radius: number
): Rect {
  const xs = from ? [from[0], to[0]] : [to[0]];
  const ys = from ? [from[1], to[1]] : [to[1]];
  const minX = Math.min(...xs) - radius;
  const minY = Math.min(...ys) - radius;
  const maxX = Math.max(...xs) + radius;
  const maxY = Math.max(...ys) + radius;
  // 外扩 1px 容纳抗锯齿边缘
  return { x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 };
}

/**
 * 在蒙版上落一笔，并把受影响区域标脏。
 * 端点均为**图像像素坐标**（调用方用 `docToImageLocal` 换算），笔刷尺寸也需已按 `imageScaleOf` 缩放。
 *
 * @param selection 有选区时只在其内部落笔：先把笔迹画到临时画布，用选区裁掉外面，再合成回蒙版
 * @returns 本次落笔的脏矩形（图像像素坐标）
 */
export function paintMaskStroke(
  layer: RasterLayer,
  from: [number, number] | null,
  to: [number, number],
  brush: BrushSettings,
  selection: HTMLCanvasElement | null
): Rect {
  const mask = layer.mask;
  if (!mask) return { x: 0, y: 0, w: 0, h: 0 };
  ownMaskGray(mask);

  const bounds = strokeBounds(from, to, Math.max(0.5, brush.size / 2) + 1);
  const rect = clampRect(roundOutRect(bounds), mask.gray.width, mask.gray.height);
  if (!rect) return { x: 0, y: 0, w: 0, h: 0 };

  const ctx = mask.gray.getContext('2d');
  if (ctx) {
    if (!selection) {
      if (from) stampLine(ctx, from, to, brush);
      else stampDot(ctx, to[0], to[1], brush);
    } else {
      // 有选区：笔迹先落到一块与 rect 同尺寸的临时画布上，用选区裁掉外面，再整体合成回蒙版。
      // 选区裁剪单独用一块 **坐标基底干净** 的画布算 —— 映射是
      // `T(-rect)` 之后接「文档 → 图像」，这样临时画布的 (u,v) 恰好对应
      // 图像像素 (rect.x+u, rect.y+v)，与落笔所用的坐标系完全一致。
      const { canvas: temp, ctx: tctx } = createCanvas(rect.w, rect.h);
      tctx.translate(-rect.x, -rect.y);
      if (from) stampLine(tctx, from, to, brush);
      else stampDot(tctx, to[0], to[1], brush);

      const { canvas: clip, ctx: cctx } = createCanvas(rect.w, rect.h);
      cctx.translate(-rect.x, -rect.y);
      docToImageTransform(cctx, layer, mask.gray.width, mask.gray.height);
      cctx.drawImage(selection, 0, 0);

      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(clip, 0, 0);

      ctx.drawImage(temp, rect.x, rect.y);
    }
  }

  markMaskDirty(mask, rect);
  return rect;
}

/** 就地反相灰度蒙版（整张失效） */
export function invertMask(mask: LayerMask): void {
  ownMaskGray(mask);
  const ctx = mask.gray.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, mask.gray.width, mask.gray.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
    d[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  invalidateLayerMask(mask);
}
