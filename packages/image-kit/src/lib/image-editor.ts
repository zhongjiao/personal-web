/** 图片编辑核心：方向烘焙、裁剪、滤镜、导出（纯函数，不依赖 React） */

export type RotateAngle = 0 | 90 | 180 | 270;
export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface AdjustParams {
  /** 亮度 % */
  brightness: number;
  /** 对比度 % */
  contrast: number;
  /** 饱和度 % */
  saturate: number;
  /** 色相 deg */
  hue: number;
  /** 模糊 px */
  blur: number;
  /** 灰度 % */
  grayscale: number;
  /** 复古 % */
  sepia: number;
  /** 反色 % */
  invert: number;
  /** 暗角强度 %（渲染时叠加，非 CSS filter） */
  vignette: number;
}

export interface FilterPreset {
  id: string;
  name: string;
  adjust: Partial<AdjustParams>;
}

/** 一键风格预设：值为目标参数，配合强度按比例混合 */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', name: '原图', adjust: {} },
  { id: 'fresh', name: '清新', adjust: { brightness: 108, contrast: 104, saturate: 114, hue: -6 } },
  { id: 'film', name: '胶片', adjust: { brightness: 104, contrast: 112, saturate: 86, sepia: 20 } },
  { id: 'mono', name: '黑白', adjust: { grayscale: 100, contrast: 112 } },
  { id: 'vintage', name: '复古', adjust: { sepia: 44, saturate: 80, contrast: 104, brightness: 102 } },
  { id: 'warm', name: '暖阳', adjust: { hue: -12, saturate: 120, brightness: 106, sepia: 10 } },
  { id: 'cool', name: '冷调', adjust: { hue: 14, saturate: 108, contrast: 106, brightness: 101 } },
  { id: 'vivid', name: '鲜亮', adjust: { saturate: 148, contrast: 118, brightness: 104 } },
  { id: 'soft', name: '柔光', adjust: { brightness: 110, contrast: 92, saturate: 106, blur: 0.8 } },
  { id: 'night', name: '夜色', adjust: { brightness: 92, contrast: 120, saturate: 92, vignette: 46 } },
  { id: 'dream', name: '梦幻', adjust: { brightness: 106, saturate: 122, hue: 8, blur: 1.4 } },
  { id: 'invert', name: '反色', adjust: { invert: 100 } }
];

/** 以 base 为基准，按 k（0~1）向 preset 混合 */
export function mixAdjust(
  base: AdjustParams,
  preset: Partial<AdjustParams>,
  k: number
): AdjustParams {
  const out = { ...base };
  for (const key of Object.keys(preset) as (keyof AdjustParams)[]) {
    const target = preset[key];
    if (typeof target !== 'number') continue;
    out[key] = base[key] + (target - base[key]) * k;
  }
  return out;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFAULT_ADJUST: AdjustParams = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  vignette: 0
};

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export const ASPECT_PRESETS: { label: string; value: number | null }[] = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '3:4', value: 3 / 4 }
];

export function filterCss(a: AdjustParams): string {
  const parts = [
    `brightness(${a.brightness}%)`,
    `contrast(${a.contrast}%)`,
    `saturate(${a.saturate}%)`,
    `hue-rotate(${a.hue}deg)`
  ];
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  if (a.grayscale > 0) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.sepia > 0) parts.push(`sepia(${a.sepia}%)`);
  if (a.invert > 0) parts.push(`invert(${a.invert}%)`);
  return parts.join(' ');
}

/** 旋转后的画面尺寸（90/270 时宽高互换） */
export function orientedSize(w: number, h: number, rotate: RotateAngle) {
  return rotate === 90 || rotate === 270 ? { w: h, h: w } : { w, h };
}

/** 把旋转 + 镜像烘焙成一张新的位图，方便后续按像素坐标裁剪/导出 */
export function bakeOrientation(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  rotate: RotateAngle,
  flipH: boolean,
  flipV: boolean
): HTMLCanvasElement {
  const { w: ow, h: oh } = orientedSize(sw, sh, rotate);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, ow);
  canvas.height = Math.max(1, oh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.save();
  ctx.translate(ow / 2, oh / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  return canvas;
}

/** 裁剪框落到位图上（应用裁剪） */
export function bakeCrop(bitmap: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const sw = Math.max(1, Math.round(crop.w * bitmap.width));
  const sh = Math.max(1, Math.round(crop.h * bitmap.height));
  const sx = Math.round(crop.x * bitmap.width);
  const sy = Math.round(crop.y * bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

/** 归一化裁剪框在像素空间的表示 */
export function cropToRect(bitmap: HTMLCanvasElement, crop: CropRect): Rect {
  return {
    left: crop.x * bitmap.width,
    top: crop.y * bitmap.height,
    width: crop.w * bitmap.width,
    height: crop.h * bitmap.height
  };
}

export function outputSize(
  ow: number,
  oh: number,
  crop: CropRect,
  scaleX: number,
  scaleY: number
) {
  return {
    w: Math.max(1, Math.round(ow * crop.w * (scaleX / 100))),
    h: Math.max(1, Math.round(oh * crop.h * (scaleY / 100)))
  };
}

/** 按比例生成居中的最大裁剪框 */
export function cropWithAspect(aspect: number | null, ow: number, oh: number): CropRect {
  if (!aspect) return { ...FULL_CROP };
  const nar = (aspect * oh) / ow;
  let w = 1;
  let h = 1;
  if (nar >= 1) h = 1 / nar;
  else w = nar;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};

export function mimeOf(format: ExportFormat) {
  return MIME[format];
}

export function supportsWebp(): boolean {
  const c = document.createElement('canvas');
  return c.toDataURL('image/webp').startsWith('data:image/webp');
}

/** 按当前参数把位图渲染成 Blob（滤镜随导出一起烘焙） */
export function renderToBlob(
  bitmap: HTMLCanvasElement,
  crop: CropRect,
  scaleX: number,
  scaleY: number,
  adjust: AdjustParams,
  format: ExportFormat,
  quality: number,
  /** 标注层（尺寸与 bitmap 相同，随裁剪/缩放一起合成） */
  overlay?: HTMLCanvasElement | null,
  /** 文字水印 */
  watermark?: WatermarkOptions | null
): Promise<Blob> {
  const sw = Math.max(1, crop.w * bitmap.width);
  const sh = Math.max(1, crop.h * bitmap.height);
  const sx = crop.x * bitmap.width;
  const sy = crop.y * bitmap.height;
  const { w, h } = outputSize(bitmap.width, bitmap.height, crop, scaleX, scaleY);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('无法创建画布'));
  if (format !== 'png') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = filterCss(adjust);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  ctx.filter = 'none';

  // 暗角（在滤镜之上、标注之下）
  if (adjust.vignette > 0) {
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.28,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.85 * adjust.vignette) / 100})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // 标注层叠加在滤镜之上（不参与滤镜）
  if (overlay) {
    ctx.drawImage(overlay, sx, sy, sw, sh, 0, 0, w, h);
  }

  // 文字水印
  if (watermark) drawWatermark(ctx, w, h, watermark);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出失败'))),
      MIME[format],
      format === 'png' ? undefined : quality
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v;

/* ================= 涂抹 / 标注（涂鸦层） ================= */

export type MarkMode =
  | 'brush'
  | 'eraser'
  | 'rect'
  | 'text'
  | 'mosaic'
  | 'shape'
  | 'sticker'
  | 'photo';

export type ShapeKind = 'line' | 'arrow' | 'rectOutline' | 'ellipse';

export interface MarkBase {
  id: number;
  mode: MarkMode;
  color: string;
  /** 0 ~ 1 */
  opacity: number;
  /** 归一化尺寸：涂抹为笔宽、文本为字号、涂层为线宽，基准为图片宽度 */
  size: number;
  /** 旋转角度（度），仅文本 / 贴纸 / 形状 / 涂层支持 */
  rotation?: number;
}

export interface PathMark extends MarkBase {
  mode: 'brush' | 'eraser' | 'mosaic';
  /** 归一化坐标（0~1，相对底图左上角） */
  points: { x: number; y: number }[];
}

export interface ShapeMark extends MarkBase {
  mode: 'shape';
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 是否填充（否则为描边） */
  filled: boolean;
}

export interface RectMark extends MarkBase {
  mode: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FontKind = 'sans' | 'serif' | 'mono';
export type TextAlignKind = 'left' | 'center' | 'right';

export const FONT_FAMILIES: Record<FontKind, string> = {
  sans: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  serif: 'Georgia, "Songti SC", "SimSun", serif',
  mono: '"JetBrains Mono", Consolas, "Courier New", monospace'
};

export interface TextMark extends MarkBase {
  mode: 'text';
  x: number;
  y: number;
  text: string;
  /** 文本区域尺寸（归一化）；为 0 表示点击放置、按文字自动宽度 */
  w: number;
  h: number;
  font: FontKind;
  /** 是否描边（提高在复杂背景上的可读性） */
  stroke: boolean;
  /** 背景色块（标签样式），null 表示无背景 */
  bg: string | null;
  /** 行高倍数 */
  lineHeight: number;
  align: TextAlignKind;
}

export interface StickerMark extends MarkBase {
  mode: 'sticker';
  /** 内置图形 id，或 'e:😀' 形式的 emoji */
  sticker: string;
  /** 中心坐标（归一化） */
  x: number;
  y: number;
  /** 尺寸（归一化，相对图宽，正方形） */
  size: number;
}

/** 画布上的自由图片：可与底图共存多张，自由拖动 / 缩放 / 旋转 */
export interface PhotoMark extends MarkBase {
  mode: 'photo';
  /** 原始位图（不参与归一化坐标换算） */
  src: HTMLCanvasElement;
  /** 中心坐标（归一化 0~1） */
  x: number;
  y: number;
  /** 归一化宽高 */
  w: number;
  h: number;
  flipH?: boolean;
  flipV?: boolean;
  /** 来源文件名（图库联动展示用） */
  name?: string;
}

/** 内置矢量贴纸 */
export const STICKER_ICONS: { id: string; name: string }[] = [
  { id: 'star', name: '星星' },
  { id: 'heart', name: '爱心' },
  { id: 'circle', name: '圆点' },
  { id: 'badge', name: '气泡' },
  { id: 'check', name: '对勾' },
  { id: 'cross', name: '叉号' },
  { id: 'crown', name: '皇冠' },
  { id: 'flame', name: '火焰' },
  { id: 'bolt', name: '闪电' },
  { id: 'arrow', name: '指向' },
  { id: 'music', name: '音符' },
  { id: 'sun', name: '太阳' }
];

export const STICKER_EMOJI = ['😀', '😍', '😎', '🥳', '😭', '😡', '👍', '👎', '🔥', '⭐', '❤️', '🎉'];

export type Mark = PathMark | RectMark | TextMark | ShapeMark | StickerMark | PhotoMark;

/** 元素归一化包围盒 */
export interface MarkBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function markBounds(m: Mark): MarkBounds {
  switch (m.mode) {
    case 'rect':
    case 'shape':
      return { x: m.x, y: m.y, w: m.w, h: m.h };
    case 'photo':
      // photo 用中心点定位，便于旋转时以中心为轴
      return { x: m.x - m.w / 2, y: m.y - m.h / 2, w: m.w, h: m.h };
    case 'sticker':
      return { x: m.x - m.size / 2, y: m.y - m.size / 2, w: m.size, h: m.size };
    case 'text': {
      if (m.w > 0 && m.h > 0) return { x: m.x, y: m.y, w: m.w, h: m.h };
      const lines = m.text.split('\n');
      const maxLen = Math.max(1, ...lines.map((l) => l.length));
      const w = Math.min(0.96, maxLen * m.size * 0.62);
      const h = Math.min(0.96, lines.length * m.size * 1.4);
      return { x: m.x, y: m.y - h / 2, w, h };
    }
    default: {
      const xs = m.points.map((p) => p.x);
      const ys = m.points.map((p) => p.y);
      const pad = m.size / 2;
      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
}

export function translateMark(m: Mark, dx: number, dy: number) {
  switch (m.mode) {
    case 'rect':
    case 'shape':
    case 'text':
    case 'sticker':
    case 'photo':
      m.x += dx;
      m.y += dy;
      break;
    default:
      m.points = m.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
}

/** 以元素自身中心等比缩放 */
export function scaleMark(m: Mark, k: number) {
  const b = markBounds(m);
  const kk = Math.max(0.1, Math.min(10, k));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  switch (m.mode) {
    case 'rect':
    case 'shape': {
      m.w *= kk;
      m.h *= kk;
      m.x = cx - m.w / 2;
      m.y = cy - m.h / 2;
      break;
    }
    case 'photo': {
      m.w *= kk;
      m.h *= kk;
      break;
    }
    case 'sticker':
      m.size *= kk;
      break;
    case 'text': {
      m.size *= kk;
      if (m.w > 0 && m.h > 0) {
        m.w *= kk;
        m.h *= kk;
        m.x = cx - m.w / 2;
        m.y = cy - m.h / 2;
      } else {
        m.y = cy;
      }
      break;
    }
    default:
      m.points = m.points.map((p) => ({ x: cx + (p.x - cx) * kk, y: cy + (p.y - cy) * kk }));
      m.size *= kk;
  }
}

/** 命中测试（点在归一化包围盒内，带容差） */
export function hitMark(m: Mark, nx: number, ny: number, tolerance = 0.012) {
  const b = markBounds(m);
  return (
    nx >= b.x - tolerance &&
    nx <= b.x + b.w + tolerance &&
    ny >= b.y - tolerance &&
    ny <= b.y + b.h + tolerance
  );
}

/** 旋转后画面中可用的最大内接矩形（自动裁掉空白角） */
function rotatedInnerSize(w: number, h: number, angleRad: number) {
  const sinA = Math.abs(Math.sin(angleRad));
  const cosA = Math.abs(Math.cos(angleRad));
  const widthIsLonger = w >= h;
  const sideLong = widthIsLonger ? w : h;
  const sideShort = widthIsLonger ? h : w;
  if (sideShort <= 2 * sinA * cosA * sideLong || Math.abs(sinA - cosA) < 1e-10) {
    const x = 0.5 * sideShort;
    return widthIsLonger
      ? { w: x / Math.max(sinA, 1e-6), h: x / Math.max(cosA, 1e-6) }
      : { w: x / Math.max(cosA, 1e-6), h: x / Math.max(sinA, 1e-6) };
  }
  const cos2A = cosA * cosA - sinA * sinA;
  return {
    w: (w * cosA - h * sinA) / cos2A,
    h: (h * cosA - w * sinA) / cos2A
  };
}

/** 任意角度旋转（拉直）：旋转并自动裁掉四角空白 */
export function bakeFineRotate(source: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  if (Math.abs(angleDeg) < 0.05) return source;
  const a = (angleDeg * Math.PI) / 180;
  const inner = rotatedInnerSize(source.width, source.height, a);
  const outW = Math.max(1, Math.round(Math.min(inner.w, source.width)));
  const outH = Math.max(1, Math.round(Math.min(inner.h, source.height)));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(a);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

/** 任意角度旋转但保留原画幅（不裁切，用于预览） */
export function rotateKeepSize(source: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

export interface WatermarkOptions {
  text: string;
  /** 字号（图宽百分比） */
  size: number;
  /** 不透明度 % */
  opacity: number;
  /** 倾斜角度 deg */
  angle: number;
  color: string;
  mode: 'tile' | 'corner';
}

export const DEFAULT_WATERMARK: WatermarkOptions = {
  text: '',
  size: 4,
  opacity: 22,
  angle: -28,
  color: '#ffffff',
  mode: 'tile'
};

export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: WatermarkOptions
) {
  if (!opts.text.trim()) return;
  const fs = Math.max(8, (opts.size / 100) * w);
  ctx.save();
  ctx.globalAlpha = clamp(opts.opacity / 100, 0, 1);
  ctx.fillStyle = opts.color;
  ctx.font = `600 ${fs}px ${FONT_FAMILIES.sans}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (opts.mode === 'corner') {
    const pad = fs * 0.9;
    ctx.textAlign = 'right';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = fs * 0.2;
    ctx.fillText(opts.text, w - pad, h - pad);
    ctx.restore();
    return;
  }
  const stepX = Math.max(fs * 2, fs * opts.text.length * 0.75 + fs * 2.5);
  const stepY = fs * 5;
  ctx.translate(w / 2, h / 2);
  ctx.rotate((opts.angle * Math.PI) / 180);
  const diag = Math.hypot(w, h);
  let row = 0;
  for (let y = -diag / 2; y <= diag / 2; y += stepY) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    row += 1;
    for (let x = -diag / 2; x <= diag / 2; x += stepX) {
      ctx.fillText(opts.text, x + offset, y);
    }
  }
  ctx.restore();
}

/* ================= P2：相框 / 画质增强 / 拼图 ================= */

export type FrameId = 'white' | 'polaroid' | 'violet' | 'shadow' | 'rounded';

export const FRAME_PRESETS: { id: FrameId; label: string }[] = [
  { id: 'white', label: '白框' },
  { id: 'polaroid', label: '拍立得' },
  { id: 'violet', label: '紫框' },
  { id: 'shadow', label: '浮层阴影' },
  { id: 'rounded', label: '圆角' }
];

/** 相框（一次性烘焙，不改动坐标系） */
export function applyFrame(source: HTMLCanvasElement, frame: FrameId): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const short = Math.min(w, h);

  if (frame === 'rounded') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    const r = short * 0.06;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, w, h, r);
    else ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  const padTop = Math.round(short * (frame === 'polaroid' ? 0.05 : frame === 'violet' ? 0.03 : frame === 'shadow' ? 0.06 : 0.05));
  const padSide = padTop;
  const padBottom =
    frame === 'polaroid' ? Math.round(short * 0.18) : padTop;
  const outW = w + padSide * 2;
  const outH = h + padTop + padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.imageSmoothingQuality = 'high';

  if (frame === 'white' || frame === 'polaroid') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
  } else if (frame === 'violet') {
    ctx.fillStyle = '#8b5cf6';
    ctx.fillRect(0, 0, outW, outH);
  }

  if (frame === 'shadow') {
    ctx.save();
    ctx.shadowColor = 'rgba(15, 10, 40, 0.45)';
    ctx.shadowBlur = short * 0.05;
    ctx.shadowOffsetY = short * 0.012;
    ctx.drawImage(source, padSide, padTop);
    ctx.restore();
    return canvas;
  }

  ctx.drawImage(source, padSide, padTop);
  return canvas;
}

function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(source, 0, 0);
  return canvas;
}

/** 锐化（USM 简化版：3×3 卷积与原图混合） */
export function applySharpen(source: HTMLCanvasElement, amount = 0.6): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext('2d');
  if (!ctx || w < 3 || h < 3) return source;
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const s = src.data;
  const o = out.data;
  const k = clamp(amount, 0, 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        o[i] = s[i];
        o[i + 1] = s[i + 1];
        o[i + 2] = s[i + 2];
        o[i + 3] = s[i + 3];
        continue;
      }
      const up = i - w * 4;
      const down = i + w * 4;
      for (let c = 0; c < 3; c++) {
        const center = s[i + c];
        const blur = (s[up + c] + s[down + c] + s[i - 4 + c] + s[i + 4 + c]) / 4;
        o[i + c] = clamp(center + (center - blur) * k, 0, 255);
      }
      o[i + 3] = s[i + 3];
    }
  }
  const canvas = cloneCanvas(source);
  const cctx = canvas.getContext('2d');
  cctx?.putImageData(out, 0, 0);
  return canvas;
}

/** 磨皮/柔化（box blur 与原图按强度混合） */
export function applySmooth(source: HTMLCanvasElement, strength = 0.5): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext('2d');
  if (!ctx || w < 3 || h < 3) return source;
  const src = ctx.getImageData(0, 0, w, h);
  const s = src.data;

  // 先把原图缩小再放大，得到廉价的高斯近似
  const small = document.createElement('canvas');
  const sw = Math.max(2, Math.round(w / 6));
  const sh = Math.max(2, Math.round(h / 6));
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d');
  if (!sctx) return source;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, 0, 0, sw, sh);

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = w;
  blurCanvas.height = h;
  const bctx = blurCanvas.getContext('2d');
  if (!bctx) return source;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  const blur = bctx.getImageData(0, 0, w, h).data;

  const out = ctx.createImageData(w, h);
  const o = out.data;
  const k = clamp(strength, 0, 1);
  for (let i = 0; i < s.length; i += 4) {
    o[i] = s[i] * (1 - k) + blur[i] * k;
    o[i + 1] = s[i + 1] * (1 - k) + blur[i + 1] * k;
    o[i + 2] = s[i + 2] * (1 - k) + blur[i + 2] * k;
    o[i + 3] = s[i + 3];
  }
  const canvas = cloneCanvas(source);
  const cctx = canvas.getContext('2d');
  cctx?.putImageData(out, 0, 0);
  return canvas;
}

export type CollageLayout = 'grid2' | 'grid3' | 'vertical' | 'horizontal';

/** 把源三角形仿射映射到目标三角形（透视校正的基础） */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0: [number, number],
  s1: [number, number],
  s2: [number, number],
  d0: [number, number],
  d1: [number, number],
  d2: [number, number]
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  const denom = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(denom) < 1e-8) {
    ctx.restore();
    return;
  }
  const m11 = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / denom;
  const m12 = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / denom;
  const m21 = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / denom;
  const m22 = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / denom;
  const m31 =
    (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) +
      d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) +
      d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) /
    denom;
  const m32 =
    (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) +
      d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) +
      d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) /
    denom;
  ctx.transform(m11, m12, m21, m22, m31, m32);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** 透视校正：把四角围出的四边形拉直为矩形（一次性烘焙） */
export function bakePerspective(
  source: HTMLCanvasElement,
  corners: [number, number][]
): HTMLCanvasElement {
  const [tl, tr, br, bl] = corners;
  const xs = [tl[0], tr[0], br[0], bl[0]];
  const ys = [tl[1], tr[1], br[1], bl[1]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const outW = Math.max(1, Math.round(maxX - minX));
  const outH = Math.max(1, Math.round(maxY - minY));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;

  const shift = (p: [number, number]): [number, number] => [p[0] - minX, p[1] - minY];
  const sTL = shift(tl);
  const sTR = shift(tr);
  const sBR = shift(br);
  const sBL = shift(bl);
  const dTL: [number, number] = [0, 0];
  const dTR: [number, number] = [outW, 0];
  const dBR: [number, number] = [outW, outH];
  const dBL: [number, number] = [0, outH];

  drawTriangle(ctx, source, sTL, sTR, sBR, dTL, dTR, dBR);
  drawTriangle(ctx, source, sTL, sBR, sBL, dTL, dBR, dBL);
  return canvas;
}

export const DEFAULT_PERSPECTIVE: [number, number][] = [
  [0.06, 0.06],
  [0.94, 0.06],
  [0.94, 0.94],
  [0.06, 0.94]
];

/** 拼图：把多张图合成一张（cover 裁切，保持每格比例） */
export function buildCollage(
  sources: HTMLCanvasElement[],
  layout: CollageLayout,
  targetLongEdge = 1600,
  gap = 12,
  bg = '#ffffff'
): HTMLCanvasElement | null {
  if (sources.length < 2) return null;
  const cols = layout === 'grid2' ? 2 : layout === 'grid3' ? 3 : 1;
  const rows =
    layout === 'vertical'
      ? sources.length
      : layout === 'horizontal'
        ? 1
        : Math.ceil(sources.length / cols);
  const ratio = Math.max(0.3, Math.min(3, sources[0].height / sources[0].width));
  let cellW = Math.round((targetLongEdge - gap * (cols + 1)) / cols);
  let cellH = Math.round((targetLongEdge - gap * (rows + 1)) / rows);
  if (layout === 'vertical') {
    // 竖排：保持首图比例，整体更高
    cellW = targetLongEdge - gap * 2;
    cellH = Math.round(cellW * ratio);
  } else if (layout === 'horizontal') {
    // 横排：保持首图比例，整体更宽
    cellH = targetLongEdge - gap * 2;
    cellW = Math.round(cellH / ratio);
  }
  const outW = cellW * cols + gap * (cols + 1);
  const outH = cellH * rows + gap * (rows + 1);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = 'high';

  sources.slice(0, cols * (layout === 'vertical' ? 1 : rows)).forEach((s, i) => {
    const col = cols === 1 ? 0 : i % cols;
    const row = cols === 1 ? i : Math.floor(i / cols);
    const dx = gap + col * (cellW + gap);
    const dy = gap + row * (cellH + gap);
    // cover 裁切
    const scale = Math.max(cellW / s.width, cellH / s.height);
    const dw = s.width * scale;
    const dh = s.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, cellW, cellH);
    ctx.clip();
    ctx.drawImage(s, dx + (cellW - dw) / 2, dy + (cellH - dh) / 2, dw, dh);
    ctx.restore();
  });
  return canvas;
}

/** 绘制贴纸（内置矢量图形或 emoji） */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  id: string,
  cx: number,
  cy: number,
  size: number,
  color: string
) {
  if (id.startsWith('e:')) {
    ctx.save();
    ctx.font = `${size * 1.1}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id.slice(2), cx, cy);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (id) {
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.22;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'heart': {
      ctx.moveTo(0, 0.42);
      ctx.bezierCurveTo(-0.62, 0.02, -0.44, -0.46, 0, -0.2);
      ctx.bezierCurveTo(0.44, -0.46, 0.62, 0.02, 0, 0.42);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'circle': {
      ctx.arc(0, 0, 0.42, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'badge': {
      ctx.moveTo(-0.44, -0.36);
      ctx.lineTo(0.44, -0.36);
      ctx.quadraticCurveTo(0.5, -0.36, 0.5, -0.3);
      ctx.lineTo(0.5, 0.16);
      ctx.quadraticCurveTo(0.5, 0.22, 0.44, 0.22);
      ctx.lineTo(-0.06, 0.22);
      ctx.lineTo(-0.2, 0.44);
      ctx.lineTo(-0.16, 0.22);
      ctx.lineTo(-0.44, 0.22);
      ctx.quadraticCurveTo(-0.5, 0.22, -0.5, 0.16);
      ctx.lineTo(-0.5, -0.3);
      ctx.quadraticCurveTo(-0.5, -0.36, -0.44, -0.36);
      ctx.fill();
      break;
    }
    case 'check': {
      ctx.moveTo(-0.36, 0.02);
      ctx.lineTo(-0.1, 0.3);
      ctx.lineTo(0.38, -0.3);
      ctx.stroke();
      break;
    }
    case 'cross': {
      ctx.moveTo(-0.3, -0.3);
      ctx.lineTo(0.3, 0.3);
      ctx.moveTo(0.3, -0.3);
      ctx.lineTo(-0.3, 0.3);
      ctx.stroke();
      break;
    }
    case 'crown': {
      ctx.moveTo(-0.46, 0.3);
      ctx.lineTo(-0.36, -0.28);
      ctx.lineTo(-0.12, 0.04);
      ctx.lineTo(0, -0.38);
      ctx.lineTo(0.12, 0.04);
      ctx.lineTo(0.36, -0.28);
      ctx.lineTo(0.46, 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'flame': {
      ctx.moveTo(0, -0.46);
      ctx.bezierCurveTo(0.34, -0.14, 0.4, 0.08, 0.22, 0.3);
      ctx.bezierCurveTo(0.08, 0.46, -0.2, 0.42, -0.28, 0.24);
      ctx.bezierCurveTo(-0.36, 0.06, -0.16, -0.02, -0.08, -0.2);
      ctx.bezierCurveTo(-0.02, -0.32, -0.04, -0.4, 0, -0.46);
      ctx.fill();
      break;
    }
    case 'bolt': {
      ctx.moveTo(0.1, -0.46);
      ctx.lineTo(-0.26, 0.06);
      ctx.lineTo(-0.02, 0.06);
      ctx.lineTo(-0.12, 0.46);
      ctx.lineTo(0.26, -0.08);
      ctx.lineTo(0.02, -0.08);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'arrow': {
      ctx.moveTo(-0.44, 0);
      ctx.lineTo(0.24, 0);
      ctx.moveTo(0.06, -0.26);
      ctx.lineTo(0.42, 0);
      ctx.lineTo(0.06, 0.26);
      ctx.lineWidth = 0.16;
      ctx.stroke();
      break;
    }
    case 'music': {
      ctx.moveTo(0.06, 0.32);
      ctx.arc(0.0, 0.3, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.moveTo(0.16, -0.42);
      ctx.lineTo(0.16, 0.3);
      ctx.lineWidth = 0.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0.16, -0.42);
      ctx.quadraticCurveTo(0.42, -0.36, 0.44, -0.14);
      ctx.quadraticCurveTo(0.3, -0.28, 0.16, -0.24);
      ctx.fill();
      break;
    }
    default: {
      ctx.arc(0, 0, 0.24, 0, Math.PI * 2);
      ctx.fill();
      const rays = 8;
      ctx.lineWidth = 0.1;
      for (let i = 0; i < rays; i++) {
        const a = (Math.PI * 2 * i) / rays;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 0.32, Math.sin(a) * 0.32);
        ctx.lineTo(Math.cos(a) * 0.48, Math.sin(a) * 0.48);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** 生成像素化（马赛克）源图，用于打码笔刷 */
export function buildMosaicSource(source: CanvasImageSource, blocks = 58): HTMLCanvasElement {
  const sw = Number((source as HTMLCanvasElement).width) || 100;
  const sh = Number((source as HTMLCanvasElement).height) || 100;
  const w = Math.max(2, Math.round(blocks));
  const h = Math.max(2, Math.round((blocks * sh) / sw));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
  }
  return canvas;
}

let maskCanvas: HTMLCanvasElement | null = null;
function ensureMaskCanvas(w: number, h: number) {
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (maskCanvas.width !== cw || maskCanvas.height !== ch) {
    maskCanvas.width = cw;
    maskCanvas.height = ch;
  }
  return maskCanvas;
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  width: number,
  height: number,
  lw: number
) {
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, lw / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * width, points[i].y * height);
  }
  ctx.stroke();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16)
  };
}

/** 文字描边色：深色字用白描边，浅色字用深描边 */
function outlineFor(color: string) {
  const rgb = hexToRgb(color);
  if (!rgb) return 'rgba(17,24,39,0.55)';
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.6 ? 'rgba(17,24,39,0.6)' : 'rgba(255,255,255,0.75)';
}

/**
 * 把标注绘制到画布上。坐标原点为图片左上角，
 * width / height 为图片在该画布中的像素尺寸（预览用显示尺寸，导出用位图尺寸）。
 */
function drawTextMark(
  ctx: CanvasRenderingContext2D,
  m: TextMark,
  width: number,
  height: number,
  isDraft: boolean
) {
  const fs = Math.max(6, m.size * width);
  ctx.font = `700 ${fs}px ${FONT_FAMILIES[m.font ?? 'sans']}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lh = Math.max(1, m.lineHeight ?? 1.3) * fs;
  const pad = fs * 0.35;
  const boxed = m.w > 0 && m.h > 0;
  const bx = m.x * width;
  const by = m.y * height;
  const bw = boxed ? m.w * width : 0;
  const bh = boxed ? m.h * height : 0;

  const lines: string[] = [];
  if (boxed) {
    const maxW = Math.max(8, bw - pad * 2);
    for (const para of m.text.split('\n')) {
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (line && ctx.measureText(test).width > maxW) {
          lines.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
  } else {
    lines.push(...m.text.split('\n'));
  }

  const widthOf = (s: string) => ctx.measureText(s).width;
  const textW = Math.max(1, ...lines.map(widthOf));
  const totalH = Math.max(lh, lines.length * lh);
  const align: TextAlignKind = m.align ?? (boxed ? 'center' : 'left');
  const originX = boxed
    ? bx
    : align === 'center'
      ? bx - textW / 2
      : align === 'right'
        ? bx - textW
        : bx;
  const originY = boxed ? by + (bh - totalH) / 2 : by - totalH / 2;

  // 背景色块（标签样式）
  if (m.bg) {
    const p = pad * 1.2;
    const rectX = (boxed ? bx : originX) - p;
    const rectY = originY - p;
    const rectW = (boxed ? bw : textW) + p * 2;
    const rectH = totalH + p * 2;
    ctx.save();
    ctx.fillStyle = m.bg;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(rectX, rectY, rectW, rectH, Math.min(p, rectW / 2, rectH / 2));
      ctx.fill();
    } else {
      ctx.fillRect(rectX, rectY, rectW, rectH);
    }
    ctx.restore();
  }

  ctx.save();
  if (boxed) {
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
  }
  lines.forEach((line, i) => {
    const ly = originY + i * lh + lh / 2;
    const wLine = widthOf(line);
    const lx = boxed
      ? align === 'center'
        ? bx + (bw - wLine) / 2
        : align === 'right'
          ? bx + bw - wLine
          : bx
      : originX;
    if (m.stroke !== false) {
      ctx.lineWidth = Math.max(1.5, fs * 0.16);
      ctx.strokeStyle = outlineFor(m.color);
      ctx.strokeText(line, lx, ly);
    }
    ctx.fillStyle = m.color;
    ctx.fillText(line, lx, ly);
  });
  ctx.restore();

  if (isDraft) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)';
    if (boxed) ctx.strokeRect(bx, by, bw, bh);
    else ctx.strokeRect(originX - pad, originY - pad, textW + pad * 2, totalH + pad * 2);
    ctx.restore();
  }
}

export function paintMarks(
  ctx: CanvasRenderingContext2D,
  marks: Mark[],
  width: number,
  height: number,
  draft?: Mark | null,
  mosaicSource?: CanvasImageSource | null
) {
  const list = draft ? [...marks, draft] : marks;
  for (const m of list) {
    const lw = Math.max(1, m.size * width);
    ctx.save();
    ctx.globalAlpha = clamp(m.opacity, 0, 1);
    ctx.globalCompositeOperation = m.mode === 'eraser' ? 'destination-out' : 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 元素旋转（文本 / 贴纸 / 形状 / 涂层）
    if (
      m.rotation &&
      (m.mode === 'text' ||
        m.mode === 'sticker' ||
        m.mode === 'shape' ||
        m.mode === 'rect' ||
        m.mode === 'photo')
    ) {
      const b = markBounds(m);
      const rcx = (b.x + b.w / 2) * width;
      const rcy = (b.y + b.h / 2) * height;
      ctx.translate(rcx, rcy);
      ctx.rotate((m.rotation * Math.PI) / 180);
      ctx.translate(-rcx, -rcy);
    }

    if (m.mode === 'shape') {
      const x1 = m.x * width;
      const y1 = m.y * height;
      const x2 = (m.x + m.w) * width;
      const y2 = (m.y + m.h) * height;
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      if (m.shape === 'line' || m.shape === 'arrow') {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (m.shape === 'arrow') {
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const head = Math.max(lw * 3.4, 10);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(angle - 0.42), y2 - head * Math.sin(angle - 0.42));
          ctx.lineTo(x2 - head * Math.cos(angle + 0.42), y2 - head * Math.sin(angle + 0.42));
          ctx.closePath();
          ctx.fill();
        }
      } else if (m.shape === 'rectOutline') {
        ctx.rect(x1, y1, x2 - x1, y2 - y1);
        if (m.filled) ctx.fill();
        else ctx.stroke();
      } else {
        ctx.ellipse(
          (x1 + x2) / 2,
          (y1 + y2) / 2,
          Math.abs(x2 - x1) / 2,
          Math.abs(y2 - y1) / 2,
          0,
          0,
          Math.PI * 2
        );
        if (m.filled) ctx.fill();
        else ctx.stroke();
      }
    } else if (m.mode === 'rect') {
      const rx = m.x * width;
      const ry = m.y * height;
      const rw = m.w * width;
      const rh = m.h * height;
      const radius = Math.min(lw / 2, Math.min(rw, rh) / 2);
      ctx.fillStyle = m.color;
      if (typeof ctx.roundRect === 'function' && radius > 0) {
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, radius);
        ctx.fill();
      } else {
        ctx.fillRect(rx, ry, rw, rh);
      }
    } else if (m.mode === 'photo') {
      // 自由图片：按中心绘制，支持水平 / 垂直翻转（旋转由外层统一处理）
      const pw = m.w * width;
      const ph = m.h * height;
      ctx.save();
      ctx.translate(m.x * width, m.y * height);
      ctx.scale(m.flipH ? -1 : 1, m.flipV ? -1 : 1);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(m.src, -pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    } else if (m.mode === 'text') {
      drawTextMark(ctx, m, width, height, draft ? m.id === draft.id : false);
    } else if (m.mode === 'sticker') {
      drawSticker(ctx, m.sticker, m.x * width, m.y * height, m.size * width, m.color);
    } else if (m.mode === 'mosaic') {
      // 用笔迹作为遮罩，填充像素化后的图像（真正的打码效果）
      const mask = ensureMaskCanvas(width, height);
      const mm = mask.getContext('2d');
      if (mm) {
        mm.setTransform(1, 0, 0, 1, 0, 0);
        mm.globalAlpha = 1;
        mm.globalCompositeOperation = 'source-over';
        mm.clearRect(0, 0, mask.width, mask.height);
        mm.lineCap = 'round';
        mm.lineJoin = 'round';
        mm.fillStyle = '#ffffff';
        mm.strokeStyle = '#ffffff';
        mm.lineWidth = lw;
        tracePath(mm, m.points, mask.width, mask.height, lw);
        mm.globalCompositeOperation = 'source-in';
        if (mosaicSource) {
          mm.drawImage(mosaicSource, 0, 0, mask.width, mask.height);
        } else {
          mm.fillStyle = 'rgba(120,120,130,0.85)';
          mm.fillRect(0, 0, mask.width, mask.height);
        }
        ctx.globalAlpha = clamp(m.opacity, 0, 1);
        ctx.drawImage(mask, 0, 0, width, height);
      }
    } else {
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = lw;
      tracePath(ctx, m.points, width, height, lw);
    }
    ctx.restore();
  }
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };
    img.src = url;
  });
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

/** 用于对比/预览缩放的指数插值 —— 平稳趋近目标值 */
export function approach(current: number, target: number, dt: number, speed = 9) {
  const k = 1 - Math.exp(-speed * dt);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0015 ? target : next;
}
