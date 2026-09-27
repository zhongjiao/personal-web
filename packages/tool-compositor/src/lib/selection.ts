import { createCanvas, type Rect } from './document';

/**
 * 选区：一张**文档尺寸的 alpha 蒙版**（alpha 即覆盖率）。
 *
 * 所有操作都返回**新的画布**、从不就地修改 —— 这样历史快照直接存引用即可，
 * 不需要像蒙版那样做写时复制。
 *
 * 选区属于会话状态：`.comp` 规范里没有它（和撤销历史、视口同级），所以不参与序列化。
 */

export type Selection = HTMLCanvasElement;

export type SelectionCombine = 'replace' | 'add' | 'subtract' | 'intersect';

const ALPHA_THRESHOLD = 128;

function blank(width: number, height: number, fillWhite: boolean): Selection {
  const { canvas, ctx } = createCanvas(width, height);
  if (fillWhite) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** 全选 */
export const selectAll = (width: number, height: number): Selection =>
  blank(width, height, true);

/** 空选区（alpha 全 0） */
export const emptySelection = (width: number, height: number): Selection =>
  blank(width, height, false);

export function cloneSelection(selection: Selection): Selection {
  const { canvas, ctx } = createCanvas(selection.width, selection.height);
  ctx.drawImage(selection, 0, 0);
  return canvas;
}

export function isEmptySelection(selection: Selection | null): boolean {
  if (!selection) return true;
  const ctx = selection.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true;
  const d = ctx.getImageData(0, 0, selection.width, selection.height).data;
  // 抽样即可：只要有一个像素有覆盖率就算非空
  for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 8) return false;
  return true;
}

/* ────────────────────────────── 构造 ────────────────────────────── */

export function rectSelection(
  width: number,
  height: number,
  rect: Rect,
  ellipse: boolean
): Selection {
  const selection = emptySelection(width, height);
  const ctx = selection.getContext('2d');
  if (!ctx) return selection;
  ctx.fillStyle = '#fff';
  if (ellipse) {
    ctx.beginPath();
    ctx.ellipse(
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
      Math.abs(rect.w) / 2,
      Math.abs(rect.h) / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  } else {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  return selection;
}

export function lassoSelection(
  width: number,
  height: number,
  points: [number, number][]
): Selection {
  const selection = emptySelection(width, height);
  if (points.length < 3) return selection;
  const ctx = selection.getContext('2d');
  if (!ctx) return selection;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  return selection;
}

/**
 * 魔棒：按颜色相似度取选区。
 * `contiguous` 为 true 时用栈做四连通洪水填充，否则全局匹配。
 */
export function wandSelection(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number,
  contiguous: boolean
): Selection {
  const width = source.width;
  const height = source.height;
  const selection = emptySelection(width, height);
  const sctx = source.getContext('2d', { willReadFrequently: true });
  const octx = selection.getContext('2d');
  if (!sctx || !octx || x < 0 || y < 0 || x >= width || y >= height) return selection;

  const src = sctx.getImageData(0, 0, width, height).data;
  const out = octx.createImageData(width, height);
  const dst = out.data;

  const start = (y * width + x) * 4;
  const r0 = src[start];
  const g0 = src[start + 1];
  const b0 = src[start + 2];
  const a0 = src[start + 3];
  const limit = tolerance * tolerance * 3;

  const matches = (index: number): boolean => {
    if (src[index + 3] === 0 && a0 === 0) return true;
    const dr = src[index] - r0;
    const dg = src[index + 1] - g0;
    const db = src[index + 2] - b0;
    return dr * dr + dg * dg + db * db <= limit;
  };

  if (!contiguous) {
    for (let i = 0; i < src.length; i += 4) {
      if (!matches(i)) continue;
      dst[i] = 255;
      dst[i + 1] = 255;
      dst[i + 2] = 255;
      dst[i + 3] = 255;
    }
  } else {
    const visited = new Uint8Array(width * height);
    const stack: number[] = [y * width + x];
    while (stack.length) {
      const pixel = stack.pop() as number;
      if (visited[pixel]) continue;
      visited[pixel] = 1;
      if (!matches(pixel * 4)) continue;
      dst[pixel * 4] = 255;
      dst[pixel * 4 + 1] = 255;
      dst[pixel * 4 + 2] = 255;
      dst[pixel * 4 + 3] = 255;

      const px = pixel % width;
      const py = (pixel - px) / width;
      // 洪水填充只扩展已匹配的像素，因此边界天然闭合
      if (px > 0) stack.push(pixel - 1);
      if (px < width - 1) stack.push(pixel + 1);
      if (py > 0) stack.push(pixel - width);
      if (py < height - 1) stack.push(pixel + width);
    }
  }

  octx.putImageData(out, 0, 0);
  return selection;
}

/* ────────────────────────────── 组合与变换 ────────────────────────────── */

export function combineSelection(
  base: Selection | null,
  next: Selection,
  mode: SelectionCombine
): Selection {
  if (mode === 'replace' || !base) return next;
  const { canvas, ctx } = createCanvas(next.width, next.height);
  ctx.drawImage(base, 0, 0);
  if (mode === 'add') ctx.globalCompositeOperation = 'lighter';
  else if (mode === 'subtract') ctx.globalCompositeOperation = 'destination-out';
  else ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(next, 0, 0);
  return canvas;
}

export function invertSelection(selection: Selection | null, width: number, height: number): Selection {
  const { canvas, ctx } = createCanvas(width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  if (selection) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(selection, 0, 0);
  }
  return canvas;
}

/** 圆形采样数：48 个方向对半径的逼近误差在 1px 以内，且与半径无关 */
const ROUND_SAMPLES = 48;

/** 膨胀（扩展）；radius <= 0 时原样返回 */
export function expandSelection(selection: Selection, radius: number): Selection {
  const r = Math.round(radius);
  if (r <= 0) return cloneSelection(selection);
  const { canvas, ctx } = createCanvas(selection.width, selection.height);
  for (let i = 0; i < ROUND_SAMPLES; i += 1) {
    const angle = (i / ROUND_SAMPLES) * Math.PI * 2;
    ctx.drawImage(selection, Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return canvas;
}

/** 腐蚀（收缩）：先铺满，再逐方向求交 */
export function contractSelection(selection: Selection, radius: number): Selection {
  const r = Math.round(radius);
  if (r <= 0) return cloneSelection(selection);
  const { canvas, ctx } = createCanvas(selection.width, selection.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  for (let i = 0; i < ROUND_SAMPLES; i += 1) {
    const angle = (i / ROUND_SAMPLES) * Math.PI * 2;
    ctx.drawImage(selection, -Math.cos(angle) * r, -Math.sin(angle) * r);
  }
  return canvas;
}

export function featherSelection(selection: Selection, radius: number): Selection {
  if (radius <= 0) return cloneSelection(selection);
  const pad = Math.ceil(radius * 2);
  const { canvas: padded, ctx: pctx } = createCanvas(
    selection.width + pad * 2,
    selection.height + pad * 2
  );
  pctx.drawImage(selection, pad, pad);
  const { canvas, ctx } = createCanvas(selection.width, selection.height);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(padded, -pad, -pad);
  return canvas;
}

export function selectionBounds(selection: Selection | null): Rect | null {
  if (!selection) return null;
  const ctx = selection.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = selection;
  const d = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (d[row + x * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 生成「蚂蚁线」轮廓层：边界像素按 `(x + y) >> 3` 交错涂黑 / 白。
 * 只在选区变化时重算一次，不参与逐帧动画。
 */
export function selectionOutline(selection: Selection | null): HTMLCanvasElement | null {
  if (!selection) return null;
  const { width, height } = selection;
  const sctx = selection.getContext('2d', { willReadFrequently: true });
  const { canvas, ctx } = createCanvas(width, height);
  if (!sctx) return canvas;

  const src = sctx.getImageData(0, 0, width, height).data;
  const out = ctx.createImageData(width, height);
  const dst = out.data;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && src[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      const isEdge =
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (!isEdge) continue;
      const value = ((x + y) >> 3) % 2 === 0 ? 0 : 255;
      const i = (y * width + x) * 4;
      dst[i] = value;
      dst[i + 1] = value;
      dst[i + 2] = value;
      dst[i + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
}

/* ────────────────────────────── 与蒙版互转 ────────────────────────────── */

/** 选区 → 灰度蒙版画布（白显黑隐），可直接喂给 `maskFromGray` */
export function selectionToMaskGray(selection: Selection): HTMLCanvasElement {
  const { width, height } = selection;
  const sctx = selection.getContext('2d', { willReadFrequently: true });
  const { canvas, ctx } = createCanvas(width, height);
  if (!sctx) return canvas;
  const src = sctx.getImageData(0, 0, width, height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3];
    d[i] = alpha;
    d[i + 1] = alpha;
    d[i + 2] = alpha;
    d[i + 3] = 255;
  }
  ctx.putImageData(src, 0, 0);
  return canvas;
}

/** 在图层上擦除选区内的像素（`destination-out`） */
export function eraseSelectionFrom(source: HTMLCanvasElement, selection: Selection): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(selection, 0, 0);
  return canvas;
}
