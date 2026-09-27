import {
  createCanvas,
  docToImageTransform,
  type RasterLayer
} from './document';

/**
 * 内容识别填充。
 *
 * 三步走，每一步都解决一个明确的问题：
 *
 * 1. **洋葱剥皮排序** —— 多源 BFS 算出每个洞内像素到已知区域的层数，
 *    后续一律按这个顺序处理，保证总是「从边界往里长」，而不是留下孤岛。
 * 2. **扩散初始化** —— 先用边界已知像素的均值铺底，再做若干轮 Gauss-Seidel 平均。
 *    它给出一个连续、无洞的底子，让第 3 步的块匹配有东西可比。
 *    单看这一步就是「涂抹式修复」：平滑区域效果很好，但会糊掉纹理与硬边。
 * 3. **块匹配精修** —— PatchMatch：每轮对每个洞内像素做「传播（借邻居已找到的偏移）+ 随机搜索」，
 *    用 SSD 挑最像的一块，把中心像素抄过来。**SSD 只统计非洞像素** —— 洞内像素在迭代中
 *    并不可信，把它们算进去会把误差带偏，这是这套算法能收敛的关键。
 *
 * 于是硬边与纹理由第 3 步找回，平滑过渡由第 2 步兜底。
 *
 * 复杂度：像素数 × 迭代轮数 × 候选数 × 补丁面积，带提前退出。因此对洞的像素数设了上限，
 * 并在过程中让出主线程，避免卡死界面。
 */

const MAX_HOLE_PIXELS = 160_000;
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];

/** 确定性 PRNG：同样的输入必须给同样的结果，否则「撤销后重做」会变样 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface InpaintOptions {
  /** 补丁半径：2 → 5×5，3 → 7×7 */
  patchRadius?: number;
  /** 块匹配轮数 */
  iterations?: number;
  seed?: number;
  onProgress?: (ratio: number, stage: 'diffuse' | 'patch') => void;
}

export interface InpaintResult {
  /** 被填充的像素数 */
  filled: number;
  /** 是否真的跑到了块匹配阶段（洞太大或已知区域不足时会退化成纯扩散） */
  patchMatched: boolean;
}

/** 就地填充 `image` 中 `hole` 标记的区域；`hole[p] > 127` 视为待填充 */
export async function contentAwareFill(
  image: ImageData,
  hole: Uint8Array,
  options: InpaintOptions = {}
): Promise<InpaintResult> {
  const w = image.width;
  const h = image.height;
  const data = image.data;
  const isHole = (p: number) => hole[p] > 127;

  /* ── 1. 洋葱剥皮顺序 ───────────────────────────────────────────── */

  const layerOf = new Int32Array(w * h).fill(-1);
  const order: number[] = [];
  const indexOf = new Int32Array(w * h).fill(-1);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!isHole(p)) {
        layerOf[p] = 0;
        continue;
      }
      const touchesKnown =
        (x > 0 && !isHole(p - 1)) ||
        (x < w - 1 && !isHole(p + 1)) ||
        (y > 0 && !isHole(p - w)) ||
        (y < h - 1 && !isHole(p + w));
      if (touchesKnown) {
        layerOf[p] = 1;
        indexOf[p] = order.length;
        order.push(p);
      }
    }
  }

  // BFS 扩展：order 天然按层数升序
  let head = 0;
  while (head < order.length) {
    const p = order[head];
    head += 1;
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!isHole(q) || layerOf[q] !== -1) continue;
      layerOf[q] = layerOf[p] + 1;
      indexOf[q] = order.length;
      order.push(q);
    }
  }

  if (order.length === 0) return { filled: 0, patchMatched: false };
  if (order.length > MAX_HOLE_PIXELS) {
    throw new Error(
      `选区覆盖 ${order.length.toLocaleString()} 个像素，超过内容识别填充上限 ${MAX_HOLE_PIXELS.toLocaleString()}，请缩小选区`
    );
  }

  /* ── 2. 扩散初始化 ─────────────────────────────────────────────── */

  let seedR = 0;
  let seedG = 0;
  let seedB = 0;
  let seedA = 0;
  let seedCount = 0;
  for (const p of order) {
    if (layerOf[p] !== 1) continue;
    const i = p * 4;
    seedR += data[i];
    seedG += data[i + 1];
    seedB += data[i + 2];
    seedA += data[i + 3];
    seedCount += 1;
  }
  if (seedCount === 0) return { filled: 0, patchMatched: false };

  const baseR = seedR / seedCount;
  const baseG = seedG / seedCount;
  const baseB = seedB / seedCount;
  const baseA = seedA / seedCount;
  for (const p of order) {
    const i = p * 4;
    data[i] = baseR;
    data[i + 1] = baseG;
    data[i + 2] = baseB;
    data[i + 3] = baseA;
  }

  const maxLayer = layerOf[order[order.length - 1]];
  const diffusePasses = Math.min(48, Math.max(6, maxLayer));
  for (let pass = 0; pass < diffusePasses; pass += 1) {
    const forward = pass % 2 === 0;
    for (let k = 0; k < order.length; k += 1) {
      const p = order[forward ? k : order.length - 1 - k];
      const x = p % w;
      const y = (p - x) / w;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      if (x > 0) {
        const q = (p - 1) * 4;
        r += data[q];
        g += data[q + 1];
        b += data[q + 2];
        a += data[q + 3];
        n += 1;
      }
      if (x < w - 1) {
        const q = (p + 1) * 4;
        r += data[q];
        g += data[q + 1];
        b += data[q + 2];
        a += data[q + 3];
        n += 1;
      }
      if (y > 0) {
        const q = (p - w) * 4;
        r += data[q];
        g += data[q + 1];
        b += data[q + 2];
        a += data[q + 3];
        n += 1;
      }
      if (y < h - 1) {
        const q = (p + w) * 4;
        r += data[q];
        g += data[q + 1];
        b += data[q + 2];
        a += data[q + 3];
        n += 1;
      }
      if (n === 0) continue;
      const i = p * 4;
      data[i] = r / n;
      data[i + 1] = g / n;
      data[i + 2] = b / n;
      data[i + 3] = a / n;
    }
    if (pass % 6 === 5 || pass === diffusePasses - 1) {
      options.onProgress?.((0.3 * (pass + 1)) / diffusePasses, 'diffuse');
      await yieldToUi();
    }
  }

  /* ── 3. 块匹配精修 ─────────────────────────────────────────────── */

  const radius = Math.max(1, Math.min(6, Math.round(options.patchRadius ?? 3)));
  const iterations = Math.max(0, Math.min(6, Math.round(options.iterations ?? 3)));
  const rng = mulberry32(options.seed ?? 0x9e3779b9);

  let bx0 = w;
  let bx1 = -1;
  let by0 = h;
  let by1 = -1;
  for (const p of order) {
    const x = p % w;
    const y = (p - x) / w;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }

  // 候选源：洞包围盒外扩一圈后、落在已知像素上的网格采样。
  // 用采样而不是全量，是为了把候选数压在几千这个量级。
  const pad = Math.max(24, Math.round(Math.max(bx1 - bx0 + 1, by1 - by0 + 1) * 0.75));
  const cx0 = Math.max(0, bx0 - pad);
  const cx1 = Math.min(w - 1, bx1 + pad);
  const cy0 = Math.max(0, by0 - pad);
  const cy1 = Math.min(h - 1, by1 + pad);
  const step = Math.max(1, Math.round(Math.sqrt(((cx1 - cx0 + 1) * (cy1 - cy0 + 1)) / 3000)));
  const candidates: number[] = [];
  for (let y = cy0; y <= cy1; y += step) {
    for (let x = cx0; x <= cx1; x += step) {
      const q = y * w + x;
      if (!isHole(q)) candidates.push(q);
    }
  }

  if (iterations === 0 || candidates.length < 4) {
    options.onProgress?.(1, 'patch');
    return { filled: order.length, patchMatched: false };
  }

  const count = order.length;
  const offX = new Int32Array(count);
  const offY = new Int32Array(count);
  for (let k = 0; k < count; k += 1) {
    const p = order[k];
    const px = p % w;
    const py = (p - px) / w;
    const q = candidates[Math.min(candidates.length - 1, (rng() * candidates.length) | 0)];
    const qx = q % w;
    const qy = (q - qx) / w;
    offX[k] = qx - px;
    offY[k] = qy - py;
  }

  /** 补丁 SSD；只统计非洞的目标像素，超过 `limit` 立刻返回 */
  const score = (px: number, py: number, dx: number, dy: number, limit: number): number => {
    let sum = 0;
    for (let oy = -radius; oy <= radius; oy += 1) {
      const ty = py + oy;
      if (ty < 0 || ty >= h) continue;
      const sy = ty + dy;
      if (sy < 0 || sy >= h) return Infinity;
      for (let ox = -radius; ox <= radius; ox += 1) {
        const tx = px + ox;
        if (tx < 0 || tx >= w) continue;
        const tp = ty * w + tx;
        if (isHole(tp)) continue;
        const sx = tx + dx;
        if (sx < 0 || sx >= w) return Infinity;
        const a = tp * 4;
        const b = (sy * w + sx) * 4;
        const dr = data[a] - data[b];
        const dg = data[a + 1] - data[b + 1];
        const db = data[a + 2] - data[b + 2];
        const da = data[a + 3] - data[b + 3];
        sum += dr * dr + dg * dg + db * db + da * da;
        if (sum >= limit) return sum;
      }
    }
    return sum;
  };

  const searchStart = Math.max(4, cx1 - cx0, cy1 - cy0);
  const CHUNK = 6000;

  for (let it = 0; it < iterations; it += 1) {
    const forward = it % 2 === 0;
    let processed = 0;

    for (let k = 0; k < count; k += 1) {
      const idx = forward ? k : count - 1 - k;
      const p = order[idx];
      const px = p % w;
      const py = (p - px) / w;

      let bestX = offX[idx];
      let bestY = offY[idx];
      let best = score(px, py, bestX, bestY, Infinity);

      // 传播：借用空间邻居已经找到的偏移
      for (const [nx, ny] of NEIGHBORS) {
        const jx = px + nx;
        const jy = py + ny;
        if (jx < 0 || jy < 0 || jx >= w || jy >= h) continue;
        const j = indexOf[jy * w + jx];
        if (j < 0) continue;
        const dx = offX[j];
        const dy = offY[j];
        // 抄回来的中心必须是真实像素，不能是另一个待填像素
        if (isHole((py + dy) * w + (px + dx))) continue;
        const s = score(px, py, dx, dy, best);
        if (s < best) {
          best = s;
          bestX = dx;
          bestY = dy;
        }
      }

      // 随机搜索：半径指数递减，从大范围找结构、小范围对齐纹理
      for (let r = searchStart; r >= 1; r = Math.floor(r / 2)) {
        for (let c = 0; c < 2; c += 1) {
          const dx = bestX + Math.round((rng() * 2 - 1) * r);
          const dy = bestY + Math.round((rng() * 2 - 1) * r);
          const sx = px + dx;
          const sy = py + dy;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          if (isHole(sy * w + sx)) continue;
          const s = score(px, py, dx, dy, best);
          if (s < best) {
            best = s;
            bestX = dx;
            bestY = dy;
          }
        }
      }

      offX[idx] = bestX;
      offY[idx] = bestY;

      const src = ((py + bestY) * w + (px + bestX)) * 4;
      const dst = p * 4;
      data[dst] = data[src];
      data[dst + 1] = data[src + 1];
      data[dst + 2] = data[src + 2];
      data[dst + 3] = data[src + 3];

      processed += 1;
      if (processed % CHUNK === 0) {
        options.onProgress?.(0.3 + 0.7 * ((it + processed / count) / iterations), 'patch');
        await yieldToUi();
      }
    }
  }

  options.onProgress?.(1, 'patch');
  return { filled: count, patchMatched: true };
}

/**
 * 按**文档空间**的选区对图层做内容识别填充。
 *
 * 选区是文档尺寸、图层像素是图像尺寸，这里用 `docToImageTransform` 把选区映射进图像空间 ——
 * 与「选区 → 蒙版」走的是同一套映射，避免两处各写一套坐标换算。
 *
 * 只返回新画布，不改动图层：调用方负责在 mutate 里赋值（这样才进得了撤销栈）。
 */
export async function contentAwareFillLayer(
  layer: RasterLayer,
  selection: HTMLCanvasElement,
  options: InpaintOptions = {}
): Promise<{ canvas: HTMLCanvasElement; result: InpaintResult } | null> {
  const image = layer.image;
  if (!image) return null;
  const w = image.width;
  const h = image.height;
  if (w < 1 || h < 1) return null;

  const srcCtx = image.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return null;

  // 选区 → 图像空间的 alpha 图，再阈值成洞标记
  const { ctx: holeCtx } = createCanvas(w, h);
  if (!holeCtx) return null;
  docToImageTransform(holeCtx, layer, w, h);
  holeCtx.drawImage(selection, 0, 0);
  const holeData = holeCtx.getImageData(0, 0, w, h).data;
  const hole = new Uint8Array(w * h);
  let holes = 0;
  for (let p = 0; p < hole.length; p += 1) {
    if (holeData[p * 4 + 3] > 127) {
      hole[p] = 255;
      holes += 1;
    }
  }
  if (holes === 0) return null;

  const pixels = srcCtx.getImageData(0, 0, w, h);
  const result = await contentAwareFill(pixels, hole, options);

  const { canvas, ctx } = createCanvas(w, h);
  if (!ctx) return null;
  ctx.putImageData(pixels, 0, 0);
  return { canvas, result };
}
