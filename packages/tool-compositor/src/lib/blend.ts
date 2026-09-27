import type { CompBlendMode } from './comp-format';

/**
 * 混合模式实现。
 *
 * `.comp` 定义 24 种，其中 16 种是 Canvas2D `globalCompositeOperation` 的原生取值，
 * 剩下 8 种（线性加深 / 线性减淡 / 亮光 / 线性光 / 点光 / 实色混合 / 减去 / 划分）
 * 浏览器没有对应取值，走 CPU 逐像素回退。
 *
 * **「线性减淡（添加）」不能映射到 `lighter`**：`lighter` 是「预乘相加、αr = αs + αb」，
 * 而 W3C（以及 WebGL2 着色器那一路）把它定义成一个**分离式混合函数** `B(cb, cs) = cb + cs`，
 * 再套通用合成式。两者在不透明图层上恰好重合，一旦源或背景有半透明就会分道扬镳 ——
 * 那会让 GPU 与 CPU 两条路径给出不同像素。因此这里刻意把它留在 CPU/W3C 一侧。
 *
 * CPU 路径每层要 `getImageData` + `putImageData` 一次，是 Canvas2D 合成器的性能瓶颈；
 * 走 WebGL2 时这 8 种与其余 16 种一并在着色器里算，这条分支完全不经过。
 */

/** 与 Canvas2D 原生混合模式的对应关系 */
export const NATIVE_BLEND: Partial<Record<CompBlendMode, GlobalCompositeOperation>> = {
  Normal: 'source-over',
  Darken: 'darken',
  Multiply: 'multiply',
  'Color Burn': 'color-burn',
  Lighten: 'lighten',
  Screen: 'screen',
  'Color Dodge': 'color-dodge',
  Overlay: 'overlay',
  'Soft Light': 'soft-light',
  'Hard Light': 'hard-light',
  Difference: 'difference',
  Exclusion: 'exclusion',
  Hue: 'hue',
  Saturation: 'saturation',
  Color: 'color',
  Luminosity: 'luminosity'
};

/** 需要 CPU 回退（或由 GLSL 统一实现）的 W3C 分离式模式 */
export const CPU_BLEND_MODES = [
  'Linear Burn',
  'Linear Dodge (Add)',
  'Vivid Light',
  'Linear Light',
  'Pin Light',
  'Hard Mix',
  'Subtract',
  'Divide'
] as const;

export type CpuBlendMode = (typeof CPU_BLEND_MODES)[number];

export const isNativeBlend = (mode: CompBlendMode): boolean => mode in NATIVE_BLEND;

/** 中文标签，用于混合模式下拉框 */
export const BLEND_MODE_LABELS: Record<CompBlendMode, string> = {
  Normal: '正常',
  Darken: '变暗',
  Multiply: '正片叠底',
  'Color Burn': '颜色加深',
  'Linear Burn': '线性加深',
  Lighten: '变亮',
  Screen: '滤色',
  'Color Dodge': '颜色减淡',
  'Linear Dodge (Add)': '线性减淡（添加）',
  Overlay: '叠加',
  'Soft Light': '柔光',
  'Hard Light': '强光',
  'Vivid Light': '亮光',
  'Linear Light': '线性光',
  'Pin Light': '点光',
  'Hard Mix': '实色混合',
  Difference: '差值',
  Exclusion: '排除',
  Subtract: '减去',
  Divide: '划分',
  Hue: '色相',
  Saturation: '饱和度',
  Color: '颜色',
  Luminosity: '明度'
};

/* W3C 合成规范里的两个基础算子（cb / cs 均为 0–1） */
const colorBurn = (cb: number, cs: number): number => {
  // 两个特判不能写反：规范是「背景已全亮(1) → 1」与「源全暗(0) → 0」。
  // 写成 Cb==0/Cs==1 时，源为纯白（cs=1）会错给 1，而正确结果是 cb —— 差可达整条通道。
  if (cb >= 1) return 1;
  if (cs <= 0) return 0;
  return 1 - Math.min(1, (1 - cb) / cs);
};

const colorDodge = (cb: number, cs: number): number => {
  if (cb === 0) return 0;
  if (cs === 1) return 1;
  return Math.min(1, cb / (1 - cs));
};

const vividLight = (cb: number, cs: number): number =>
  cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * cs - 1);

/** 分离式混合函数：给定背景通道值 cb 与源通道值 cs，返回混合结果 */
export type SeparableBlend = (cb: number, cs: number) => number;

export const SEPARABLE_BLEND: Record<CpuBlendMode, SeparableBlend> = {
  'Linear Burn': (cb, cs) => cb + cs - 1,
  'Linear Dodge (Add)': (cb, cs) => cb + cs,
  'Vivid Light': vividLight,
  'Linear Light': (cb, cs) => cb + 2 * cs - 1,
  'Pin Light': (cb, cs) => (cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1)),
  'Hard Mix': (cb, cs) => (vividLight(cb, cs) < 0.5 ? 0 : 1),
  Subtract: (cb, cs) => cb - cs,
  Divide: (cb, cs) => (cs === 0 ? 1 : cb / cs)
};

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * 把 `source` 按 `blend` 混合进 `target`（两者尺寸必须一致，就地修改 target）。
 *
 * 用 W3C 合成规范的通用形式，覆盖带 alpha 的情形：
 * ```
 * αr = αs + αb·(1 − αs)
 * Cr = (1 − αs)·Cb + αs·[(1 − αb)·Cs + αb·B(Cb, Cs)]
 * ```
 * 颜色均为**非预乘**的直通值（`getImageData` 拿到的就是这种）。
 */
export function blendInto(
  target: ImageData,
  source: ImageData,
  blend: SeparableBlend,
  opacity: number
): void {
  const td = target.data;
  const sd = source.data;
  for (let i = 0; i < td.length; i += 4) {
    const sa = (sd[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    const ba = td[i + 3] / 255;

    // 背景全透明时，结果就是源色本身（避免用到画布里的残留 RGB）
    if (ba === 0) {
      td[i] = sd[i];
      td[i + 1] = sd[i + 1];
      td[i + 2] = sd[i + 2];
      td[i + 3] = clamp255(sa * 255);
      continue;
    }

    for (let c = 0; c < 3; c += 1) {
      const cs = sd[i + c] / 255;
      const cb = td[i + c] / 255;
      const cr = (1 - sa) * cb + sa * ((1 - ba) * cs + ba * blend(cb, cs));
      td[i + c] = clamp255(cr * 255);
    }
    td[i + 3] = clamp255((sa + ba * (1 - sa)) * 255);
  }
}
