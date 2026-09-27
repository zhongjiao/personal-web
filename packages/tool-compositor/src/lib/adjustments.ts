import type {
  CompAdjustmentKind,
  CompColorBalanceSettings,
  CompCurves,
  CompLevels
} from './comp-format';

/**
 * 调整图层（`.comp` v7+ 的 `adjustment` 记录）。
 *
 * 语义：没有像素，作用于**其下方已合成的内容**；可带不透明度、混合模式与蒙版
 * （蒙版覆盖整张画布，是局部调色的手段）。
 *
 * 只实现 `SUPPORTED_KINDS` 这 6 种 —— 官方文档给出了这几种的字段名。
 * 其余 6 种（曝光 / 渐变映射 / 颗粒 / 黑白 / 高斯模糊 / 动感模糊）文档明确说
 * 「去 App 里加一个、保存，再从 manifest 里抄结构」，本工具不猜字段名，
 * 读取时只给降级提示，避免在桌面版里静默变成空调整。
 *
 * 状态里始终保留 `levels` 与 `curves` 两个**恒等块**，与规格一致，往返时不需要特判。
 */

export const SUPPORTED_KINDS = [
  'Invert',
  'Hue/Saturation',
  'Levels',
  'Curves',
  'Color Balance',
  'Add Noise'
] as const;

export type AdjustmentKind = (typeof SUPPORTED_KINDS)[number];

/** 含未支持种类的标签表，用于读取时给用户报清楚是哪种 */
export const ADJUSTMENT_LABELS: Record<CompAdjustmentKind, string> = {
  Invert: '反相',
  'Hue/Saturation': '色相/饱和度',
  Levels: '色阶',
  Curves: '曲线',
  'Color Balance': '色彩平衡',
  'Add Noise': '添加杂色',
  Exposure: '曝光',
  'Gradient Map': '渐变映射',
  Grain: '颗粒',
  'Black & White': '黑白',
  'Gaussian Blur': '高斯模糊',
  'Motion Blur': '动感模糊'
};

const IDENTITY_RANGE = { black: 0, gamma: 1, white: 255, outputBlack: 0, outputWhite: 255 };

const identityLevels = (): CompLevels => ({
  channel: 'RGB',
  ranges: [0, 1, 2, 3].map(() => ({ ...IDENTITY_RANGE }))
});

const identityCurves = (): CompCurves => ({
  channel: 'RGB',
  channels: [0, 1, 2, 3].map(() => [
    { x: 0, y: 0 },
    { x: 255, y: 255 }
  ])
});

export const identityColorBalance = (): CompColorBalanceSettings => ({
  shadowCyanRed: 0,
  shadowMagentaGreen: 0,
  shadowYellowBlue: 0,
  midtoneCyanRed: 0,
  midtoneMagentaGreen: 0,
  midtoneYellowBlue: 0,
  highlightCyanRed: 0,
  highlightMagentaGreen: 0,
  highlightYellowBlue: 0,
  preserveLuminosity: true
});

export interface Adjustment {
  kind: AdjustmentKind;
  /* 色相/饱和度（同时作为其它种类的恒等值） */
  hue: number;
  saturation: number;
  lightness: number;
  colorize: boolean;
  /* 恒等块 */
  levels: CompLevels;
  curves: CompCurves;
  colorBalanceSettings: CompColorBalanceSettings;
  /* 添加杂色 */
  noiseAmount: number;
  noiseGaussian: boolean;
  noiseMonochromatic: boolean;
  noiseSeed: number;
}

export function createAdjustment(kind: AdjustmentKind): Adjustment {
  return {
    kind,
    hue: 0,
    saturation: 0,
    lightness: 0,
    colorize: false,
    levels: identityLevels(),
    curves: identityCurves(),
    colorBalanceSettings: identityColorBalance(),
    noiseAmount: 25,
    noiseGaussian: false,
    noiseMonochromatic: true,
    noiseSeed: 1
  };
}

/* ────────────────────────────── 算子 ────────────────────────────── */

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
  else if (max === gg) h = ((bb - rr) / d + 2) * 60;
  else h = ((rr - gg) / d + 4) * 60;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = ((((h % 360) + 360) % 360) / 360);
  return [
    hue2rgb(p, q, hn + 1 / 3) * 255,
    hue2rgb(p, q, hn) * 255,
    hue2rgb(p, q, hn - 1 / 3) * 255
  ];
}

function applyHueSaturation(image: ImageData, adj: Adjustment): void {
  const d = image.data;
  const hueShift = adj.hue;
  const satFactor = 1 + adj.saturation / 100;
  const lightOffset = adj.lightness / 100;
  const colorizeSat = adj.saturation / 100;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    let nh: number;
    let ns: number;
    if (adj.colorize) {
      nh = hueShift;
      ns = clamp01(colorizeSat);
    } else {
      nh = h + hueShift;
      ns = clamp01(s * satFactor);
    }
    const nl = clamp01(l + lightOffset);
    const [r, g, b] = hslToRgb(nh, ns, nl);
    d[i] = clamp255(r);
    d[i + 1] = clamp255(g);
    d[i + 2] = clamp255(b);
  }
}

interface RangeLike {
  black: number;
  gamma: number;
  white: number;
  outputBlack: number;
  outputWhite: number;
}

function buildLevelLut(range: RangeLike): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1e-6, range.white - range.black);
  const outSpan = range.outputWhite - range.outputBlack;
  const invGamma = 1 / Math.max(0.01, range.gamma);
  for (let i = 0; i < 256; i += 1) {
    const v = clamp01((i - range.black) / span);
    lut[i] = range.outputBlack + Math.pow(v, invGamma) * outSpan;
  }
  return lut;
}

/** 单调三次插值（Fritsch–Carlson），保证曲线不过冲 */
function buildCurveLut(points: { x: number; y: number }[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts.length < 2) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }

  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    delta.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  }

  const m: number[] = new Array<number>(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }

  let seg = 0;
  for (let x = 0; x < 256; x += 1) {
    while (seg < n - 2 && x > xs[seg + 1]) seg += 1;
    const h = xs[seg + 1] - xs[seg];
    if (h <= 0) {
      lut[x] = ys[seg];
      continue;
    }
    const t = (x - xs[seg]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    lut[x] =
      (2 * t3 - 3 * t2 + 1) * ys[seg] +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * ys[seg + 1] +
      (t3 - t2) * h * m[seg + 1];
  }
  return lut;
}

/** 曲线查表；曲线编辑器也用它绘制，保证所见即所得 */
export const curveLookup = buildCurveLut;

function applyLutChain(image: ImageData, master: Uint8ClampedArray, per: Uint8ClampedArray[]): void {
  const d = image.data;
  const [lr, lg, lb] = per;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = lb[lg[lr[master[d[i]]]]];
    d[i + 1] = lb[lg[lr[master[d[i + 1]]]]];
    d[i + 2] = lb[lg[lr[master[d[i + 2]]]]];
  }
}

function applyLevels(image: ImageData, levels: CompLevels): void {
  const ranges = levels.ranges;
  if (ranges.length < 4) return;
  applyLutChain(image, buildLevelLut(ranges[0]), [
    buildLevelLut(ranges[1]),
    buildLevelLut(ranges[2]),
    buildLevelLut(ranges[3])
  ]);
}

function applyCurves(image: ImageData, curves: CompCurves): void {
  const channels = curves.channels;
  if (channels.length < 4) return;
  applyLutChain(image, buildCurveLut(channels[0]), [
    buildCurveLut(channels[1]),
    buildCurveLut(channels[2]),
    buildCurveLut(channels[3])
  ]);
}

/** 按亮度把像素分到阴影 / 中间调 / 高光，三个区间权重和为 1 */
function toneWeights(l: number): [number, number, number] {
  const shadow = (1 - l) * (1 - l);
  const highlight = l * l;
  return [shadow, Math.max(0, 1 - shadow - highlight), highlight];
}

function applyColorBalance(image: ImageData, cb: CompColorBalanceSettings): void {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const [ws, wm, wh] = toneWeights(l);

    const dr =
      cb.shadowCyanRed * ws + cb.midtoneCyanRed * wm + cb.highlightCyanRed * wh;
    const dg =
      cb.shadowMagentaGreen * ws + cb.midtoneMagentaGreen * wm + cb.highlightMagentaGreen * wh;
    const db =
      cb.shadowYellowBlue * ws + cb.midtoneYellowBlue * wm + cb.highlightYellowBlue * wh;

    const nr = clamp255(r + dr);
    const ng = clamp255(g + dg);
    const nb = clamp255(b + db);

    if (cb.preserveLuminosity) {
      const before = 0.299 * r + 0.587 * g + 0.114 * b;
      const after = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      if (after > 0.001) {
        const k = before / after;
        d[i] = clamp255(nr * k);
        d[i + 1] = clamp255(ng * k);
        d[i + 2] = clamp255(nb * k);
        continue;
      }
    }
    d[i] = nr;
    d[i + 1] = ng;
    d[i + 2] = nb;
  }
}

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

function applyNoise(image: ImageData, adj: Adjustment): void {
  const d = image.data;
  const rnd = mulberry32(adj.noiseSeed);
  const amount = adj.noiseAmount;
  // 高斯分布用 Box–Muller；均匀分布直接用 [-1,1]
  const next = (): number => {
    if (!adj.noiseGaussian) return rnd() * 2 - 1;
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(-3, Math.min(3, g)) / 3;
  };

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (adj.noiseMonochromatic) {
      const n = next() * amount;
      d[i] = clamp255(d[i] + n);
      d[i + 1] = clamp255(d[i + 1] + n);
      d[i + 2] = clamp255(d[i + 2] + n);
    } else {
      d[i] = clamp255(d[i] + next() * amount);
      d[i + 1] = clamp255(d[i + 1] + next() * amount);
      d[i + 2] = clamp255(d[i + 2] + next() * amount);
    }
  }
}

/** 就地应用调整（只改 RGB，不动 alpha） */
export function applyAdjustment(image: ImageData, adj: Adjustment): void {
  switch (adj.kind) {
    case 'Invert': {
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }
      return;
    }
    case 'Hue/Saturation':
      applyHueSaturation(image, adj);
      return;
    case 'Levels':
      applyLevels(image, adj.levels);
      return;
    case 'Curves':
      applyCurves(image, adj.curves);
      return;
    case 'Color Balance':
      applyColorBalance(image, adj.colorBalanceSettings);
      return;
    case 'Add Noise':
      applyNoise(image, adj);
  }
}
