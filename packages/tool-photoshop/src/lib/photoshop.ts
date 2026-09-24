/**
 * Photoshop 基础能力引擎（纯 Canvas 2D，零第三方依赖）
 *
 * 设计约定：
 * - 一份文档 = 若干张「与文档同尺寸」的图层画布，`layers[0]` 永远是**最上层**（与图层面板顺序一致），
 *   合成时从后往前绘制，因此数组顺序即 z 轴顺序。
 * - 所有几何（选区、裁剪框、笔迹）都用**文档像素坐标**，与缩放 / 视图无关。
 * - 选区只有矩形 / 椭圆两种形状 + 反向标记，足以支撑「全选 / 取消 / 反选 / 限定操作范围」，
 *   裁剪路径由 `ctx.clip()` 完成，避免维护整张遮罩位图。
 * - 工具不直接改图层对象，而是「画布原地修改」（`copyInto` 等）后再由页面提交历史，
 *   因此撤销 / 重做只需要深拷贝画布快照。
 */

import { clamp } from '@pmp/image-kit';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ===================== 画布基础 ===================== */

export function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

export function ctxOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext('2d') as CanvasRenderingContext2D;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const next = canvasOf(src.width, src.height);
  ctxOf(next).drawImage(src, 0, 0);
  return next;
}

/** 把 source 的内容整体写入 target（清空后覆盖），保留 target 的对象引用 */
export function copyInto(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  const ctx = ctxOf(target);
  resetCtx(ctx);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
}

export function resetCtx(ctx: CanvasRenderingContext2D) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.setLineDash([]);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ===================== 混合模式 ===================== */

export type BlendModeId =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: { id: BlendModeId; label: string }[] = [
  { id: 'normal', label: '正常' },
  { id: 'multiply', label: '正片叠底' },
  { id: 'screen', label: '滤色' },
  { id: 'overlay', label: '叠加' },
  { id: 'darken', label: '变暗' },
  { id: 'lighten', label: '变亮' },
  { id: 'color-dodge', label: '颜色减淡' },
  { id: 'color-burn', label: '颜色加深' },
  { id: 'hard-light', label: '强光' },
  { id: 'soft-light', label: '柔光' },
  { id: 'difference', label: '差值' },
  { id: 'exclusion', label: '排除' },
  { id: 'hue', label: '色相' },
  { id: 'saturation', label: '饱和度' },
  { id: 'color', label: '颜色' },
  { id: 'luminosity', label: '明度' }
];

export const blendOf = (id: BlendModeId): GlobalCompositeOperation =>
  id === 'normal' ? 'source-over' : id;

/* ===================== 图层 ===================== */

export interface PsLayer {
  id: string;
  name: string;
  visible: boolean;
  /** 0 ~ 1 */
  opacity: number;
  blend: BlendModeId;
  /** 与文档同尺寸的像素内容 */
  canvas: HTMLCanvasElement;
  /** 图层蒙版（与文档同尺寸，不透明 = 显示，透明 = 隐藏），null = 无蒙版 */
  mask: HTMLCanvasElement | null;
  /** 蒙版是否启用 */
  maskEnabled: boolean;
}

export function makeLayer(
  name: string,
  w: number,
  h: number,
  source?: HTMLCanvasElement | null
): PsLayer {
  const canvas = canvasOf(w, h);
  if (source) {
    ctxOf(canvas).drawImage(source, 0, 0, w, h);
  }
  return { id: uid(), name, visible: true, opacity: 1, blend: 'normal', canvas, mask: null, maskEnabled: true };
}

export function cloneLayer(layer: PsLayer): PsLayer {
  return {
    ...layer,
    canvas: cloneCanvas(layer.canvas),
    mask: layer.mask ? cloneCanvas(layer.mask) : null
  };
}

/** 新建一张全白（全显示）的图层蒙版 */
export function makeLayerMask(w: number, h: number): HTMLCanvasElement {
  const mask = canvasOf(w, h);
  const ctx = ctxOf(mask);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return mask;
}

/** 图层的实际显示内容（应用蒙版后）。无蒙版 / 停用时直接返回原画布 */
export function applyLayerMask(layer: PsLayer): HTMLCanvasElement {
  if (!layer.mask || !layer.maskEnabled) return layer.canvas;
  const out = canvasOf(layer.canvas.width, layer.canvas.height);
  const ctx = ctxOf(out);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layer.mask, 0, 0);
  return out;
}

/* ===================== 颜色 ===================== */

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = Number.parseInt(value.slice(0, 6) || '000000', 16);
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

/** 读取某个像素的颜色（画布坐标系），空白处返回 null */
export function samplePixel(canvas: HTMLCanvasElement, x: number, y: number): string | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  const data = ctxOf(canvas).getImageData(px, py, 1, 1).data;
  if (data[3] === 0) return null;
  return rgbToHex(data[0], data[1], data[2]);
}

/* ===================== 选区 ===================== */

export type SelectionKind = 'rect' | 'ellipse';

export interface RectSelection {
  kind: SelectionKind;
  rect: Rect;
  /** 反选后「除 rect 之外」的区域被选中 */
  inverted: boolean;
}

export interface MaskSelection {
  kind: 'mask';
  /** 文档尺寸蒙版画布，白色 = 选中 */
  mask: HTMLCanvasElement;
  inverted: boolean;
}

export type Selection = RectSelection | MaskSelection;

export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function clampRect(rect: Rect, maxW: number, maxH: number): Rect {
  const x = clamp(rect.x, 0, maxW);
  const y = clamp(rect.y, 0, maxH);
  return {
    x,
    y,
    w: clamp(rect.w, 0, maxW - x),
    h: clamp(rect.h, 0, maxH - y)
  };
}

/** 矩形 / 椭圆选区的路径（仅对形状型选区有效） */
export function selectionPath(
  ctx: CanvasRenderingContext2D,
  sel: RectSelection,
  docW: number,
  docH: number
) {
  ctx.beginPath();
  if (sel.kind === 'rect') {
    ctx.rect(sel.rect.x, sel.rect.y, sel.rect.w, sel.rect.h);
  } else {
    ctx.ellipse(
      sel.rect.x + sel.rect.w / 2,
      sel.rect.y + sel.rect.h / 2,
      Math.max(0.5, sel.rect.w / 2),
      Math.max(0.5, sel.rect.h / 2),
      0,
      0,
      Math.PI * 2
    );
  }
  if (sel.inverted) {
    ctx.rect(0, 0, docW, docH);
  }
}

/**
 * 在选区限定下执行绘制：形状选区用 ctx.clip，蒙版选区用「临时画布 + destination-in」合成。
 * draw 回调接收目标上下文（蒙版时为临时画布上下文）。
 */
export function runClipped(
  canvas: HTMLCanvasElement,
  sel: Selection | null | undefined,
  docW: number,
  docH: number,
  draw: (ctx: CanvasRenderingContext2D) => void
) {
  const ctx = ctxOf(canvas);
  if (!sel) {
    draw(ctx);
    return;
  }
  if (sel.kind !== 'mask') {
    ctx.save();
    selectionPath(ctx, sel, docW, docH);
    ctx.clip(sel.inverted ? 'evenodd' : 'nonzero');
    draw(ctx);
    ctx.restore();
    return;
  }
  // 蒙版选区：只替换「区域内」的绘制结果，区域外必须原样保留
  const temp = canvasOf(docW, docH);
  const tctx = ctxOf(temp);
  tctx.drawImage(canvas, 0, 0, docW, docH);
  draw(tctx);

  // 先算出「生效区域」遮罩（处理反选）。蒙版约定：白 + 不透明 = 落在区域内。
  let area = sel.mask;
  if (sel.inverted) {
    const inv = canvasOf(docW, docH);
    const ictx = ctxOf(inv);
    ictx.fillStyle = '#ffffff';
    ictx.fillRect(0, 0, docW, docH);
    ictx.globalCompositeOperation = 'destination-out';
    ictx.drawImage(sel.mask, 0, 0);
    area = inv;
  }

  // temp = 绘制结果 ∩ 区域
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(area, 0, 0);

  // 画布 = 原图在区域外的部分 + temp。
  // 这里必须先 destination-out 再叠加：否则区域外会被整片清空。
  // 羽化（半透明）蒙版下，两边都按 alpha 加权，边缘仍然是平滑过渡。
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(area, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}

export function buildSelection(
  kind: SelectionKind,
  a: { x: number; y: number },
  b: { x: number; y: number },
  docW: number,
  docH: number
): Selection | null {
  const rect = clampRect(normalizeRect(a, b), docW, docH);
  if (rect.w < 2 || rect.h < 2) return null;
  return { kind, rect, inverted: false };
}

export function selectAllSelection(docW: number, docH: number): Selection {
  return { kind: 'rect', rect: { x: 0, y: 0, w: docW, h: docH }, inverted: false };
}

export function invertSelection(
  sel: Selection,
  docW: number,
  docH: number
): Selection | null {
  if (sel.kind === 'mask') {
    const inv = canvasOf(docW, docH);
    const ctx = ctxOf(inv);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, docW, docH);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(sel.mask, 0, 0);
    return { kind: 'mask', mask: inv, inverted: false };
  }
  const next: RectSelection = { ...sel, inverted: !sel.inverted };
  if (next.inverted && next.rect.x === 0 && next.rect.y === 0 && next.rect.w === docW && next.rect.h === docH) {
    return null;
  }
  if (sel.inverted && sel.rect.w >= docW && sel.rect.h >= docH) {
    return selectAllSelection(docW, docH);
  }
  return next;
}

export function pointInSelection(sel: Selection | null | undefined, x: number, y: number): boolean {
  if (!sel) return true;
  if (sel.kind === 'mask') {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= sel.mask.width || py >= sel.mask.height) return false;
    const inside = ctxOf(sel.mask).getImageData(px, py, 1, 1).data[3] > 127;
    return sel.inverted ? !inside : inside;
  }
  const { rect, kind } = sel;
  let inside: boolean;
  if (kind === 'rect') {
    inside = x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  } else {
    const rx = Math.max(0.5, rect.w / 2);
    const ry = Math.max(0.5, rect.h / 2);
    const dx = (x - (rect.x + rx)) / rx;
    const dy = (y - (rect.y + ry)) / ry;
    inside = dx * dx + dy * dy <= 1;
  }
  return sel.inverted ? !inside : inside;
}

/** 魔棒：从种子点按容差做颜色连通选择，返回蒙版选区 */
export function selectionFromMagicWand(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number
): Selection | null {
  const w = source.width;
  const h = source.height;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const image = ctxOf(source).getImageData(0, 0, w, h);
  const data = image.data;
  const seed = (sy * w + sx) * 4;
  const target = [data[seed], data[seed + 1], data[seed + 2], data[seed + 3]];
  const limit = (clamp(tolerance, 0, 255) / 100) * 442;
  const similar = (i: number) => {
    const dr = data[i] - target[0];
    const dg = data[i + 1] - target[1];
    const db = data[i + 2] - target[2];
    const da = data[i + 3] - target[3];
    return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= limit;
  };

  const mask = canvasOf(w, h);
  const mctx = ctxOf(mask);
  const maskImg = mctx.createImageData(w, h);
  const mdata = maskImg.data;
  const visited = new Uint8Array(w * h);
  const stack = [sx, sy];
  let count = 0;
  while (stack.length) {
    const py = stack.pop() as number;
    const px = stack.pop() as number;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const key = py * w + px;
    if (visited[key]) continue;
    visited[key] = 1;
    if (!similar(key * 4)) continue;
    mdata[key * 4] = 255;
    mdata[key * 4 + 1] = 255;
    mdata[key * 4 + 2] = 255;
    mdata[key * 4 + 3] = 255;
    count += 1;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  if (count === 0) return null;
  mctx.putImageData(maskImg, 0, 0);
  return { kind: 'mask', mask, inverted: false };
}

/** 套索：由折线点集生成闭合多边形蒙版 */
export function selectionFromLasso(
  points: { x: number; y: number }[],
  docW: number,
  docH: number
): Selection | null {
  if (points.length < 3) return null;
  const mask = canvasOf(docW, docH);
  const ctx = ctxOf(mask);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  return { kind: 'mask', mask, inverted: false };
}

/** 由蒙版提取边界像素（白色描边），供蚂蚁线 / 轮廓显示 */
export function buildSelectionOutline(mask: HTMLCanvasElement): HTMLCanvasElement {
  const w = mask.width;
  const h = mask.height;
  const src = ctxOf(mask).getImageData(0, 0, w, h).data;
  const out = canvasOf(w, h);
  const octx = ctxOf(out);
  const img = octx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (src[i + 3] <= 127) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        src[((y - 1) * w + x) * 4 + 3] <= 127 ||
        src[((y + 1) * w + x) * 4 + 3] <= 127 ||
        src[(y * w + x - 1) * 4 + 3] <= 127 ||
        src[(y * w + x + 1) * 4 + 3] <= 127;
      if (edge) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = 255;
      }
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** 把蒙版染成带透明度的纯色（选区预览用） */
export function colorizeMask(mask: HTMLCanvasElement, color: string, alpha: number): HTMLCanvasElement {
  const out = canvasOf(mask.width, mask.height);
  const ctx = ctxOf(out);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.globalAlpha = 1;
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** 蒙版编辑的宝石红预览：隐藏（透明）区域染成半透明红 */
export function maskRubyOverlay(mask: HTMLCanvasElement, alpha = 0.5): HTMLCanvasElement {
  const out = canvasOf(mask.width, mask.height);
  const ctx = ctxOf(out);
  ctx.fillStyle = `rgba(255,0,0,${clamp(alpha, 0, 1)})`;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** 任意选区栅格化为蒙版（白色 = 选中） */
export function selectionToMask(sel: Selection, docW: number, docH: number): HTMLCanvasElement {
  if (sel.kind === 'mask') return sel.mask;
  const mask = canvasOf(docW, docH);
  const ctx = ctxOf(mask);
  ctx.fillStyle = '#ffffff';
  selectionPath(ctx, sel, docW, docH);
  ctx.fill(sel.inverted ? 'evenodd' : 'nonzero');
  return mask;
}

/** 对蒙版做高斯模糊 */
export function blurMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const r = Math.max(0, radius);
  if (r <= 0) return cloneCanvas(mask);
  const out = canvasOf(mask.width, mask.height);
  const ctx = ctxOf(out);
  ctx.filter = `blur(${r}px)`;
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** 羽化选区：任何形状选区 → 模糊后的蒙版选区 */
export function featherSelection(
  sel: Selection,
  docW: number,
  docH: number,
  radius: number
): Selection {
  const mask = selectionToMask(sel, docW, docH);
  return { kind: 'mask', mask: blurMask(mask, radius), inverted: false };
}

/* ===================== 画笔 ===================== */

export interface BrushOpts {
  size: number;
  /** 0 ~ 100，越大边缘越硬 */
  hardness: number;
  /** 0 ~ 1 */
  alpha: number;
  color: string;
  erase?: boolean;
}

export function stampDot(ctx: CanvasRenderingContext2D, x: number, y: number, opts: BrushOpts) {
  const r = Math.max(0.5, opts.size / 2);
  const alpha = clamp(opts.alpha, 0, 1);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = opts.erase ? 'destination-out' : 'source-over';
  if (opts.hardness >= 99 || r <= 1) {
    ctx.fillStyle = opts.color;
  } else {
    const inner = clamp(opts.hardness / 100, 0, 0.99) * r;
    const gradient = ctx.createRadialGradient(x, y, inner, x, y, r);
    gradient.addColorStop(0, opts.color);
    gradient.addColorStop(1, withAlpha(opts.color, 0));
    ctx.fillStyle = gradient;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 两点之间按笔梳间距补点，得到连续的笔迹 */
export function stampSegment(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: BrushOpts
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, opts.size * 0.12);
  const count = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= count; i += 1) {
    stampDot(ctx, from.x + (dx * i) / count, from.y + (dy * i) / count, opts);
  }
}

/* ===================== 像素操作 ===================== */

/**
 * 像素化（马赛克）一份画布内容，返回新画布，不改原图。
 *
 * 做法：先按 `block` 粒度**降采样**（开启插值 → 取块内均值，比直接抽样自然），
 * 再用**最近邻**放大回原尺寸 → 得到边界清晰的方块。
 */
export function pixelateCopy(source: HTMLCanvasElement, block: number): HTMLCanvasElement {
  const width = source.width;
  const height = source.height;
  const size = Math.max(2, Math.round(block));
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));

  const small = canvasOf(cols, rows);
  const sctx = ctxOf(small);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, 0, 0, width, height, 0, 0, cols, rows);

  const out = canvasOf(width, height);
  const octx = ctxOf(out);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, cols, rows, 0, 0, width, height);
  return out;
}

/** 就地像素化整幅画布（受选区限制）：给「调整」面板的一键马赛克用 */
export function pixelateInPlace(
  canvas: HTMLCanvasElement,
  block: number,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  const pixelated = pixelateCopy(canvas, block);
  runClipped(canvas, sel, docW, docH, (ctx) => {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, docW, docH);
    ctx.drawImage(pixelated, 0, 0);
  });
}

/** 马赛克笔刷的落笔状态 */
export interface MosaicStrokeState {
  /** 落笔前的目标画布副本（每帧用它复原「还没涂到」的地方） */
  snapshot: HTMLCanvasElement;
  /** snapshot 的像素化版本 */
  mosaic: HTMLCanvasElement;
  /** 已涂抹区域的白色遮罩（跨帧累积） */
  mask: HTMLCanvasElement;
  /** 复用的一块临时画布，避免每帧分配 */
  scratch: HTMLCanvasElement;
}

/** 建立马赛克笔刷的落笔状态（pointerdown 时调用一次） */
export function beginMosaicStroke(
  target: HTMLCanvasElement,
  block: number,
  docW: number,
  docH: number
): MosaicStrokeState {
  const snapshot = cloneCanvas(target);
  return {
    snapshot,
    mosaic: pixelateCopy(snapshot, block),
    mask: canvasOf(docW, docH),
    scratch: canvasOf(docW, docH)
  };
}

/**
 * 涂一段马赛克笔迹（可反复调用：内部累积遮罩后重新合成整幅）。
 *
 * 关键点：**源图固定为落笔前的 snapshot**，用累积遮罩把它叠回原图。
 * 若改成「每帧拿当前画布再像素化一次」，格子会随鼠标速度越涂越大、结果不可复现 ——
 * 这也是 Konva 编辑器的马赛克笔刷采用的同一套做法。
 *
 * 代价是每帧整幅合成；与橡皮擦逐帧 `runClipped` 的开销同级，超大画布可以再按脏矩形优化。
 */
export function mosaicStrokeSegment(
  state: MosaicStrokeState,
  target: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  brushSize: number,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  // 1) 笔迹累积到遮罩：纯白、硬边、不透明（不透明才不会叠加变浓）
  stampSegment(ctxOf(state.mask), from, to, {
    size: brushSize,
    hardness: 100,
    alpha: 1,
    color: '#ffffff'
  });

  // 2) scratch = 像素化源图 ∩ 遮罩
  const sctx = ctxOf(state.scratch);
  sctx.globalCompositeOperation = 'source-over';
  sctx.clearRect(0, 0, docW, docH);
  sctx.drawImage(state.mosaic, 0, 0);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(state.mask, 0, 0);
  sctx.globalCompositeOperation = 'source-over';

  // 3) 目标 = 原图 ⊕ scratch（受选区限制）
  runClipped(target, sel, docW, docH, (ctx) => {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, docW, docH);
    ctx.drawImage(state.snapshot, 0, 0);
    ctx.drawImage(state.scratch, 0, 0);
  });
}

export function fillSelection(
  canvas: HTMLCanvasElement,
  sel: Selection | null,
  color: string,
  docW: number,
  docH: number
) {
  runClipped(canvas, sel, docW, docH, (ctx) => {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, docW, docH);
  });
}

/** 删除选区内容（无选区 = 清空图层） */
export function clearSelection(
  canvas: HTMLCanvasElement,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  runClipped(canvas, sel, docW, docH, (ctx) => {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, docW, docH);
  });
}

/** 容差油漆桶（四点扫描线），返回是否发生了填充 */
export function floodFill(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  color: string,
  tolerance: number,
  sel: Selection | null,
  docW: number,
  docH: number
): boolean {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= docW || sy >= docH) return false;
  const ctx = ctxOf(canvas);
  const image = ctx.getImageData(0, 0, docW, docH);
  const data = image.data;
  const seed = (sy * docW + sx) * 4;
  const target = [data[seed], data[seed + 1], data[seed + 2], data[seed + 3]];
  const { r, g, b } = hexToRgb(color);
  const limit = (clamp(tolerance, 0, 255) / 100) * 442;
  const similar = (index: number) => {
    const dr = data[index] - target[0];
    const dg = data[index + 1] - target[1];
    const db = data[index + 2] - target[2];
    const da = data[index + 3] - target[3];
    return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= limit;
  };
  // 颜色已经一致就没必要重画
  if (limit === 0 && target[0] === r && target[1] === g && target[2] === b && target[3] === 255) {
    return false;
  }

  const visited = new Uint8Array(docW * docH);
  const stack: number[] = [sx, sy];
  let filled = false;
  while (stack.length) {
    const py = stack.pop() as number;
    const px = stack.pop() as number;
    if (px < 0 || py < 0 || px >= docW || py >= docH) continue;
    const key = py * docW + px;
    if (visited[key]) continue;
    if (!pointInSelection(sel, px + 0.5, py + 0.5)) continue;
    if (!similar(key * 4)) continue;
    visited[key] = 1;
    data[key * 4] = r;
    data[key * 4 + 1] = g;
    data[key * 4 + 2] = b;
    data[key * 4 + 3] = 255;
    filled = true;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  if (filled) ctx.putImageData(image, 0, 0);
  return filled;
}

export type GradientKind = 'linear' | 'radial';

export function drawGradient(
  canvas: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  kind: GradientKind,
  colorA: string,
  colorB: string,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  runClipped(canvas, sel, docW, docH, (c) => {
    const radius = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
    const gradient =
      kind === 'linear'
        ? c.createLinearGradient(from.x, from.y, to.x, to.y)
        : c.createRadialGradient(from.x, from.y, 0, from.x, from.y, radius);
    gradient.addColorStop(0, colorA);
    gradient.addColorStop(1, colorB);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = gradient;
    c.fillRect(0, 0, docW, docH);
  });
}

/* ===================== 形状 / 文字 ===================== */

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

export interface ShapeOpts {
  kind: ShapeKind;
  color: string;
  lineWidth: number;
  /** 是否填充（直线 / 箭头恒为描边） */
  fill: boolean;
  /** shift 约束：正方形 / 正圆 / 水平垂直直线 */
  constrain: boolean;
}

export function shapeEndpoints(
  kind: ShapeKind,
  a: { x: number; y: number },
  b: { x: number; y: number },
  constrain: boolean
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  if (!constrain) return { a, b };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (kind === 'line' || kind === 'arrow') {
    return Math.abs(dx) >= Math.abs(dy)
      ? { a, b: { x: b.x, y: a.y } }
      : { a, b: { x: a.x, y: b.y } };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { a, b: { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side } };
}

/** 在任意上下文（可为已缩放 / 选区预览）中绘制形状 */
export function paintShape(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: ShapeOpts
) {
  const { a, b } = shapeEndpoints(opts.kind, from, to, opts.constrain);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, opts.lineWidth);
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  if (opts.kind === 'rect') {
    const rect = normalizeRect(a, b);
    if (opts.fill) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    else ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  if (opts.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2,
      Math.abs(b.y - a.y) / 2,
      0,
      0,
      Math.PI * 2
    );
    if (opts.fill) ctx.fill();
    else ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  if (opts.kind === 'arrow') {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(10, opts.lineWidth * 3.2);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
}

export function drawShape(
  canvas: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: ShapeOpts,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  runClipped(canvas, sel, docW, docH, (c) => paintShape(c, from, to, opts));
}

export type FontId = 'sans' | 'serif' | 'mono' | 'kaiti';

export const PS_FONTS: { id: FontId; label: string; stack: string }[] = [
  { id: 'sans', label: '黑体', stack: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'serif', label: '宋体', stack: '"Songti SC", SimSun, serif' },
  { id: 'kaiti', label: '楷体', stack: 'Kaiti SC, KaiTi, serif' },
  { id: 'mono', label: '等宽', stack: '"SF Mono", Menlo, Consolas, monospace' }
];

export function fontStackOf(id: FontId): string {
  return PS_FONTS.find((f) => f.id === id)?.stack ?? PS_FONTS[0].stack;
}

export function cssFontOf(opts: TextOpts): string {
  return `${opts.italic ? 'italic ' : ''}${opts.bold ? '700 ' : '400 '}${opts.size}px ${fontStackOf(opts.font)}`;
}

export interface TextOpts {
  font: FontId;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

export function textBlockSize(text: string, opts: TextOpts) {
  const ctx = ctxOf(canvasOf(1, 1));
  ctx.font = cssFontOf(opts);
  const lines = text.split('\n');
  const lineHeight = opts.size * 1.25;
  const width = Math.max(1, ...lines.map((line) => ctx.measureText(line || ' ').width));
  return { width, height: Math.max(lineHeight, lines.length * lineHeight), lineHeight };
}

export function drawText(
  canvas: HTMLCanvasElement,
  text: string,
  x: number,
  y: number,
  opts: TextOpts,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  if (!text.trim()) return;
  const { lineHeight } = textBlockSize(text, opts);
  runClipped(canvas, sel, docW, docH, (c) => {
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = opts.color;
    c.textBaseline = 'top';
    c.font = cssFontOf(opts);
    text.split('\n').forEach((line, index) => {
      c.fillText(line, x, y + index * lineHeight);
    });
  });
}

/* ===================== 调整 / 滤镜 ===================== */

export interface AdjustValues {
  /** -100 ~ 100 */
  brightness: number;
  contrast: number;
  saturation: number;
  /** -180 ~ 180 */
  hue: number;
  /** 0 ~ 50 px */
  blur: number;
}

export const DEFAULT_ADJUST: AdjustValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0
};

export function isNeutralAdjust(v: AdjustValues): boolean {
  return (
    v.brightness === 0 && v.contrast === 0 && v.saturation === 0 && v.hue === 0 && v.blur === 0
  );
}

export function adjustCss(v: AdjustValues): string {
  return [
    `brightness(${100 + v.brightness}%)`,
    `contrast(${100 + v.contrast}%)`,
    `saturate(${100 + v.saturation}%)`,
    `hue-rotate(${v.hue}deg)`,
    `blur(${v.blur}px)`
  ].join(' ');
}

/** 用 CSS filter 原地重写画布内容（受选区限制） */
export function filterInPlace(
  canvas: HTMLCanvasElement,
  css: string,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  if (!css || css === 'none') return;
  const tmp = canvasOf(canvas.width, canvas.height);
  const tctx = ctxOf(tmp);
  tctx.filter = css;
  tctx.drawImage(canvas, 0, 0);
  runClipped(canvas, sel, docW, docH, (c) => {
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, docW, docH);
    c.drawImage(tmp, 0, 0);
  });
}

/** USM 风格的 3x3 锐化 */
export function sharpenInPlace(
  canvas: HTMLCanvasElement,
  amount: number,
  sel: Selection | null,
  docW: number,
  docH: number
) {
  const strength = clamp(amount, 0, 2);
  if (strength <= 0) return;
  const ctx = ctxOf(canvas);
  const image = ctx.getImageData(0, 0, docW, docH);
  const src = new Uint8ClampedArray(image.data);
  const out = image.data;
  const center = 1 + 4 * strength;
  const side = -strength;
  for (let y = 1; y < docH - 1; y += 1) {
    for (let x = 1; x < docW - 1; x += 1) {
      if (!pointInSelection(sel, x + 0.5, y + 0.5)) continue;
      const i = (y * docW + x) * 4;
      const up = i - docW * 4;
      const down = i + docW * 4;
      const left = i - 4;
      const right = i + 4;
      for (let c = 0; c < 3; c += 1) {
        out[i + c] = clamp(
          center * src[i + c] +
            side * (src[up + c] + src[down + c] + src[left + c] + src[right + c]),
          0,
          255
        );
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

/* ===================== 变换 ===================== */

export function flipCanvas(canvas: HTMLCanvasElement, axis: 'h' | 'v'): HTMLCanvasElement {
  const { width: w, height: h } = canvas;
  const next = canvasOf(w, h);
  const ctx = ctxOf(next);
  ctx.translate(axis === 'h' ? w : 0, axis === 'v' ? h : 0);
  ctx.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1);
  ctx.drawImage(canvas, 0, 0);
  return next;
}

export function translateCanvas(canvas: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement {
  const next = canvasOf(canvas.width, canvas.height);
  ctxOf(next).drawImage(canvas, dx, dy);
  return next;
}

/** 图层内容绕中心旋转 90°（超出文档范围的部分被裁掉，与 PS 的图层旋转一致） */
export function rotateLayer90(canvas: HTMLCanvasElement, dir: 'cw' | 'ccw'): HTMLCanvasElement {
  const { width: w, height: h } = canvas;
  const next = canvasOf(w, h);
  const ctx = ctxOf(next);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((dir === 'cw' ? Math.PI : -Math.PI) / 2);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return next;
}

export interface DocTransformResult {
  layers: PsLayer[];
  width: number;
  height: number;
}

/** 整幅图像旋转 90°（文档尺寸随之互换） */
export function rotateDocument(
  layers: PsLayer[],
  w: number,
  h: number,
  dir: 'cw' | 'ccw'
): DocTransformResult {
  const next = layers.map((layer) => {
    const canvas = canvasOf(h, w);
    const ctx = ctxOf(canvas);
    if (dir === 'cw') {
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, w);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(layer.canvas, 0, 0);
    return { ...layer, canvas };
  });
  return { layers: next, width: h, height: w };
}

export function cropDocument(layers: PsLayer[], rect: Rect): DocTransformResult {
  const width = Math.max(1, Math.round(rect.w));
  const height = Math.max(1, Math.round(rect.h));
  const sx = Math.round(rect.x);
  const sy = Math.round(rect.y);
  const next = layers.map((layer) => {
    const canvas = canvasOf(width, height);
    ctxOf(canvas).drawImage(layer.canvas, sx, sy, width, height, 0, 0, width, height);
    return { ...layer, canvas };
  });
  return { layers: next, width, height };
}

/** 按长边等比缩放整份文档（图像大小） */
export function scaleDocument(
  layers: PsLayer[],
  w: number,
  h: number,
  factor: number
): DocTransformResult {
  const width = Math.max(1, Math.round(w * factor));
  const height = Math.max(1, Math.round(h * factor));
  const next = layers.map((layer) => {
    const canvas = canvasOf(width, height);
    const ctx = ctxOf(canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    return { ...layer, canvas };
  });
  return { layers: next, width, height };
}

/** 重采样整份文档到指定尺寸（图像大小，非等比），蒙版一并缩放 */
export function resizeDocument(
  layers: PsLayer[],
  newW: number,
  newH: number
): DocTransformResult {
  const width = Math.max(1, Math.round(newW));
  const height = Math.max(1, Math.round(newH));
  const next = layers.map((layer) => {
    const canvas = canvasOf(width, height);
    const ctx = ctxOf(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    const mask = layer.mask ? resampleCanvas(layer.mask, width, height) : null;
    return { ...layer, canvas, mask };
  });
  return { layers: next, width, height };
}

function resampleCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const out = canvasOf(w, h);
  const ctx = ctxOf(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return out;
}

/** 画布大小：不改图层内容，按锚点把原内容贴回新的画布，蒙版一并偏移 */
export function canvasSizeDocument(
  layers: PsLayer[],
  w: number,
  h: number,
  newW: number,
  newH: number,
  anchorX: number,
  anchorY: number
): DocTransformResult {
  const width = Math.max(1, Math.round(newW));
  const height = Math.max(1, Math.round(newH));
  const ox = Math.round((width - w) * anchorX);
  const oy = Math.round((height - h) * anchorY);
  const next = layers.map((layer) => {
    const canvas = canvasOf(width, height);
    ctxOf(canvas).drawImage(layer.canvas, ox, oy);
    let mask: HTMLCanvasElement | null = null;
    if (layer.mask) {
      mask = canvasOf(width, height);
      ctxOf(mask).drawImage(layer.mask, ox, oy);
    }
    return { ...layer, canvas, mask };
  });
  return { layers: next, width, height };
}

/** 把 index 处的图层合并到它下面一层，返回新数组 */
export function mergeDown(layers: PsLayer[], index: number): PsLayer[] {
  if (index < 0 || index >= layers.length - 1) return layers;
  const upper = layers[index];
  const lower = layers[index + 1];
  const merged = cloneCanvas(applyLayerMask(lower));
  const ctx = ctxOf(merged);
  ctx.globalAlpha = clamp(upper.opacity, 0, 1);
  ctx.globalCompositeOperation = blendOf(upper.blend);
  if (upper.visible) ctx.drawImage(applyLayerMask(upper), 0, 0);
  const next = layers.filter((_, i) => i !== index && i !== index + 1);
  const layer: PsLayer = {
    id: lower.id,
    name: lower.name,
    visible: true,
    opacity: lower.opacity,
    blend: lower.blend,
    canvas: merged,
    mask: null,
    maskEnabled: true
  };
  return [...next.slice(0, index), layer, ...next.slice(index)];
}

/* ===================== 合成 ===================== */

export interface PaintOpts {
  docW: number;
  docH: number;
  /** 激活图层（预览滤镜 / 移动偏移 / 描边缓冲只作用于它） */
  activeId?: string | null;
  /** 激活图层上的预览滤镜（CSS filter 字符串） */
  activeFilter?: string;
  /** 正在进行的描边缓冲（画笔实时预览） */
  stroke?: { canvas: HTMLCanvasElement; alpha: number } | null;
  /** 激活图层的临时位移（移动工具实时预览） */
  offset?: { x: number; y: number } | null;
  /** 参与偏移的图层 id（多选移动）；缺省只作用于 activeId */
  offsetIds?: string[] | null;
  /** 自由变换参数（平移 + 缩放 + 旋转，围绕内容包围盒中心） */
  transform?: FreeTransform | null;
  /** 参与自由变换的图层 id（多选变换）；缺省不作用于任何图层 */
  transformIds?: string[] | null;
  /** 自由变换的内容包围盒（缺省按整幅文档） */
  transformBounds?: Rect | null;
  selection?: Selection | null;
}

/** 按「索引 0 为最上层」的顺序把图层画进任意上下文（可为已缩放 / 已平移的显示上下文） */
export function paintLayers(
  ctx: CanvasRenderingContext2D,
  layers: PsLayer[],
  opts: PaintOpts
) {
  const {
    docW,
    docH,
    activeId = null,
    activeFilter = 'none',
    stroke = null,
    offset = null,
    offsetIds = null,
    transform = null,
    transformIds = null,
    transformBounds = null
  } = opts;
  const tb = transformBounds ?? { x: 0, y: 0, w: docW, h: docH };
  const tbx = tb.x + tb.w / 2;
  const tby = tb.y + tb.h / 2;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (!layer.visible || layer.opacity <= 0) continue;
    const isActive = layer.id === activeId;
    const isOffset = offsetIds ? offsetIds.includes(layer.id) : isActive;
    const inTransform = transformIds ? transformIds.includes(layer.id) : false;
    const dx = isOffset && offset ? offset.x : 0;
    const dy = isOffset && offset ? offset.y : 0;
    const content = applyLayerMask(layer);
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = blendOf(layer.blend);
    if (isActive && activeFilter && activeFilter !== 'none') ctx.filter = activeFilter;
    if (inTransform && transform) {
      ctx.translate(tbx + transform.tx, tby + transform.ty);
      ctx.rotate((transform.angle * Math.PI) / 180);
      ctx.scale(transform.sx, transform.sy);
      ctx.drawImage(content, -tbx, -tby);
    } else {
      ctx.drawImage(content, dx, dy);
    }
    ctx.restore();

    if (isActive && stroke) {
      ctx.save();
      if (opts.selection && opts.selection.kind !== 'mask') {
        selectionPath(ctx, opts.selection, docW, docH);
        ctx.clip(opts.selection.inverted ? 'evenodd' : 'nonzero');
      }
      ctx.globalAlpha = clamp(layer.opacity * stroke.alpha, 0, 1);
      ctx.globalCompositeOperation = blendOf(layer.blend);
      ctx.drawImage(stroke.canvas, dx, dy);
      ctx.restore();
    }
  }
}

/** 自由变换参数：围绕图层中心的平移 / 缩放 / 旋转 */
export interface FreeTransform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  angle: number;
}

export const IDENTITY_TRANSFORM: FreeTransform = { tx: 0, ty: 0, sx: 1, sy: 1, angle: 0 };

/** 图层内容的非透明像素包围盒（文档坐标），全透明返回 null */
export function contentBounds(canvas: HTMLCanvasElement): Rect | null {
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return null;
  const data = ctxOf(canvas).getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      if (data[(row + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 多张画布内容包围盒的并集，全部为空返回 null */
export function unionContentBounds(canvases: HTMLCanvasElement[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const canvas of canvases) {
    const b = contentBounds(canvas);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 把自由变换烘焙进一张新画布（围绕内容包围盒中心变换，尺寸不变，超出部分裁掉） */
export function bakeFreeTransform(
  canvas: HTMLCanvasElement,
  t: FreeTransform,
  bounds: Rect,
  docW: number,
  docH: number
): HTMLCanvasElement {
  const out = canvasOf(docW, docH);
  const ctx = ctxOf(out);
  ctx.imageSmoothingQuality = 'high';
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  ctx.translate(cx + t.tx, cy + t.ty);
  ctx.rotate((t.angle * Math.PI) / 180);
  ctx.scale(t.sx, t.sy);
  ctx.drawImage(canvas, -cx, -cy, docW, docH);
  return out;
}

/** 合并所有可见图层为一张画布（导出 / 吸管取样 / 缩略图） */
export function flattenTo(layers: PsLayer[], w: number, h: number): HTMLCanvasElement {
  const canvas = canvasOf(w, h);
  paintLayers(ctxOf(canvas), layers, { docW: w, docH: h });
  return canvas;
}

/* ===================== 拼图（多图拼接） ===================== */

export interface CollageOptions {
  width: number;
  gap: number;
  background: string;
  radius: number;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(Math.max(0, r), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 把图片 cover（居中裁剪）画进指定矩形，支持圆角 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = img.width * scale;
  const sh = img.height * scale;
  const sx = (sw - w) / 2;
  const sy = (sh - h) / 2;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x - sx, y - sy, sw, sh);
  ctx.restore();
}

/** 网格拼图：cols × rows 个等尺寸方格（cover 填充） */
export function buildGridCollage(
  images: (HTMLImageElement | HTMLCanvasElement)[],
  cols: number,
  rows: number,
  opts: CollageOptions
): HTMLCanvasElement {
  const gap = Math.max(0, opts.gap);
  const cellW = (opts.width - gap * (cols - 1)) / cols;
  const cellH = cellW;
  const canvas = canvasOf(opts.width, Math.round(cellH * rows + gap * (rows - 1)));
  const ctx = ctxOf(canvas);
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.slice(0, cols * rows).forEach((img, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    drawImageCover(ctx, img, c * (cellW + gap), r * (cellH + gap), cellW, cellH, opts.radius);
  });
  return canvas;
}

/** 长图拼接：纵向 / 横向按各自宽高比首尾相连 */
export function buildStackCollage(
  images: (HTMLImageElement | HTMLCanvasElement)[],
  vertical: boolean,
  opts: CollageOptions
): HTMLCanvasElement {
  const gap = Math.max(0, opts.gap);
  if (images.length === 0) return canvasOf(opts.width, opts.width);
  if (vertical) {
    const width = opts.width;
    const heights = images.map((img) => (img.height / img.width) * width);
    const height = heights.reduce((s, h) => s + h, 0) + gap * (images.length - 1);
    const canvas = canvasOf(width, Math.round(height));
    const ctx = ctxOf(canvas);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    images.forEach((img, i) => {
      const h = heights[i];
      ctx.save();
      roundRectPath(ctx, 0, y, width, h, opts.radius);
      ctx.clip();
      ctx.drawImage(img, 0, y, width, h);
      ctx.restore();
      y += h + gap;
    });
    return canvas;
  }
  const height = opts.width;
  const widths = images.map((img) => (img.width / img.height) * height);
  const width = widths.reduce((s, w) => s + w, 0) + gap * (images.length - 1);
  const canvas = canvasOf(Math.round(width), height);
  const ctx = ctxOf(canvas);
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  images.forEach((img, i) => {
    const w = widths[i];
    ctx.save();
    roundRectPath(ctx, x, 0, w, height, opts.radius);
    ctx.clip();
    ctx.drawImage(img, x, 0, w, height);
    ctx.restore();
    x += w + gap;
  });
  return canvas;
}
