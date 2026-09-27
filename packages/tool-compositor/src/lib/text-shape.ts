import type { CompRgb, CompShape, CompText } from './comp-format';
import { createCanvas, createRasterLayer, type RasterLayer } from './document';

/**
 * 文字图层与形状图层。
 *
 * 按 `.comp` 的定义，它们是**带元数据的栅格图层**：PNG 始终是显示与导出的回退，
 * 元数据（`text` / `shape`）只是让内容保持可编辑。破坏性像素操作会让元数据失效，
 * 因此这里所有编辑都走「改元数据 → 重新渲染 PNG」这一条路。
 */

export interface TextState {
  content: string;
  /** PostScript 字体名，写入 `.comp` 的就是它 */
  font: string;
  /** 字号，px */
  size: number;
  color: CompRgb;
  alignment: 'left' | 'center' | 'right';
  /** 字距，px */
  tracking: number;
  /** 行距倍数 */
  lineHeight: number;
  /** 段落框宽度；null 表示按最长行自适应 */
  boxWidth: number | null;
}

export type ShapeKind = 'rect' | 'roundedRect' | 'ellipse' | 'line';

export interface ShapeState {
  kind: ShapeKind;
  color: CompRgb;
  /** 圆角半径，文档像素 */
  cornerRadius: number;
  /** 线条宽度 */
  lineWidth: number;
  /** 线条端点，按图层框的比例（0–1） */
  start: [number, number];
  end: [number, number];
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: '矩形',
  roundedRect: '圆角矩形',
  ellipse: '椭圆',
  line: '直线'
};

/** PostScript 字体名 ↔ 本机可用的 CSS 字体栈 */
export const FONT_OPTIONS = [
  {
    name: 'Helvetica',
    label: '无衬线',
    css: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  },
  { name: 'Times-Roman', label: '衬线', css: 'Georgia, "Times New Roman", "Songti SC", serif' },
  { name: 'Courier', label: '等宽', css: 'Consolas, "Courier New", monospace' },
  {
    name: 'PingFang-SC',
    label: '中文黑体',
    css: '"PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif'
  }
];

export const fontCss = (name: string): string =>
  FONT_OPTIONS.find((option) => option.name === name)?.css ?? FONT_OPTIONS[0].css;

export const createTextState = (): TextState => ({
  content: '双击右侧输入文字',
  font: 'Helvetica',
  size: 96,
  color: { red: 1, green: 1, blue: 1 },
  alignment: 'left',
  tracking: 0,
  lineHeight: 1.25,
  boxWidth: null
});

export const createShapeState = (kind: ShapeKind): ShapeState => ({
  kind,
  color: { red: 0.31, green: 0.43, blue: 0.96 },
  cornerRadius: 24,
  lineWidth: 12,
  start: [0, 0],
  end: [1, 1]
});

export const cloneTextState = (state: TextState): TextState => ({
  ...state,
  color: { ...state.color }
});

export const cloneShapeState = (state: ShapeState): ShapeState => ({
  ...state,
  color: { ...state.color },
  start: [state.start[0], state.start[1]],
  end: [state.end[0], state.end[1]]
});

/* ────────────────────────────── 文字渲染 ────────────────────────────── */

const rgbCss = (color: CompRgb, alpha = 1): string =>
  `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(
    color.blue * 255
  )}, ${alpha})`;

const fontSpec = (state: TextState): string => `${state.size}px ${fontCss(state.font)}`;

/** 逐字符累加宽度，与渲染时的推进方式保持一致 */
function advance(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  let width = 0;
  for (const ch of text) width += ctx.measureText(ch).width + tracking;
  return Math.max(0, width - tracking);
}

/** 按显式换行与段落框宽度切行 */
function layoutLines(state: TextState, ctx: CanvasRenderingContext2D): string[] {
  const lines: string[] = [];
  for (const paragraph of state.content.split('\n')) {
    if (!state.boxWidth || state.boxWidth <= 0) {
      lines.push(paragraph);
      continue;
    }
    let current = '';
    for (const ch of paragraph) {
      const candidate = current + ch;
      if (current && advance(ctx, candidate, state.tracking) > state.boxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

export function renderText(state: TextState): HTMLCanvasElement {
  const probe = createCanvas(8, 8);
  probe.ctx.font = fontSpec(state);
  const lines = layoutLines(state, probe.ctx);

  const widest = Math.max(1, ...lines.map((line) => advance(probe.ctx, line, state.tracking)));
  const width = Math.ceil(state.boxWidth && state.boxWidth > 0 ? state.boxWidth : widest);
  const lineHeight = state.size * state.lineHeight;
  const height = Math.ceil(Math.max(1, lines.length * lineHeight));

  const { canvas, ctx } = createCanvas(width, height);
  ctx.font = fontSpec(state);
  ctx.fillStyle = rgbCss(state.color);
  ctx.textBaseline = 'top';

  lines.forEach((line, index) => {
    const lineWidth = advance(ctx, line, state.tracking);
    let cursor =
      state.alignment === 'center'
        ? (canvas.width - lineWidth) / 2
        : state.alignment === 'right'
          ? canvas.width - lineWidth
          : 0;
    const y = index * lineHeight + (lineHeight - state.size) / 2;
    for (const ch of line) {
      ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + state.tracking;
    }
  });

  return canvas;
}

/* ────────────────────────────── 形状渲染 ────────────────────────────── */

export function renderShape(state: ShapeState, width: number, height: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const { canvas, ctx } = createCanvas(w, h);
  ctx.fillStyle = rgbCss(state.color);
  ctx.strokeStyle = rgbCss(state.color);

  switch (state.kind) {
    case 'rect':
      ctx.fillRect(0, 0, w, h);
      break;
    case 'roundedRect': {
      const radius = Math.max(0, Math.min(state.cornerRadius, Math.min(w, h) / 2));
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(w - radius, 0);
      ctx.arcTo(w, 0, w, radius, radius);
      ctx.lineTo(w, h - radius);
      ctx.arcTo(w, h, w - radius, h, radius);
      ctx.lineTo(radius, h);
      ctx.arcTo(0, h, 0, h - radius, radius);
      ctx.lineTo(0, radius);
      ctx.arcTo(0, 0, radius, 0, radius);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'line': {
      ctx.lineWidth = Math.max(1, state.lineWidth);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(state.start[0] * w, state.start[1] * h);
      ctx.lineTo(state.end[0] * w, state.end[1] * h);
      ctx.stroke();
      break;
    }
  }
  return canvas;
}

/**
 * 按元数据重渲染图层的 PNG。
 * 文字尺寸变化时会跟着改图层框，否则用户改了字号却看不到变化。
 */
export function rerenderLayerContent(layer: RasterLayer): void {
  if (layer.text) {
    const canvas = renderText(layer.text);
    layer.image = canvas;
    layer.transform.size = [canvas.width, canvas.height];
    return;
  }
  if (layer.shape) {
    const [w, h] = layer.transform.size;
    layer.image = renderShape(layer.shape, w, h);
  }
}

/* ────────────────────────────── 图层构造 ────────────────────────────── */

/** 在文档中央新建文字图层 */
export function createTextLayer(center: [number, number]): RasterLayer {
  const state = createTextState();
  const canvas = renderText(state);
  const layer = createRasterLayer({
    name: '文字',
    image: canvas,
    origin: [
      Math.round(center[0] - canvas.width / 2),
      Math.round(center[1] - canvas.height / 2)
    ],
    size: [canvas.width, canvas.height]
  });
  layer.text = state;
  return layer;
}

/** 在文档中央新建形状图层 */
export function createShapeLayer(
  kind: ShapeKind,
  width: number,
  height: number,
  center: [number, number]
): RasterLayer {
  const state = createShapeState(kind);
  const canvas = renderShape(state, width, height);
  const layer = createRasterLayer({
    name: SHAPE_LABELS[kind],
    image: canvas,
    origin: [
      Math.round(center[0] - canvas.width / 2),
      Math.round(center[1] - canvas.height / 2)
    ],
    size: [canvas.width, canvas.height]
  });
  layer.shape = state;
  return layer;
}

/* ────────────────────────────── `.comp` 映射 ────────────────────────────── */

export function toCompText(state: TextState): CompText {
  return {
    content: state.content,
    font: state.font,
    size: state.size,
    red: state.color.red,
    green: state.color.green,
    blue: state.color.blue,
    alignment: state.alignment,
    tracking: state.tracking,
    lineHeight: state.lineHeight,
    ...(state.boxWidth ? { boxSize: [state.boxWidth, 0] as [number, number] } : {})
  };
}

export function toCompShape(state: ShapeState): CompShape {
  return {
    kind: state.kind,
    red: state.color.red,
    green: state.color.green,
    blue: state.color.blue,
    cornerRadius: state.cornerRadius,
    ...(state.kind === 'line'
      ? { lineWidth: state.lineWidth, start: [...state.start], end: [...state.end] }
      : {})
  } as CompShape;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 与效果颜色同样的容错：>1 时按 0–255 解释 */
function rgbFrom(raw: { red?: unknown; green?: unknown; blue?: unknown }, fallback: CompRgb): CompRgb {
  const r = num(raw.red, NaN);
  const g = num(raw.green, NaN);
  const b = num(raw.blue, NaN);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return fallback;
  const scale = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
  return { red: clamp01(r * scale), green: clamp01(g * scale), blue: clamp01(b * scale) };
}

export function fromCompText(raw: CompText): TextState {
  const base = createTextState();
  const alignment = raw.alignment;
  return {
    content: typeof raw.content === 'string' ? raw.content : base.content,
    font: typeof raw.font === 'string' && raw.font ? raw.font : base.font,
    size: Math.max(1, num(raw.size, base.size)),
    color: rgbFrom(raw, base.color),
    alignment: alignment === 'center' || alignment === 'right' ? alignment : 'left',
    tracking: num(raw.tracking, base.tracking),
    lineHeight: Math.max(0.5, num(raw.lineHeight, base.lineHeight)),
    boxWidth: raw.boxSize && raw.boxSize[0] > 0 ? raw.boxSize[0] : null
  };
}

export function fromCompShape(raw: CompShape): ShapeState {
  const kind: ShapeKind =
    raw.kind === 'roundedRect' || raw.kind === 'ellipse' || raw.kind === 'line'
      ? raw.kind
      : 'rect';
  const base = createShapeState(kind);
  return {
    kind,
    color: rgbFrom(raw, base.color),
    cornerRadius: num(raw.cornerRadius, base.cornerRadius),
    lineWidth: Math.max(1, num(raw.lineWidth, base.lineWidth)),
    start: [num(raw.start?.[0], 0), num(raw.start?.[1], 0)],
    end: [num(raw.end?.[0], 1), num(raw.end?.[1], 1)]
  };
}
