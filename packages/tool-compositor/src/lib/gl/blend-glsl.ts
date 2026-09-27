import { COMP_BLEND_MODES, type CompBlendMode } from '../comp-format';

/**
 * 24 种混合模式的 GLSL 实现。
 *
 * 与 CPU 路径（`blend.ts` 的 `blendInto`）是**同一套 W3C 合成规范**：
 * ```
 * αr = αs + αb·(1 − αs)
 * Cr = (1 − αs)·Cb + αs·[(1 − αb)·Cs + αb·B(Cb, Cs)]
 * ```
 * 两边逐项对应，所以可以用「同一份文档分别走 GPU 与 CPU 合成、再逐像素对拍」来验证 —— 见
 * `compositor.ts` 顶部注释。模式编号由 `COMP_BLEND_MODES` 生成，不手写常量，避免与 `.comp` 清单失联。
 */

/** 模式名 → 着色器里的整数编号 */
export const BLEND_MODE_INDEX: Record<CompBlendMode, number> = COMP_BLEND_MODES.reduce(
  (acc, mode, index) => {
    acc[mode] = index;
    return acc;
  },
  {} as Record<CompBlendMode, number>
);

/** 'Linear Dodge (Add)' → 'BLEND_LINEAR_DODGE__ADD_'（括号等非字母数字一律折成下划线） */
const macroOf = (mode: CompBlendMode) =>
  `BLEND_${mode.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

export const BLEND_DEFINES = COMP_BLEND_MODES.map(
  (mode) => `#define ${macroOf(mode)} ${BLEND_MODE_INDEX[mode]}`
).join('\n');

const NON_SEPARABLE: CompBlendMode[] = ['Hue', 'Saturation', 'Color', 'Luminosity'];
const NON_SEPARABLE_TEST = NON_SEPARABLE.map((mode) => `mode == ${macroOf(mode)}`).join(' || ');

/**
 * 分离式（逐通道）与四种非分离式混合函数，外加统一合成。可直接拼进片元着色器。
 * 颜色一律是**非预乘**的直通值，与 `getImageData` / `blendInto` 的口径一致。
 */
export const BLEND_GLSL = `
${BLEND_DEFINES}

/* ── 分离式：逐通道算子 ───────────────────────────────────────── */

float bColorBurn(float cb, float cs) {
  // 与 blend.ts 的 colorBurn 逐条对应：特判是 Cb==1 / Cs==0，不是 Cb==0 / Cs==1
  if (cb >= 1.0) return 1.0;
  if (cs <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - cb) / cs);
}

float bColorDodge(float cb, float cs) {
  if (cb <= 0.0) return 0.0;
  if (cs >= 1.0) return 1.0;
  return min(1.0, cb / (1.0 - cs));
}

float bVividLight(float cb, float cs) {
  return cs <= 0.5 ? bColorBurn(cb, 2.0 * cs) : bColorDodge(cb, 2.0 * cs - 1.0);
}

float bSoftLight(float cb, float cs) {
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cs <= 0.5
    ? cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
    : cb + (2.0 * cs - 1.0) * (d - cb);
}

float bHardLight(float cb, float cs) {
  return cs <= 0.5 ? 2.0 * cs * cb : 1.0 - 2.0 * (1.0 - cs) * (1.0 - cb);
}

float bLinearBurn(float cb, float cs) { return cb + cs - 1.0; }
float bLinearLight(float cb, float cs) { return cb + 2.0 * cs - 1.0; }
float bPinLight(float cb, float cs) {
  return cs <= 0.5 ? min(cb, 2.0 * cs) : max(cb, 2.0 * cs - 1.0);
}
float bHardMix(float cb, float cs) { return bVividLight(cb, cs) < 0.5 ? 0.0 : 1.0; }
float bDivide(float cb, float cs) { return cs <= 0.0 ? 1.0 : cb / cs; }

vec3 separableBlend(int mode, vec3 cb, vec3 cs) {
  if (mode == BLEND_DARKEN) return min(cb, cs);
  if (mode == BLEND_MULTIPLY) return cb * cs;
  if (mode == BLEND_COLOR_BURN) return vec3(bColorBurn(cb.r, cs.r), bColorBurn(cb.g, cs.g), bColorBurn(cb.b, cs.b));
  if (mode == BLEND_LINEAR_BURN) return vec3(bLinearBurn(cb.r, cs.r), bLinearBurn(cb.g, cs.g), bLinearBurn(cb.b, cs.b));
  if (mode == BLEND_LIGHTEN) return max(cb, cs);
  if (mode == BLEND_SCREEN) return cb + cs - cb * cs;
  if (mode == BLEND_COLOR_DODGE) return vec3(bColorDodge(cb.r, cs.r), bColorDodge(cb.g, cs.g), bColorDodge(cb.b, cs.b));
  if (mode == BLEND_LINEAR_DODGE__ADD_) return cb + cs;
  if (mode == BLEND_OVERLAY) return vec3(bHardLight(cs.r, cb.r), bHardLight(cs.g, cb.g), bHardLight(cs.b, cb.b));
  if (mode == BLEND_SOFT_LIGHT) return vec3(bSoftLight(cb.r, cs.r), bSoftLight(cb.g, cs.g), bSoftLight(cb.b, cs.b));
  if (mode == BLEND_HARD_LIGHT) return vec3(bHardLight(cb.r, cs.r), bHardLight(cb.g, cs.g), bHardLight(cb.b, cs.b));
  if (mode == BLEND_VIVID_LIGHT) return vec3(bVividLight(cb.r, cs.r), bVividLight(cb.g, cs.g), bVividLight(cb.b, cs.b));
  if (mode == BLEND_LINEAR_LIGHT) return vec3(bLinearLight(cb.r, cs.r), bLinearLight(cb.g, cs.g), bLinearLight(cb.b, cs.b));
  if (mode == BLEND_PIN_LIGHT) return vec3(bPinLight(cb.r, cs.r), bPinLight(cb.g, cs.g), bPinLight(cb.b, cs.b));
  if (mode == BLEND_HARD_MIX) return vec3(bHardMix(cb.r, cs.r), bHardMix(cb.g, cs.g), bHardMix(cb.b, cs.b));
  if (mode == BLEND_DIFFERENCE) return abs(cb - cs);
  if (mode == BLEND_EXCLUSION) return cb + cs - 2.0 * cb * cs;
  if (mode == BLEND_SUBTRACT) return cb - cs;
  if (mode == BLEND_DIVIDE) return vec3(bDivide(cb.r, cs.r), bDivide(cb.g, cs.g), bDivide(cb.b, cs.b));
  return cs;
}

/* ── 非分离式：色相 / 饱和度 / 颜色 / 明度 ─────────────────────── */

float lum(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + ((c - l) * l) / (l - n);
  if (x > 1.0) c = l + ((c - l) * (1.0 - l)) / (x - l);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

// W3C 的 SetSat 等价于「把通道线性重映射到 [0, s]」：最小通道 → 0，最大 → s，中间按比例。
// 规范里那套「排序后分派」，在这个等价形式下不需要，也不会有浮点比较的脆弱性。
vec3 setSat(vec3 c, float s) {
  float mn = min(min(c.r, c.g), c.b);
  float mx = max(max(c.r, c.g), c.b);
  if (mx - mn <= 0.0) return vec3(0.0);
  return ((c - mn) / (mx - mn)) * s;
}

vec3 nonSeparableBlend(int mode, vec3 cb, vec3 cs) {
  if (mode == BLEND_HUE) return setLum(setSat(cs, sat(cb)), lum(cb));
  if (mode == BLEND_SATURATION) return setLum(setSat(cb, sat(cs)), lum(cb));
  if (mode == BLEND_COLOR) return setLum(cs, lum(cb));
  return setLum(cb, lum(cs));
}

/* ── 统一合成 ─────────────────────────────────────────────────── */

vec4 w3cComposite(vec4 backdrop, vec4 source, float opacity, int mode) {
  float as = source.a * opacity;
  if (as <= 0.0) return backdrop;
  vec3 cs = source.rgb;
  vec3 cb = backdrop.rgb;
  float ab = backdrop.a;
  // 背景全透明时结果就是源色本身。不特判的话会用到背景里残留的 RGB，
  // 与 CPU 路径（blendInto 里的 ba === 0 分支）对不上。
  if (ab <= 0.0) return vec4(cs, as);

  vec3 b = (mode == BLEND_NORMAL)
    ? cs
    : ((${NON_SEPARABLE_TEST}) ? nonSeparableBlend(mode, cb, cs) : separableBlend(mode, cb, cs));

  vec3 cr = (1.0 - as) * cb + as * ((1.0 - ab) * cs + ab * b);
  return vec4(cr, as + ab * (1.0 - as));
}
`;
