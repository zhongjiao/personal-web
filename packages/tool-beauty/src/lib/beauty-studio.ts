/**
 * 美图工坊核心：美颜算法、滤镜 / 调色参数、几何烘焙与「底图派生」管线。
 *
 * 设计要点（配合 KonvaCanvas 使用）：
 * - **美颜**（磨皮 / 美白 / 红润 / 清晰度）与**色温**属于逐像素运算，无法用 CSS filter 表达，
 *   因此走「派生底图」：`deriveBase(原图, 几何, 参数)` 一次性算出当前底图；
 *   预览用降采样到长边 1400 的副本（够快），导出前才在全分辨率上重跑一遍（够清晰）。
 * - **调色 / 滤镜**走 CSS filter（`mergeAdjust` 把两层参数合成一份 `AdjustParams`），预览实时、导出 1:1。
 * - **几何**（旋转 / 翻转 / 拉直 / 透视 / 裁剪）同样只是参数：所有状态都是纯数据，
 *   于是撤销重做不需要保存任何画布，重放参数即可。
 */

import {
  applySharpen,
  bakeCrop,
  bakeFineRotate,
  bakeOrientation,
  bakePerspective,
  clamp,
  FONT_FAMILIES,
  mimeOf,
  type AdjustParams,
  type CropRect,
  type ExportFormat,
  type FontKind,
  type RotateAngle
} from '@pmp/image-kit';

export { mimeOf };
export type { ExportFormat };

export interface BeautyParams {
  /* ---- 美颜 ---- */
  /** 磨皮（保边平滑） */
  smooth: number;
  /** 美白 */
  whiten: number;
  /** 红润 */
  rosy: number;
  /** 清晰度（USM 锐化） */
  sharpen: number;
  /* ---- 调节 ---- */
  /** 亮度 % */
  brightness: number;
  /** 对比度 % */
  contrast: number;
  /** 饱和度 % */
  saturate: number;
  /** 色相 deg */
  hue: number;
  /** 色温 -100（冷）~ 100（暖），随底图一起烘焙 */
  temperature: number;
  /** 复古 % */
  sepia: number;
  /** 黑白 % */
  grayscale: number;
  /** 暗角 0~100 */
  vignette: number;
  /** 模糊 px */
  blur: number;
}

export const DEFAULT_PARAMS: BeautyParams = {
  smooth: 0,
  whiten: 0,
  rosy: 0,
  sharpen: 0,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  temperature: 0,
  sepia: 0,
  grayscale: 0,
  vignette: 0,
  blur: 0
};

/** 参与逐像素「皮肤层」运算的参数 */
export const SKIN_KEYS = ['smooth', 'whiten', 'rosy', 'sharpen'] as const;
export type SkinKey = (typeof SKIN_KEYS)[number];

export interface Preset {
  id: string;
  name: string;
  hint?: string;
  params: Partial<BeautyParams>;
}

/** 一键美颜：只影响美颜滑杆 */
export const BEAUTY_PRESETS: Preset[] = [
  { id: 'none', name: '原图', params: {} },
  { id: 'natural', name: '自然', hint: '日常', params: { smooth: 32, whiten: 16, rosy: 12 } },
  { id: 'fair', name: '白皙', hint: '通透', params: { smooth: 44, whiten: 46, rosy: 10, sharpen: 12 } },
  { id: 'rosy', name: '红润', hint: '气色', params: { smooth: 38, whiten: 18, rosy: 44 } },
  { id: 'clear', name: '清透', hint: '质感', params: { smooth: 28, whiten: 26, rosy: 8, sharpen: 26 } },
  { id: 'soft', name: '柔焦', hint: '氛围', params: { smooth: 62, whiten: 24, rosy: 14, sharpen: 0 } },
  { id: 'power', name: '强力', hint: '明显', params: { smooth: 78, whiten: 40, rosy: 22, sharpen: 10 } }
];

/** 滤镜：只影响色彩调节参数，可叠加强度 */
export const FILTER_PRESETS: Preset[] = [
  { id: 'none', name: '原图', params: {} },
  { id: 'fresh', name: '清新', params: { brightness: 106, contrast: 104, saturate: 112, temperature: -10 } },
  { id: 'film', name: '胶片', params: { contrast: 112, saturate: 88, temperature: 14, vignette: 26, sepia: 14 } },
  { id: 'mono', name: '黑白', params: { grayscale: 100, contrast: 114 } },
  { id: 'vintage', name: '复古', params: { sepia: 44, saturate: 82, contrast: 104, brightness: 103, vignette: 22 } },
  { id: 'warm', name: '暖阳', params: { temperature: 36, saturate: 118, brightness: 105 } },
  { id: 'cool', name: '冷调', params: { temperature: -34, saturate: 106, contrast: 106 } },
  { id: 'vivid', name: '鲜亮', params: { saturate: 148, contrast: 116, brightness: 104 } },
  { id: 'milk', name: '奶白', params: { brightness: 110, contrast: 92, saturate: 96, temperature: 8 } },
  { id: 'night', name: '夜色', params: { brightness: 94, contrast: 118, saturate: 92, temperature: -18, vignette: 46 } },
  { id: 'dream', name: '梦幻', params: { brightness: 106, saturate: 122, hue: 8, blur: 1.6 } },
  { id: 'ink', name: '水墨', params: { grayscale: 78, contrast: 124, brightness: 106 } }
];

/** 以默认为基准，把 target 按 k（0~1）混合进来 */
export function mixParams(target: Partial<BeautyParams>, k: number): BeautyParams {
  const ratio = clamp(k, 0, 1);
  const out = { ...DEFAULT_PARAMS };
  for (const key of Object.keys(target) as (keyof BeautyParams)[]) {
    const t = target[key];
    if (typeof t !== 'number') continue;
    out[key] = DEFAULT_PARAMS[key] + (t - DEFAULT_PARAMS[key]) * ratio;
  }
  return out;
}

/** 滤镜强度换算成实际的色彩参数 */
export function filterParamsOf(preset: Preset, strength: number): BeautyParams {
  return mixParams(preset.params, strength / 100);
}

/**
 * 把「用户调节」与「滤镜」两层参数合成一份 `AdjustParams`（KonvaCanvas / ctx.filter 用）。
 * 乘法项（亮度 / 对比度 / 饱和度）直接相乘，加减项（色相 / 模糊 / 暗角）相加，
 * 百分比叠加项（复古 / 黑白）按 a + b - ab 合成，保证与原先两层 CSS filter 叠加的观感一致。
 */
export function mergeAdjust(base: BeautyParams, filter: BeautyParams): AdjustParams {
  const mul = (a: number, b: number) => (a * b) / 100;
  const stack = (a: number, b: number) => 100 - ((100 - a) * (100 - b)) / 100;
  return {
    brightness: clamp(mul(base.brightness, filter.brightness), 5, 400),
    contrast: clamp(mul(base.contrast, filter.contrast), 5, 400),
    saturate: clamp(mul(base.saturate, filter.saturate), 0, 400),
    hue: base.hue + filter.hue,
    blur: base.blur + filter.blur,
    grayscale: stack(base.grayscale, filter.grayscale),
    sepia: stack(base.sepia, filter.sepia),
    invert: 0,
    vignette: clamp(base.vignette + filter.vignette, 0, 100)
  };
}

/** 色温叠加层（预览 / 烘焙共用） */
export function tempTint(temperature: number): { color: string; opacity: number } | null {
  if (Math.abs(temperature) < 1) return null;
  const k = Math.min(1, Math.abs(temperature) / 100);
  return temperature > 0
    ? { color: '#ff9a3c', opacity: 0.2 * k }
    : { color: '#3b82f6', opacity: 0.2 * k };
}

/* ===================== 画布工具 ===================== */

export function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

/** 图片 / 画布 → 画布（maxSize 限制长边，用于预览降采样） */
export function toCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxSize?: number
): HTMLCanvasElement {
  const isImage = source instanceof HTMLImageElement;
  let w = isImage ? source.naturalWidth || source.width : source.width;
  let h = isImage ? source.naturalHeight || source.height : source.height;
  if (maxSize) {
    const s = Math.min(1, maxSize / Math.max(w, h));
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/* ===================== 美颜（逐像素） ===================== */

export function hasSkinOps(p: Partial<BeautyParams>): boolean {
  return (p.smooth ?? 0) > 0 || (p.whiten ?? 0) > 0 || (p.rosy ?? 0) > 0 || (p.sharpen ?? 0) > 0;
}

/** 降采样再放大的廉价高斯，用于磨皮 / 锐化取模糊参考 */
function softBlur(source: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const f = Math.max(2, Math.round(radius));
  const sw = Math.max(2, Math.round(w / f));
  const sh = Math.max(2, Math.round(h / f));
  const small = canvasOf(sw, sh);
  const out = canvasOf(w, h);
  const sctx = small.getContext('2d');
  const octx = out.getContext('2d');
  if (!sctx || !octx) return source;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, 0, 0, sw, sh);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  return out;
}

/**
 * 美颜主流程：保边磨皮 + 美白 + 红润，最后可选锐化。
 * 返回新画布，不修改入参。
 */
export function applySkin(source: HTMLCanvasElement, p: BeautyParams): HTMLCanvasElement {
  const out = canvasOf(source.width, source.height);
  const octx = out.getContext('2d');
  if (!octx) return source;
  octx.drawImage(source, 0, 0);

  const skinActive = p.smooth > 0 || p.whiten > 0 || p.rosy > 0;
  if (!skinActive) {
    return p.sharpen > 0 ? applySharpen(out, Math.min(2, (p.sharpen / 100) * 1.4)) : out;
  }

  const w = out.width;
  const h = out.height;
  let src: ImageData;
  try {
    src = octx.getImageData(0, 0, w, h);
  } catch {
    return out;
  }
  const s = src.data;

  let blur: Uint8ClampedArray | null = null;
  if (p.smooth > 0) {
    const radius = 2 + (p.smooth / 100) * 6;
    const bctx = softBlur(out, radius).getContext('2d');
    if (bctx) blur = bctx.getImageData(0, 0, w, h).data;
  }

  const result = octx.createImageData(w, h);
  const o = result.data;
  const sk = clamp(p.smooth / 100, 0, 1);
  const wk = clamp(p.whiten / 100, 0, 1);
  const rk = clamp(p.rosy / 100, 0, 1);

  for (let i = 0; i < s.length; i += 4) {
    let r = s[i];
    let g = s[i + 1];
    let b = s[i + 2];

    if (blur) {
      const br = blur[i];
      const bg = blur[i + 1];
      const bb = blur[i + 2];
      // 边缘保护：与模糊结果差异越大，说明是轮廓 / 纹理，越保留原样
      const diff = (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)) / 3;
      const edge = diff < 12 ? 0 : Math.min(1, (diff - 12) / 34);
      const k = sk * 0.9 * (1 - edge);
      r += (br - r) * k;
      g += (bg - g) * k;
      b += (bb - b) * k;
    }

    if (wk > 0) {
      const k = wk * 0.6;
      r += (255 - r) * k;
      g += (255 - g) * k;
      b += (255 - b) * k;
    }

    if (rk > 0) {
      // 只对偏暖的皮肤色区域加红，避免把背景也染红
      const skin = clamp((r - b) / 55, 0, 1) * clamp((r - 60) / 80, 0, 1);
      const k = rk * skin;
      r = clamp(r + 18 * k, 0, 255);
      g = clamp(g + 5 * k, 0, 255);
      b = clamp(b - 7 * k, 0, 255);
    }

    o[i] = r;
    o[i + 1] = g;
    o[i + 2] = b;
    o[i + 3] = s[i + 3];
  }

  octx.putImageData(result, 0, 0);
  return p.sharpen > 0 ? applySharpen(out, Math.min(2, (p.sharpen / 100) * 1.4)) : out;
}

/* ===================== 几何 + 底图派生 ===================== */

/**
 * 几何操作（有序链）：每个操作都是「相对当前画面」的纯数据，
 * 依次作用在原图上即可得到当前底图 —— 预览、导出、撤销重放共用同一条链路，不存在两套语义。
 */
export type GeoOp =
  | { kind: 'rotate'; delta: RotateAngle }
  | { kind: 'flip'; axis: 'h' | 'v' }
  | { kind: 'straighten'; angle: number }
  | { kind: 'perspective'; points: [number, number][] }
  | { kind: 'crop'; rect: CropRect };

export interface Geometry {
  ops: GeoOp[];
}

export const DEFAULT_GEOMETRY: Geometry = { ops: [] };

const cloneOp = (op: GeoOp): GeoOp =>
  op.kind === 'crop'
    ? { kind: 'crop', rect: { ...op.rect } }
    : op.kind === 'perspective'
      ? { kind: 'perspective', points: op.points.map(([x, y]) => [x, y] as [number, number]) }
      : { ...op };

export const cloneGeometry = (g: Geometry): Geometry => ({ ops: g.ops.map(cloneOp) });

export const GEO_OP_LABEL: Record<GeoOp['kind'], string> = {
  rotate: '旋转',
  flip: '翻转',
  straighten: '拉直',
  perspective: '透视',
  crop: '裁剪'
};

const isFullCrop = (c: CropRect) => c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.999 && c.h >= 0.999;

/** 几何指纹：用于 memo / 缓存失效判断 */
export function geometryKey(g: Geometry): string {
  return g.ops
    .map((op) =>
      op.kind === 'rotate'
        ? `r${op.delta}`
        : op.kind === 'flip'
          ? `f${op.axis}`
          : op.kind === 'straighten'
            ? `s${op.angle.toFixed(2)}`
            : op.kind === 'crop'
              ? `c${op.rect.x.toFixed(4)},${op.rect.y.toFixed(4)},${op.rect.w.toFixed(4)},${op.rect.h.toFixed(4)}`
              : `p${op.points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')}`
    )
    .join('|');
}

/** 画布尺寸随几何操作变化的推算（导出前用它判断是否需要对全分辨率底图重算） */
export function geoOpSummary(op: GeoOp): string {
  switch (op.kind) {
    case 'rotate':
      return `旋转 ${op.delta}°`;
    case 'flip':
      return op.axis === 'h' ? '水平翻转' : '垂直翻转';
    case 'straighten':
      return `拉直 ${op.angle.toFixed(1)}°`;
    case 'perspective':
      return '透视校正';
    default:
      return `裁剪 ${Math.round(op.rect.w * 100)}% × ${Math.round(op.rect.h * 100)}%`;
  }
}

/** 参与烘焙的参数指纹（美颜 + 色温） */
export function bakeKeyOf(p: BeautyParams): string {
  return `${SKIN_KEYS.map((k) => p[k]).join(',')}|${p.temperature}`;
}

/** 色温烘焙（soft-light 混合，与预览观感一致） */
export function bakeTemperature(source: HTMLCanvasElement, temperature: number): HTMLCanvasElement {
  const tint = tempTint(temperature);
  if (!tint) return source;
  const out = canvasOf(source.width, source.height);
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = tint.opacity;
  ctx.fillStyle = tint.color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.restore();
  return out;
}

/**
 * 派生当前底图：`原图 → 美颜 → 几何操作链（依次） → 色温`。
 * beauty = false 时跳过美颜与色温（用于「按住看原图」的对比层）。
 */
export function deriveBase(
  source: HTMLCanvasElement,
  geo: Geometry,
  params: BeautyParams,
  beauty = true
): HTMLCanvasElement {
  let out = source;
  if (beauty && hasSkinOps(params)) {
    out = applySkin(out, {
      ...DEFAULT_PARAMS,
      smooth: params.smooth,
      whiten: params.whiten,
      rosy: params.rosy,
      sharpen: params.sharpen
    });
  }
  for (const op of geo.ops) {
    switch (op.kind) {
      case 'rotate':
        out = bakeOrientation(out, out.width, out.height, op.delta, false, false);
        break;
      case 'flip':
        out = bakeOrientation(out, out.width, out.height, 0, op.axis === 'h', op.axis === 'v');
        break;
      case 'straighten':
        out = bakeFineRotate(out, op.angle);
        break;
      case 'perspective':
        out = bakePerspective(
          out,
          op.points.map(([x, y]) => [x * out.width, y * out.height] as [number, number])
        );
        break;
      case 'crop':
        if (!isFullCrop(op.rect)) out = bakeCrop(out, op.rect);
        break;
    }
  }
  if (beauty) out = bakeTemperature(out, params.temperature);
  return out;
}

/** 几何操作链是否包含裁剪 / 透视（用于提示「拉直建议先应用」这类信息） */
export function hasBakedCrop(geo: Geometry): boolean {
  return geo.ops.some((op) => (op.kind === 'crop' && !isFullCrop(op.rect)) || op.kind === 'perspective');
}

/** 底图缩略图（图层面板用），长边 96，返回 dataURL */
export function baseThumbnail(source: HTMLCanvasElement): string {
  return toCanvas(source, 96).toDataURL('image/jpeg', 0.72);
}

/* ===================== 示例图 ===================== */

/** 没有素材时用来试玩：生成一张暖色渐变示例图 */
export function createSampleImage(w = 900, h = 1200): HTMLCanvasElement {
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#ffe7d6');
  bg.addColorStop(0.45, '#ffd0d8');
  bg.addColorStop(1, '#d9d3ff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const blobs: [number, number, number, string][] = [
    [0.28, 0.24, 0.34, 'rgba(255,169,120,0.75)'],
    [0.74, 0.34, 0.28, 'rgba(255,120,170,0.55)'],
    [0.45, 0.66, 0.4, 'rgba(160,150,255,0.5)'],
    [0.82, 0.82, 0.24, 'rgba(255,214,140,0.6)']
  ];
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.42, w * (0.12 + i * 0.07), 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

/* ===================== 几何（旋转 / 翻转，美图工坊页用） ===================== */

export interface Transform {
  rotate: RotateAngle;
  flipH: boolean;
  flipV: boolean;
}

export const DEFAULT_TRANSFORM: Transform = { rotate: 0, flipH: false, flipV: false };

/** 把旋转 + 镜像烘焙成一张新的位图（画布尺寸随之换向） */
export function bakeTransform(source: HTMLCanvasElement, transform: Transform): HTMLCanvasElement {
  return bakeOrientation(
    source,
    source.width,
    source.height,
    transform.rotate,
    transform.flipH,
    transform.flipV
  );
}

/* ===================== CSS 滤镜（调色 / 滤镜预览） ===================== */

/** 把调色参数转成 CSS filter 字符串（乘法项 + 加减项），中性参数省略 */
export function cssFilterOf(p: BeautyParams): string {
  const parts: string[] = [];
  if (p.brightness !== 100) parts.push(`brightness(${p.brightness}%)`);
  if (p.contrast !== 100) parts.push(`contrast(${p.contrast}%)`);
  if (p.saturate !== 100) parts.push(`saturate(${p.saturate}%)`);
  if (p.hue !== 0) parts.push(`hue-rotate(${p.hue}deg)`);
  if (p.blur > 0) parts.push(`blur(${p.blur}px)`);
  if (p.sepia > 0) parts.push(`sepia(${p.sepia}%)`);
  if (p.grayscale > 0) parts.push(`grayscale(${p.grayscale}%)`);
  return parts.join(' ');
}

/* ===================== 装饰层（贴纸 / 文字） ===================== */

export type Deco =
  | {
      id: number;
      type: 'sticker';
      sticker: string;
      color: string;
      x: number;
      y: number;
      size: number;
      rotation: number;
    }
  | {
      id: number;
      type: 'text';
      text: string;
      color: string;
      bg: string | null;
      font: FontKind;
      x: number;
      y: number;
      size: number;
      rotation: number;
    };

const STICKER_GLYPH: Record<string, string> = {
  star: '★',
  heart: '♥',
  circle: '●',
  badge: '💬',
  check: '✓',
  cross: '✕',
  crown: '♛',
  flame: '🔥',
  bolt: '⚡',
  arrow: '➜',
  music: '♪',
  sun: '☀'
};

const stickerGlyph = (id: string) => (id.startsWith('e:') ? id.slice(2) : STICKER_GLYPH[id] ?? '★');

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * 把装饰元素画进上下文（坐标 / 尺寸均归一化到 viewW / viewH，与 DOM 预览共用同一套逻辑）。
 * 每个元素以 (x, y) 为中心、按 rotation 旋转后绘制。
 */
export function drawDecos(
  ctx: CanvasRenderingContext2D,
  decos: Deco[],
  viewW: number,
  viewH: number
) {
  for (const d of decos) {
    ctx.save();
    ctx.translate(d.x * viewW, d.y * viewH);
    ctx.rotate((d.rotation * Math.PI) / 180);
    if (d.type === 'sticker') {
      const box = Math.max(8, d.size * viewW);
      ctx.font = `${box}px system-ui, -apple-system, "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = d.color;
      ctx.fillText(stickerGlyph(d.sticker), 0, 0);
    } else {
      const fs = Math.max(8, d.size * viewW);
      const lines = d.text.split('\n');
      const lineHeight = fs * 1.28;
      ctx.font = `${fs}px ${FONT_FAMILIES[d.font]}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const maxLen = Math.max(1, ...lines.map((l) => l.length));
      const bw = Math.max(fs, maxLen * fs * 1.06 + fs * 0.9);
      const bh = lines.length * lineHeight + fs * 0.9;
      if (d.bg) {
        roundedRectPath(ctx, -bw / 2, -bh / 2, bw, bh, fs * 0.5);
        ctx.fillStyle = d.bg;
        ctx.fill();
      }
      ctx.fillStyle = d.color;
      lines.forEach((line, i) => {
        ctx.fillText(line, -bw / 2 + fs * 0.45, -bh / 2 + fs * 0.45 + i * lineHeight);
      });
    }
    ctx.restore();
  }
}

/* ===================== 导出 ===================== */

export interface ExportImageOptions {
  source: HTMLCanvasElement;
  params: BeautyParams;
  filter: BeautyParams;
  decos: Deco[];
  transform: Transform;
  format: ExportFormat;
  quality: number;
  longEdge: number | null;
  background: string;
}

/**
 * 全分辨率重跑一遍完整管线：美颜 → 几何 → 缩放 → 调色/滤镜 → 色温 → 暗角 → 装饰 → 编码。
 * 与预览完全同一套参数，保证所见即所得。
 */
export async function exportImage(opts: ExportImageOptions): Promise<Blob> {
  const { source, params, filter, decos, transform, format, quality, longEdge, background } = opts;

  let out = source;

  // 1. 美颜（逐像素）
  const skin: Partial<BeautyParams> = {
    smooth: params.smooth,
    whiten: params.whiten,
    rosy: params.rosy,
    sharpen: params.sharpen
  };
  if (hasSkinOps(skin)) {
    out = applySkin(out, { ...DEFAULT_PARAMS, ...skin });
  }

  // 2. 几何（旋转 + 翻转）
  out = bakeTransform(out, transform);

  // 3. 按长边缩放（不放大）
  if (longEdge) out = toCanvas(out, longEdge);

  // 4. 调色 / 滤镜（CSS filter 一次烘焙）
  const css = `${cssFilterOf(params)} ${cssFilterOf(filter)}`.trim();
  if (css) {
    const filtered = canvasOf(out.width, out.height);
    const fctx = filtered.getContext('2d');
    if (fctx) {
      fctx.filter = css;
      fctx.drawImage(out, 0, 0);
      out = filtered;
    }
  }

  // 5. 色温（soft-light 混合）
  out = bakeTemperature(out, params.temperature);

  // 6. 暗角（径向渐变）
  if (params.vignette > 0) {
    const w = out.width;
    const h = out.height;
    const ctx = out.getContext('2d');
    if (ctx) {
      const rMax = Math.hypot(w, h) / 2;
      const gradient = ctx.createRadialGradient(w / 2, h / 2, rMax * 0.42, w / 2, h / 2, rMax);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${(0.8 * params.vignette) / 100})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // 7. 装饰层
  if (decos.length) {
    const ctx = out.getContext('2d');
    if (ctx) drawDecos(ctx, decos, out.width, out.height);
  }

  // 8. JPG 铺白底后编码
  let output = out;
  if (format === 'jpeg') {
    output = canvasOf(out.width, out.height);
    const ctx = output.getContext('2d');
    if (ctx) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.drawImage(out, 0, 0);
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    output.toBlob(resolve, mimeOf(format), quality)
  );
  if (!blob) throw new Error('导出失败');
  return blob;
}
