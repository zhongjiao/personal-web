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
  invert: 0
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
  quality: number
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
