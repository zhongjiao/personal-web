import { createCanvas } from './document';
import { emptySelection, type Selection } from './selection';

/**
 * 对象选择：**边缘感知的连通区域生长**。
 *
 * 与魔棒的本质区别：魔棒比的是「和种子点的颜色差」，对象一旦有内部花纹就会断成碎片；
 * 这里比的是「像素之间的梯度」—— 只要对象内部没有比轮廓更强的边缘，就能整块长出来。
 * 因此条纹、渐变、多色对象都能被完整选中，而纯净背景里的孤立形状会和背景分开。
 *
 * 做法三步：
 * 1. 建**屏障图**：每个像素取它到 1–2 像素邻域内所有邻点的最大通道差（含 alpha）。
 *    用一个小窗口而不是紧邻，是因为抗锯齿与投影这类「软边」在紧邻上只有很小的差，
 *    放到 2 像素半径才足够显眼。亮度按 alpha **预乘** —— 全透明区域的 RGB 是垃圾值，
 *    不预乘会在那里造出假边缘。
 * 2. 从种子点四连通生长，只穿过屏障 ≤ 阈值的像素。alpha 的跳变天然是一条屏障，
 *    所以「纯色形状画在透明底上」会被停在轮廓上，字母 O 的中间空腔也不会被吃进去。
 * 3. 写进文档尺寸的选区画布（只填 alpha）。
 *
 * 这是启发式，不是机器学习：当对象与背景之间**不存在可见边缘**时它会漏出去。
 * 项目里另有 `servers/cutout-api`（ONNX）负责真正的「选择主体」，两者是不同层次的东西。
 */

/** 屏障采样偏移：四方向各取 1、2 两档 */
const OFFSETS: readonly (readonly [number, number])[] = [
  [-2, 0],
  [-1, 0],
  [1, 0],
  [2, 0],
  [0, -2],
  [0, -1],
  [0, 1],
  [0, 2]
];

export interface ObjectSelectionOptions {
  /** 1–100：越大越容易跨过边缘，选区越大 */
  threshold: number;
}

export interface ObjectSelectionResult {
  selection: Selection;
  /** 被选中的像素数与占比，用于给用户反馈「到底选到了多少」 */
  pixels: number;
  ratio: number;
  /** 生长是否触到了画布边界 —— 通常意味着阈值过高、漏到背景里去了 */
  touchedBorder: boolean;
}

/**
 * 从 `(x, y)` 出发在 `source` 上生长出对象选区。
 *
 * `source` 必须是**文档尺寸**的画布（调用方负责把图层像素或合成结果铺到文档空间），
 * 这样返回的选区可以直接与其它选区工具混用。
 */
export function objectSelection(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  options: ObjectSelectionOptions
): ObjectSelectionResult {
  const width = source.width;
  const height = source.height;
  const empty: ObjectSelectionResult = {
    selection: emptySelection(width, height),
    pixels: 0,
    ratio: 0,
    touchedBorder: false
  };

  if (x < 0 || y < 0 || x >= width || y >= height) return empty;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  const { canvas: selection, ctx: octx } = createCanvas(width, height);
  if (!sctx) return empty;

  const src = sctx.getImageData(0, 0, width, height).data;
  const total = width * height;
  const limit = objectThresholdToBarrier(options.threshold);

  // 预乘亮度
  const luma = new Uint8Array(total);
  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const a = src[i + 3];
    luma[p] = a === 0 ? 0 : ((src[i] * 77 + src[i + 1] * 150 + src[i + 2] * 29) >> 8) * (a / 255);
  }

  const barrier = new Uint8Array(total);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const p = py * width + px;
      const i = p * 4;
      const la = luma[p];
      const aa = src[i + 3];
      let worst = 0;
      for (const [dx, dy] of OFFSETS) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        const j = q * 4;
        const da = Math.abs(aa - src[j + 3]);
        const dl = Math.abs(la - luma[q]);
        const d = da > dl ? da : dl;
        if (d > worst) worst = d;
      }
      barrier[p] = worst;
    }
  }

  const visited = new Uint8Array(total);
  const stack: number[] = [y * width + x];
  const out = octx.createImageData(width, height);
  const dst = out.data;
  let pixels = 0;
  let touchedBorder = false;

  // 种子本身总是允许（允许「选背景」这种用法），只有它的邻点需要过屏障
  while (stack.length) {
    const p = stack.pop() as number;
    if (visited[p]) continue;
    visited[p] = 1;
    if (barrier[p] > limit) continue;

    dst[p * 4] = 255;
    dst[p * 4 + 1] = 255;
    dst[p * 4 + 2] = 255;
    dst[p * 4 + 3] = 255;
    pixels += 1;

    const px = p % width;
    const py = (p - px) / width;
    if (px === 0 || py === 0 || px === width - 1 || py === height - 1) touchedBorder = true;
    if (px > 0) stack.push(p - 1);
    if (px < width - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - width);
    if (py < height - 1) stack.push(p + width);
  }

  octx.putImageData(out, 0, 0);
  return { selection, pixels, ratio: pixels / total, touchedBorder };
}

/** 屏障图的阈值换算，单独导出便于界面文案与测试对齐 */
export const objectThresholdToBarrier = (threshold: number): number =>
  Math.max(1, Math.min(255, Math.round(threshold * 2.55)));
