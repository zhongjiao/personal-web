import { createCanvas, type Rect } from '../document';
import { drawStroke, type LayerEffects, type StrokeEffect } from '../effects';
import type { GlDevice, GlProgramRef, GlTarget } from './device';
import {
  BLUR_GLSL,
  EFFECT_COMPOSE_GLSL,
  EFFECT_VERTEX_GLSL,
  RESAMPLE_ALPHA_GLSL,
  RESAMPLE_GRAY_GLSL
} from './effects-glsl';

/**
 * 图层效果的 GPU 版本。
 *
 * ## 搬的是哪几种
 *
 * 投影 / 外发光 / 内阴影 / 内发光都是「模糊一份 alpha 场 → 按固定色合成」，
 * 颜色叠加只是与精灵 alpha 做一次混合 —— 这五种整条链路都在 GPU 上。
 *
 * **描边例外**：它是形态学膨胀 / 腐蚀，GPU 上两条路都不理想 ——
 * 「模糊 + 阈值」近似时阈值对应 `Φ(−r/σ)`，8 位纹理下 r/σ 只能取到 ~2，
 * 于是 r 每翻一倍、边缘量化台阶也翻一倍（r=50 时约 1.8px 一档）；
 * 改用距离变换则要浮点渲染目标，多一层能力依赖。而现有 48 方向膨胀精度在 1px 内，
 * 所以描边仍由 Canvas2D 画好、把**环的 alpha 当第六张纹理喂进合成链**，
 * 效果顺序（本体 → 描边 → 内阴影 → 内发光）完全不变。
 *
 * ## 模糊金字塔
 *
 * σ 直接在全分辨率上卷是 O(σ)，σ=250 时不可行。这里把 alpha 逐级降采样到
 * σ/2^L ∈ [2, 4]，在该级做半径 3σ' ≤ 12 的分离卷积，再逐级升采样回来。
 * 降采样一级恰好是 2×2 盒式平均（片元中心落在 4 纹素正中，一次双线性就够），
 * 升采样就是双线性放大 —— 每级只有一次取样。
 *
 * ## 与 CPU 版的对应关系
 *
 * 合成分量逐条对应 `renderEffects`；并用上了 `blur(1 − A) = 1 − blur(A)`，
 * 所以内阴影 / 内发光不必再算一遍反向模糊场，每个 σ 只算一次。
 *
 * ## 一张纹理只能读或写其一
 *
 * 所有 pass 都不允许把输出目标同时当输入 —— 未启用的分量统一用**精灵纹理**占位，
 * 而不是输出目标（后者会形成读写同一张纹理的反馈回路）。
 */

const UNIT_SPRITE = 0;
const UNIT_SHADOW = 1;
const UNIT_GLOW = 2;
const UNIT_INNER_SHADOW = 3;
const UNIT_INNER_GLOW = 4;
const UNIT_STROKE = 5;

export interface GlEffectRequest {
  effects: LayerEffects;
  /** 图层本体（已应用蒙版）的纹理，覆盖 `rect` */
  sprite: WebGLTexture;
  /** 描边环纹理（同尺寸，alpha 即环覆盖率）；没开描边传 null */
  stroke: WebGLTexture | null;
  /** 上述纹理覆盖的文档矩形 */
  rect: Rect;
}

export interface GlEffectChain {
  /** 应用效果；返回的目标覆盖 `rect`，用完由调用方 `release`。返回 null 表示该层没有 GPU 效果 */
  render(request: GlEffectRequest): GlTarget | null;
}

const levelRect = (rect: Rect, level: number): Rect => ({
  x: rect.x,
  y: rect.y,
  w: Math.max(1, level === 0 ? rect.w : Math.round(rect.w / 2 ** level)),
  h: Math.max(1, level === 0 ? rect.h : Math.round(rect.h / 2 ** level))
});

/** 让高斯核半径不超过 ~12 的那一级 */
const pyramidLevel = (sigma: number): number =>
  sigma <= 4 ? 0 : Math.max(0, Math.ceil(Math.log2(sigma / 4)));

const radians = (deg: number) => (deg * Math.PI) / 180;

/** 单独渲染描边环（供 GPU 合成链在正确位置插入）；没开描边时返回 null */
export function renderStrokeRing(
  sprite: HTMLCanvasElement,
  effect: StrokeEffect | null
): HTMLCanvasElement | null {
  if (!effect?.enabled || effect.size <= 0) return null;
  const { canvas, ctx } = createCanvas(sprite.width, sprite.height);
  drawStroke(sprite, effect, ctx);
  return canvas;
}

export function createGlEffects(device: GlDevice): GlEffectChain {
  const programs: Record<string, GlProgramRef> = {
    alpha: device.link(EFFECT_VERTEX_GLSL, RESAMPLE_ALPHA_GLSL),
    gray: device.link(EFFECT_VERTEX_GLSL, RESAMPLE_GRAY_GLSL),
    blur: device.link(EFFECT_VERTEX_GLSL, BLUR_GLSL),
    compose: device.link(EFFECT_VERTEX_GLSL, EFFECT_COMPOSE_GLSL)
  };

  /**
   * 算 `blur(alpha, sigma)`，返回覆盖 `rect` 的灰度表面（值在 .r）；调用方负责 release。
   *
   * σ < 0.5 时不做卷积、只把 alpha 转成灰度 —— 那不是「没有效果」，
   * 而是「模糊半径为 0」，投影会退回成硬边剪影（CPU 版的 `blurPiece` 同理直接返回原图）。
   */
  function blurAlpha(source: WebGLTexture, rect: Rect, sigma: number): GlTarget | null {
    if (!Number.isFinite(sigma)) return null;
    const blurred = sigma >= 0.5;
    const level = blurred ? pyramidLevel(sigma) : 0;
    const reduced = blurred ? sigma / 2 ** level : 0;
    const owned: GlTarget[] = [];

    let current = source;
    if (level === 0) {
      // 全分辨率下先做一次 alpha → 灰度；降采样链的第一级已经兼任这件事
      const full = levelRect(rect, 0);
      // 金字塔每一级都要 LINEAR：升采样靠双线性，用 NEAREST 会退化成块状放大
      const gray = device.acquire(full.w, full.h, full.x, full.y, true);
      device.draw({
        program: programs.alpha,
        out: gray,
        rect: full,
        textures: [{ name: 'uSrc', texture: current, unit: UNIT_SPRITE }]
      });
      owned.push(gray);
      current = gray.texture;
    } else {
      for (let l = 1; l <= level; l += 1) {
        const target = levelRect(rect, l);
        const surface = device.acquire(target.w, target.h, target.x, target.y, true);
        device.draw({
          program: l === 1 ? programs.alpha : programs.gray,
          out: surface,
          rect: target,
          textures: [{ name: 'uSrc', texture: current, unit: UNIT_SPRITE }]
        });
        owned.push(surface);
        current = surface.texture;
      }
    }

    // 在金字塔该级上做分离式高斯：横向一趟、纵向一趟
    const blurRect = levelRect(rect, level);
    for (const axis of blurred ? [0, 1] : []) {
      const surface = device.acquire(blurRect.w, blurRect.h, blurRect.x, blurRect.y, true);
      device.draw({
        program: programs.blur,
        out: surface,
        rect: blurRect,
        textures: [{ name: 'uSrc', texture: current, unit: UNIT_SPRITE }],
        uniforms: {
          uDir: axis === 0 ? [1 / blurRect.w, 0] : [0, 1 / blurRect.h],
          uSigma: reduced
        }
      });
      owned.push(surface);
      current = surface.texture;
    }

    // 逐级升采样回全尺寸
    for (let l = level - 1; l >= 0; l -= 1) {
      const target = levelRect(rect, l);
      const surface = device.acquire(target.w, target.h, target.x, target.y, true);
      device.draw({
        program: programs.gray,
        out: surface,
        rect: target,
        textures: [{ name: 'uSrc', texture: current, unit: UNIT_SPRITE }]
      });
      owned.push(surface);
      current = surface.texture;
    }

    const result = owned[owned.length - 1];
    for (const surface of owned) {
      if (surface !== result) device.release(surface);
    }
    return result;
  }

  return {
    render({ effects: e, sprite, stroke, rect }: GlEffectRequest): GlTarget | null {
      const needShadow = !!e.shadow?.enabled;
      const needGlow = !!e.outerGlow?.enabled;
      const needInnerShadow = !!e.innerShadow?.enabled;
      const needInnerGlow = !!e.innerGlow?.enabled;
      const needOverlay = !!e.colorOverlay?.enabled;
      const needStroke = !!stroke && !!e.stroke?.enabled;

      if (
        !needShadow &&
        !needGlow &&
        !needInnerShadow &&
        !needInnerGlow &&
        !needOverlay &&
        !needStroke
      ) {
        return null;
      }

      const shadowField = needShadow ? blurAlpha(sprite, rect, e.shadow!.blur) : null;
      const glowField = needGlow ? blurAlpha(sprite, rect, e.outerGlow!.size) : null;
      const innerShadowField = needInnerShadow
        ? blurAlpha(sprite, rect, e.innerShadow!.blur)
        : null;
      const innerGlowField = needInnerGlow ? blurAlpha(sprite, rect, e.innerGlow!.size) : null;

      // 合成结果紧接着会被 1:1 合到图层目标上，NEAREST 才是逐位精确的
      const out = device.acquire(rect.w, rect.h, rect.x, rect.y);
      const on = (v: boolean) => (v ? 1 : 0);

      const rgb = (c: { red: number; green: number; blue: number }) => [c.red, c.green, c.blue];
      // 偏移按矩形归一化，着色器里直接用它去偏移 UV
      const offsetOf = (angle: number, distance: number): number[] => [
        (Math.cos(radians(angle)) * distance) / rect.w,
        (-Math.sin(radians(angle)) * distance) / rect.h
      ];

      device.draw({
        program: programs.compose,
        out,
        rect,
        textures: [
          { name: 'uSprite', texture: sprite, unit: UNIT_SPRITE },
          // 未启用的分量用精灵纹理占位：位掩码保证着色器不会取样，但绝不能填输出目标
          { name: 'uShadow', texture: (shadowField ?? null)?.texture ?? sprite, unit: UNIT_SHADOW },
          { name: 'uGlow', texture: (glowField ?? null)?.texture ?? sprite, unit: UNIT_GLOW },
          {
            name: 'uInnerShadow',
            texture: (innerShadowField ?? null)?.texture ?? sprite,
            unit: UNIT_INNER_SHADOW
          },
          {
            name: 'uInnerGlow',
            texture: (innerGlowField ?? null)?.texture ?? sprite,
            unit: UNIT_INNER_GLOW
          },
          { name: 'uStroke', texture: stroke ?? sprite, unit: UNIT_STROKE }
        ],
        uniforms: {
          uStep: [1 / rect.w, 1 / rect.h, 0, 0],
          uHasShadow: on(!!shadowField),
          uHasGlow: on(!!glowField),
          uHasOverlay: on(needOverlay),
          uHasStroke: on(needStroke),
          uHasInnerShadow: on(!!innerShadowField),
          uHasInnerGlow: on(!!innerGlowField),
          uShadowColor: e.shadow ? rgb(e.shadow.color) : [0, 0, 0],
          uShadowOpacity: e.shadow?.opacity ?? 0,
          uShadowOffset: e.shadow ? offsetOf(e.shadow.angle, e.shadow.distance) : [0, 0],
          uGlowColor: e.outerGlow ? rgb(e.outerGlow.color) : [0, 0, 0],
          uGlowOpacity: e.outerGlow?.opacity ?? 0,
          uOverlayColor: e.colorOverlay ? rgb(e.colorOverlay.color) : [0, 0, 0],
          uOverlayOpacity: e.colorOverlay?.opacity ?? 0,
          uInnerShadowColor: e.innerShadow ? rgb(e.innerShadow.color) : [0, 0, 0],
          uInnerShadowOpacity: e.innerShadow?.opacity ?? 0,
          uInnerShadowOffset: e.innerShadow
            ? offsetOf(e.innerShadow.angle, e.innerShadow.distance)
            : [0, 0],
          uInnerGlowColor: e.innerGlow ? rgb(e.innerGlow.color) : [0, 0, 0],
          uInnerGlowOpacity: e.innerGlow?.opacity ?? 0,
          uStrokeColor: e.stroke ? rgb(e.stroke.color) : [0, 0, 0],
          uStrokeOpacity: e.stroke?.opacity ?? 0
        }
      });

      if (shadowField) device.release(shadowField);
      if (glowField) device.release(glowField);
      if (innerShadowField) device.release(innerShadowField);
      if (innerGlowField) device.release(innerGlowField);

      return out;
    }
  };
}
