import type { CompRgb } from './comp-format';
import { createCanvas } from './document';

/**
 * 图层效果（`.comp` v4+ 的 `effects` 记录）。
 *
 * 6 种彼此独立、各自可选，`enabled` 为 false 时参数保留但不参与合成。
 * 渲染全部基于 Canvas2D：模糊用 `ctx.filter = 'blur()'`，
 * 剪影上色用 `source-in`，内阴影/内发光用「反向剪影 → 模糊 → 裁回形内」。
 */

export interface StrokeEffect {
  enabled: boolean;
  /** 0–500 图层像素 */
  size: number;
  color: CompRgb;
  opacity: number;
  inside: boolean;
}

export interface DropShadowEffect {
  enabled: boolean;
  /** 投射方向，度；0 = 向右，逆时针为正 */
  angle: number;
  distance: number;
  blur: number;
  color: CompRgb;
  opacity: number;
}

export interface ColorOverlayEffect {
  enabled: boolean;
  color: CompRgb;
  opacity: number;
}

export type InnerShadowEffect = DropShadowEffect;

export interface GlowEffect {
  enabled: boolean;
  /** 0–500，作为模糊半径使用 */
  size: number;
  color: CompRgb;
  opacity: number;
}

export interface LayerEffects {
  stroke: StrokeEffect | null;
  shadow: DropShadowEffect | null;
  colorOverlay: ColorOverlayEffect | null;
  innerShadow: InnerShadowEffect | null;
  outerGlow: GlowEffect | null;
  innerGlow: GlowEffect | null;
}

export type EffectId = keyof LayerEffects;

/** 渲染顺序：后层 → 本体 → 前层 */
export const EFFECT_ORDER: EffectId[] = [
  'shadow',
  'outerGlow',
  'colorOverlay',
  'stroke',
  'innerShadow',
  'innerGlow'
];

export const EFFECT_LABELS: Record<EffectId, string> = {
  stroke: '描边',
  shadow: '投影',
  colorOverlay: '颜色叠加',
  innerShadow: '内阴影',
  outerGlow: '外发光',
  innerGlow: '内发光'
};

const EFFECT_DEFAULTS: { [K in EffectId]: () => NonNullable<LayerEffects[K]> } = {
  stroke: () => ({ enabled: true, size: 8, color: { red: 0, green: 0, blue: 0 }, opacity: 1, inside: false }),
  shadow: () => ({
    enabled: true,
    angle: 315,
    distance: 12,
    blur: 16,
    color: { red: 0, green: 0, blue: 0 },
    opacity: 0.6
  }),
  colorOverlay: () => ({ enabled: true, color: { red: 0.31, green: 0.43, blue: 0.96 }, opacity: 1 }),
  innerShadow: () => ({
    enabled: true,
    angle: 315,
    distance: 8,
    blur: 12,
    color: { red: 0, green: 0, blue: 0 },
    opacity: 0.6
  }),
  outerGlow: () => ({ enabled: true, size: 18, color: { red: 1, green: 0.85, blue: 0.3 }, opacity: 0.9 }),
  innerGlow: () => ({ enabled: true, size: 14, color: { red: 1, green: 1, blue: 1 }, opacity: 0.8 })
};

export function createEffect<K extends EffectId>(id: K): NonNullable<LayerEffects[K]> {
  return EFFECT_DEFAULTS[id]();
}

export const emptyEffects = (): LayerEffects => ({
  stroke: null,
  shadow: null,
  colorOverlay: null,
  innerShadow: null,
  outerGlow: null,
  innerGlow: null
});

export const hasVisibleEffect = (effects: LayerEffects | null): boolean =>
  !!effects && EFFECT_ORDER.some((id) => effects[id]?.enabled);

/** 挂上 / 摘掉某个效果；挂上时保留已有参数 */
export function setEffectPresence(effects: LayerEffects, id: EffectId, present: boolean): void {
  switch (id) {
    case 'stroke':
      effects.stroke = present ? effects.stroke ?? createEffect('stroke') : null;
      break;
    case 'shadow':
      effects.shadow = present ? effects.shadow ?? createEffect('shadow') : null;
      break;
    case 'colorOverlay':
      effects.colorOverlay = present ? effects.colorOverlay ?? createEffect('colorOverlay') : null;
      break;
    case 'innerShadow':
      effects.innerShadow = present ? effects.innerShadow ?? createEffect('innerShadow') : null;
      break;
    case 'outerGlow':
      effects.outerGlow = present ? effects.outerGlow ?? createEffect('outerGlow') : null;
      break;
    case 'innerGlow':
      effects.innerGlow = present ? effects.innerGlow ?? createEffect('innerGlow') : null;
      break;
  }
}

/** 暂时停用某效果但保留参数 */
export function setEffectEnabled(effects: LayerEffects, id: EffectId, enabled: boolean): void {
  const target = effects[id];
  if (target) target.enabled = enabled;
}

/** 效果可能向外扩散的最大像素距离；用于确定合成时需要额外留出的边距 */
const MAX_MARGIN = 400;

export function effectMargin(effects: LayerEffects | null): number {
  if (!effects) return 0;
  let margin = 0;
  if (effects.stroke?.enabled) margin = Math.max(margin, effects.stroke.size);
  if (effects.shadow?.enabled) {
    margin = Math.max(margin, effects.shadow.distance + effects.shadow.blur * 2);
  }
  if (effects.outerGlow?.enabled) margin = Math.max(margin, effects.outerGlow.size * 2);
  return Math.min(MAX_MARGIN, Math.ceil(margin));
}

/* ────────────────────────────── 渲染 ────────────────────────────── */

/**
 * 一块「带位置」的位图：canvas 的 (0,0) 对应文档坐标 (ox, oy)。
 * 模糊 / 外扩会产生留白，位置信息让调用方不必自己算偏移。
 */
interface Piece {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
}

export const rgbToCss = (color: CompRgb, alpha = 1): string =>
  `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(
    color.blue * 255
  )}, ${alpha})`;

/** 用图层自身的 alpha 给一块颜色做剪影 */
function silhouette(sprite: HTMLCanvasElement, color: CompRgb): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sprite.width, sprite.height);
  ctx.drawImage(sprite, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = rgbToCss(color);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function padPiece(piece: Piece, pad: number): Piece {
  if (pad <= 0) return piece;
  const { canvas, ctx } = createCanvas(piece.canvas.width + pad * 2, piece.canvas.height + pad * 2);
  ctx.drawImage(piece.canvas, pad, pad);
  return { canvas, ox: piece.ox - pad, oy: piece.oy - pad };
}

function blurPiece(piece: Piece, radius: number): Piece {
  if (radius <= 0) return piece;
  const pad = Math.ceil(radius * 2);
  const { canvas, ctx } = createCanvas(piece.canvas.width + pad * 2, piece.canvas.height + pad * 2);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(piece.canvas, pad, pad);
  return { canvas, ox: piece.ox - pad, oy: piece.oy - pad };
}

const radians = (deg: number) => (deg * Math.PI) / 180;

/** 圆形采样数：48 个方向对半径的逼近误差在 1px 以内，和半径大小基本无关 */
const DILATE_SAMPLES = 48;

function drawShadow(sprite: HTMLCanvasElement, effect: DropShadowEffect, octx: CanvasRenderingContext2D): void {
  const sil: Piece = { canvas: silhouette(sprite, effect.color), ox: 0, oy: 0 };
  const dx = Math.cos(radians(effect.angle)) * effect.distance;
  const dy = -Math.sin(radians(effect.angle)) * effect.distance;
  const spread = padPiece(sil, Math.ceil(Math.abs(effect.distance)));
  const soft = blurPiece(spread, effect.blur);
  octx.save();
  octx.globalAlpha = effect.opacity;
  octx.drawImage(soft.canvas, soft.ox + dx, soft.oy + dy);
  octx.restore();
}

function drawGlow(
  sprite: HTMLCanvasElement,
  effect: GlowEffect,
  octx: CanvasRenderingContext2D,
  inside: boolean
): void {
  if (!inside) {
    const sil: Piece = { canvas: silhouette(sprite, effect.color), ox: 0, oy: 0 };
    const soft = blurPiece(sil, effect.size);
    octx.save();
    octx.globalAlpha = effect.opacity;
    octx.drawImage(soft.canvas, soft.ox, soft.oy);
    octx.restore();
    return;
  }

  // 内发光：反向剪影 → 模糊 → 裁回形内
  const pad = Math.ceil(effect.size * 2) + 2;
  const { canvas: inv, ctx: ictx } = createCanvas(sprite.width + pad * 2, sprite.height + pad * 2);
  ictx.fillStyle = rgbToCss(effect.color);
  ictx.fillRect(0, 0, inv.width, inv.height);
  ictx.globalCompositeOperation = 'destination-out';
  ictx.drawImage(sprite, pad, pad);

  const soft = blurPiece({ canvas: inv, ox: -pad, oy: -pad }, effect.size);
  const { canvas: stage, ctx: sctx } = createCanvas(sprite.width, sprite.height);
  sctx.drawImage(soft.canvas, soft.ox, soft.oy);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(sprite, 0, 0);

  octx.save();
  octx.globalAlpha = effect.opacity;
  octx.drawImage(stage, 0, 0);
  octx.restore();
}

function drawInnerShadow(
  sprite: HTMLCanvasElement,
  effect: InnerShadowEffect,
  octx: CanvasRenderingContext2D
): void {
  const pad = Math.ceil(Math.abs(effect.distance)) + 4;
  const { canvas: inv, ctx: ictx } = createCanvas(sprite.width + pad * 2, sprite.height + pad * 2);
  ictx.fillStyle = rgbToCss(effect.color);
  ictx.fillRect(0, 0, inv.width, inv.height);
  ictx.globalCompositeOperation = 'destination-out';
  ictx.drawImage(sprite, pad, pad);

  const dx = Math.cos(radians(effect.angle)) * effect.distance;
  const dy = -Math.sin(radians(effect.angle)) * effect.distance;
  const soft = blurPiece({ canvas: inv, ox: -pad, oy: -pad }, effect.blur);

  const { canvas: stage, ctx: sctx } = createCanvas(sprite.width, sprite.height);
  sctx.drawImage(soft.canvas, soft.ox + dx, soft.oy + dy);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(sprite, 0, 0);

  octx.save();
  octx.globalAlpha = effect.opacity;
  octx.drawImage(stage, 0, 0);
  octx.restore();
}

/**
 * 描边环。
 *
 * 被两条路径共用：Canvas2D 合成器直接用；GPU 合成链则把它的结果当成一张纹理喂进合成
 * （描边是形态学膨胀 / 腐蚀，GPU 近似方案的精度取舍见 `gl/effects.ts` 顶部说明）。
 */
export function drawStroke(
  sprite: HTMLCanvasElement,
  effect: StrokeEffect,
  octx: CanvasRenderingContext2D
): void {
  const sil = silhouette(sprite, effect.color);
  const size = Math.max(0, effect.size);

  // 圆形采样膨胀 / 腐蚀：K 个方向上的平移并集（外面）或交集（里面）
  const pad = effect.inside ? 0 : Math.ceil(size);
  const { canvas: work, ctx: wctx } = createCanvas(sprite.width + pad * 2, sprite.height + pad * 2);
  if (effect.inside) {
    // 先铺满，再逐个方向求交 → 得到「腐蚀」结果
    wctx.fillStyle = rgbToCss(effect.color);
    wctx.fillRect(0, 0, work.width, work.height);
    wctx.globalCompositeOperation = 'destination-in';
    for (let i = 0; i < DILATE_SAMPLES; i += 1) {
      const a = (i / DILATE_SAMPLES) * Math.PI * 2;
      wctx.drawImage(sil, -Math.cos(a) * size, -Math.sin(a) * size);
    }
    // 描边 = 形内 − 腐蚀
    const { canvas: ring, ctx: rctx } = createCanvas(sprite.width, sprite.height);
    rctx.fillStyle = rgbToCss(effect.color);
    rctx.fillRect(0, 0, ring.width, ring.height);
    rctx.globalCompositeOperation = 'destination-in';
    rctx.drawImage(sil, 0, 0);
    rctx.globalCompositeOperation = 'destination-out';
    rctx.drawImage(work, -pad, -pad);
    octx.save();
    octx.globalAlpha = effect.opacity;
    octx.drawImage(ring, 0, 0);
    octx.restore();
    return;
  }

  wctx.translate(pad, pad);
  for (let i = 0; i < DILATE_SAMPLES; i += 1) {
    const a = (i / DILATE_SAMPLES) * Math.PI * 2;
    wctx.drawImage(sil, Math.cos(a) * size, Math.sin(a) * size);
  }
  // 外描边 = 膨胀 − 原形
  wctx.globalCompositeOperation = 'destination-out';
  wctx.drawImage(sprite, 0, 0);

  octx.save();
  octx.globalAlpha = effect.opacity;
  octx.drawImage(work, -pad, -pad);
  octx.restore();
}

function withColorOverlay(
  sprite: HTMLCanvasElement,
  effect: ColorOverlayEffect
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sprite.width, sprite.height);
  ctx.drawImage(sprite, 0, 0);
  ctx.globalAlpha = effect.opacity;
  ctx.drawImage(silhouette(sprite, effect.color), 0, 0);
  return canvas;
}

/**
 * 把图层效果合成到 `octx`。
 *
 * @param sprite 图层本体（已应用蒙版）的像素
 * @param ox / oy sprite 左上角在文档坐标中的位置；`octx` 需已平移到文档坐标空间
 */
export function renderEffects(
  effects: LayerEffects | null,
  sprite: HTMLCanvasElement,
  ox: number,
  oy: number,
  octx: CanvasRenderingContext2D
): void {
  if (!effects) return;

  octx.save();
  octx.translate(ox, oy);

  if (effects.shadow?.enabled) drawShadow(sprite, effects.shadow, octx);
  if (effects.outerGlow?.enabled) drawGlow(sprite, effects.outerGlow, octx, false);

  const body = effects.colorOverlay?.enabled ? withColorOverlay(sprite, effects.colorOverlay) : sprite;
  octx.drawImage(body, 0, 0);

  if (effects.stroke?.enabled) drawStroke(sprite, effects.stroke, octx);
  if (effects.innerShadow?.enabled) drawInnerShadow(sprite, effects.innerShadow, octx);
  if (effects.innerGlow?.enabled) drawGlow(sprite, effects.innerGlow, octx, true);

  octx.restore();
}
