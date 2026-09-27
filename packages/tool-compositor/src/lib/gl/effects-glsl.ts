/**
 * 图层效果的着色器。
 *
 * 顶点着色器是效果链专用的：所有 pass 的四边形与输入纹理都对齐**同一个文档矩形**，
 * 所以只需要输出一个归一化 UV（`vUV`），不必像合成器那样维护 uv/文档坐标两套插值。
 */
export const EFFECT_VERTEX_GLSL = `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec4 uTarget;
uniform float uNdcFlip;
out vec2 vUV;
void main() {
  vUV = aPos;
  vec2 doc = uRect.xy + aPos * uRect.zw;
  vec2 ndc = ((doc - uTarget.xy) / uTarget.zw) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, ndc.y * uNdcFlip, 0.0, 1.0);
}`;

/**
 * 取 alpha 转成灰度（模糊链的第一级：从精灵的 alpha 出发）。
 * 往后的每一级都只在灰度上做，用 `RESAMPLE_GRAY_GLSL`。
 */
export const RESAMPLE_ALPHA_GLSL = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSrc;
void main() {
  // 输出尺寸是输入的一半时，片元中心正好落在 4 个输入纹素的正中心，
  // 双线性一次取样就等于 2×2 盒式平均 —— 降采样不需要额外循环。
  float v = texture(uSrc, vUV).a;
  outColor = vec4(v, 0.0, 0.0, 1.0);
}`;

/** 灰度重采样：降采样时是 2×2 盒式平均，升采样时就是双线性放大 */
export const RESAMPLE_GRAY_GLSL = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSrc;
void main() {
  float v = texture(uSrc, vUV).r;
  outColor = vec4(v, 0.0, 0.0, 1.0);
}`;

/**
 * 分离式高斯模糊的一趟。
 *
 * `uSigma` 是**标准差**（与 CSS `blur(Npx)` 同口径），半径取 3σ。
 * 金字塔会把 σ 压到 2–4，所以这里的循环上限固定 16 就够，
 * 用常量上界 + 提前 `continue` 而不是动态循环，编译与执行都更稳。
 */
export const BLUR_GLSL = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  float r = ceil(uSigma * 3.0);
  float twoSigma2 = 2.0 * uSigma * uSigma;
  float sum = 0.0;
  float total = 0.0;
  for (int i = -16; i <= 16; i++) {
    float fi = float(i);
    if (abs(fi) > r) continue;
    float w = exp(-(fi * fi) / twoSigma2);
    sum += texture(uSrc, vUV + uDir * fi).r * w;
    total += w;
  }
  float v = total > 0.0 ? sum / total : texture(uSrc, vUV).r;
  outColor = vec4(v, 0.0, 0.0, 1.0);
}`;

/**
 * 把六个分量按 Canvas2D 那套顺序合成。
 *
 * 与 `effects.ts`（CPU 版）逐条对应 —— 这是「同一套配方、两条后端」的前提，
 * 也是可以对拍的基础。所有颜色都是**非预乘**直通值，与 `renderEffects` 内部一致。
 *
 * 关键化简：`blur(1 − A) = 1 − blur(A)`，所以内阴影 / 内发光不必再算一遍模糊场，
 * 每个 σ 只算一次 `blur(A)` 就够。
 */
export const EFFECT_COMPOSE_GLSL = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uSprite;
uniform sampler2D uShadow;
uniform sampler2D uGlow;
uniform sampler2D uInnerShadow;
uniform sampler2D uInnerGlow;
uniform sampler2D uStroke;

uniform vec4 uStep;              // (1/W, 1/H, 0, 0)
// 六个分量各自一个浮点开关。不用 int 位掩码是因为合成器的通用 uniform 设置器只认浮点，
// 而这里多传五个 float 比给设置器加一套类型派发要简单得多。
uniform float uHasShadow;
uniform float uHasGlow;
uniform float uHasOverlay;
uniform float uHasStroke;
uniform float uHasInnerShadow;
uniform float uHasInnerGlow;

uniform vec3 uShadowColor;
uniform float uShadowOpacity;
uniform vec2 uShadowOffset;      // 归一化偏移，已乘 uStep

uniform vec3 uGlowColor;
uniform float uGlowOpacity;

uniform vec3 uOverlayColor;
uniform float uOverlayOpacity;

uniform vec3 uInnerShadowColor;
uniform float uInnerShadowOpacity;
uniform vec2 uInnerShadowOffset;

uniform vec3 uInnerGlowColor;
uniform float uInnerGlowOpacity;

uniform vec3 uStrokeColor;
uniform float uStrokeOpacity;

vec4 over(vec4 top, vec4 bottom) {
  float ao = top.a + bottom.a * (1.0 - top.a);
  if (ao <= 0.0) return vec4(0.0);
  vec3 c = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / ao;
  return vec4(c, ao);
}

void main() {
  vec4 sprite = texture(uSprite, vUV);
  float A = sprite.a;
  vec4 acc = vec4(0.0);

  if (uHasShadow > 0.5) {
    float b = texture(uShadow, vUV - uShadowOffset).r;
    acc = over(vec4(uShadowColor, b * uShadowOpacity), acc);
  }
  if (uHasGlow > 0.5) {
    float b = texture(uGlow, vUV).r;
    acc = over(vec4(uGlowColor, b * uGlowOpacity), acc);
  }

  vec4 body = sprite;
  if (uHasOverlay > 0.5) {
    body = over(vec4(uOverlayColor, A * uOverlayOpacity), sprite);
  }
  acc = over(body, acc);

  if (uHasStroke > 0.5) {
    float ring = texture(uStroke, vUV).a;
    acc = over(vec4(uStrokeColor, ring * uStrokeOpacity), acc);
  }
  if (uHasInnerShadow > 0.5) {
    float b = 1.0 - texture(uInnerShadow, vUV - uInnerShadowOffset).r;
    acc = over(vec4(uInnerShadowColor, b * A * uInnerShadowOpacity), acc);
  }
  if (uHasInnerGlow > 0.5) {
    float b = 1.0 - texture(uInnerGlow, vUV).r;
    acc = over(vec4(uInnerGlowColor, b * A * uInnerGlowOpacity), acc);
  }

  outColor = acc;
}`;
