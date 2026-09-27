/**
 * `.comp` 文档格式（`com.compositor.project`）—— 与桌面版 Compositor 互通的数据契约。
 *
 * 硬性结构（速查）：
 * ```
 * Example.comp/
 * ├── manifest.json                        # 下面 CompDocument 的 JSON 形式
 * └── images/
 *     ├── <LAYER_ID 大写>.png              # 图层像素，8-bit RGBA
 *     └── <LAYER_ID 大写>.mask.png         # 可选蒙版，8-bit 灰度（白显黑隐）
 * ```
 *
 * 写入侧两条铁律（否则桌面版会整包静默拒收、不做任何提示）：
 * 1. 先写 `images/` 里的 PNG，再把 manifest 写临时文件并 **原子 rename** 覆盖 `manifest.json`；
 * 2. `blendMode` 拼写必须与 `COMP_BLEND_MODES` 逐字一致，`imageFile` 必须由图层 `id` 大写派生。
 *
 * 依据：桌面版仓库 `docs/writing-comp-files.md` 与 `docs/project-format.md`（格式版本 1 → 10）。
 *
 * TODO(骨架阶段)：以下字段名/取值来自官方文档的文字描述，尚未用真实 `.comp` 文件逐字段校对
 * （尤其 `effects.*.color`、`guides.axis` 的编码）。做 reader/writer 时需用桌面版导出的样本回归。
 */

/** manifest 顶层格式标识，固定值 */
export const COMP_FORMAT = 'com.compositor.project';

/** 当前写入的格式版本（1–9 仍可读，10 起支持文字 `colorRuns`） */
export const COMP_VERSION = 10;

/** 桌面版支持的色彩空间（仅 sRGB，无 CMYK） */
export const COMP_COLOR_SPACE = 'sRGB';

/** 混合模式全清单：拼写必须逐字精确 */
export const COMP_BLEND_MODES = [
  'Normal',
  'Darken',
  'Multiply',
  'Color Burn',
  'Linear Burn',
  'Lighten',
  'Screen',
  'Color Dodge',
  'Linear Dodge (Add)',
  'Overlay',
  'Soft Light',
  'Hard Light',
  'Vivid Light',
  'Linear Light',
  'Pin Light',
  'Hard Mix',
  'Difference',
  'Exclusion',
  'Subtract',
  'Divide',
  'Hue',
  'Saturation',
  'Color',
  'Luminosity'
] as const;

export type CompBlendMode = (typeof COMP_BLEND_MODES)[number];

/** 调整图层类型（v7 起 9 种，v9 增加 3 种邻域算子） */
export const COMP_ADJUSTMENT_KINDS = [
  'Hue/Saturation',
  'Levels',
  'Curves',
  'Exposure',
  'Gradient Map',
  'Grain',
  'Invert',
  'Black & White',
  'Color Balance',
  'Gaussian Blur',
  'Motion Blur',
  'Add Noise'
] as const;

export type CompAdjustmentKind = (typeof COMP_ADJUSTMENT_KINDS)[number];

/** 重采样方式，仅此三种取值 */
export type CompSampling = 'High quality' | 'Smooth' | 'Nearest';

/** 0–1 的浮点分量（各通道） */
export interface CompRgb {
  red: number;
  green: number;
  blue: number;
}

/**
 * 图层变换，单位均为文档像素；像素与元数据分离存储，
 * 因此移动/删除源图后项目依然可用（非破坏性变换的基础）。
 */
export interface CompTransform {
  /** 图层左上角坐标 `[x, y]` */
  origin: [number, number];
  /** 图层宽高 `[w, h]`，图像会被拉伸到该尺寸 */
  size: [number, number];
  /** 顺时针旋转角度（度） */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  sampling: CompSampling;
}

/** 图层效果（v4+），每项可选、彼此独立；`enabled` 缺失视为可见 */
export interface CompLayerEffects {
  stroke?: { size: number; color: CompRgb; opacity: number; inside: boolean; enabled?: boolean };
  shadow?: { angle: number; distance: number; blur: number; color: CompRgb; opacity: number; enabled?: boolean };
  colorOverlay?: { color: CompRgb; opacity: number; enabled?: boolean };
  innerShadow?: { angle: number; distance: number; blur: number; color: CompRgb; opacity: number; enabled?: boolean };
  outerGlow?: { size: number; color: CompRgb; opacity: number; enabled?: boolean };
  innerGlow?: { size: number; color: CompRgb; opacity: number; enabled?: boolean };
}

/** 色阶：`ranges` 按 RGB → 红 → 绿 → 蓝 排列 */
export interface CompLevels {
  channel: string;
  ranges: { black: number; gamma: number; white: number; outputBlack: number; outputWhite: number }[];
}

/** 曲线：`channels` 按 RGB → 红 → 绿 → 蓝 排列，点 x 递增且落在 0–255 */
export interface CompCurves {
  channel: string;
  channels: { x: number; y: number }[][];
}

/** 色彩平衡设置，各分量取值 −100 – 100 */
export interface CompColorBalanceSettings {
  shadowCyanRed: number;
  shadowMagentaGreen: number;
  shadowYellowBlue: number;
  midtoneCyanRed: number;
  midtoneMagentaGreen: number;
  midtoneYellowBlue: number;
  highlightCyanRed: number;
  highlightMagentaGreen: number;
  highlightYellowBlue: number;
  preserveLuminosity: boolean;
}

/**
 * 调整图层（v7+）。
 *
 * 该图层**没有** `imageFile`，作用于其下方所有内容；且不能是组、不能带 `text`。
 * 每种类型都自带恒等的 `levels` / `curves` 块，外加各自专属设置。
 *
 * 最省事的取值办法：在桌面版里加一个调整图层、保存，然后从该项目的 manifest 里抄结构。
 */
export interface CompAdjustment {
  kind: CompAdjustmentKind;
  /* Hue/Saturation 专属（也作为其它类型的恒等值出现） */
  hue: number;
  saturation: number;
  lightness: number;
  colorize: boolean;
  /* 恒等块 */
  levels: CompLevels;
  curves: CompCurves;
  /* Curves / Levels 之外的类型专属字段（Gradient Map、Grain、Exposure、Add Noise…） */
  [key: string]: unknown;
}

/** 可编辑形状样式；其 PNG 仍是普通栅格，像素被破坏性操作后元数据即丢弃 */
export interface CompShape {
  kind: string;
  red: number;
  green: number;
  blue: number;
  /** 圆角半径，文档像素 */
  cornerRadius: number;
  /** 仅线条类形状 */
  lineWidth?: number;
  start?: [number, number];
  end?: [number, number];
}

/** 文字段落中一段同色区间（v10+），`location`/`length` 以 UTF-16 计 */
export interface CompColorRun {
  location: number;
  length: number;
  red: number;
  green: number;
  blue: number;
}

/** 可编辑文字（非破坏性元数据，PNG 仅为显示与导出回退） */
export interface CompText {
  content: string;
  /** PostScript 字体名 */
  font: string;
  /** 字号，px */
  size: number;
  red: number;
  green: number;
  blue: number;
  alignment: string;
  tracking: number;
  lineHeight: number;
  /** 段落框边界；修改边界是重排而非缩放字号 */
  boxSize?: [number, number];
  /** v10+：文字图层中部分字母使用不同颜色 */
  colorRuns?: CompColorRun[];
}

/**
 * 单条图层记录。
 *
 * 图层组（`isGroup: true`）没有图像文件，靠子图层的 `parentID` 反向引用构成连续子树；
 * `layers` 数组顺序即**同级自下而上**顺序（数组最后一个画在最上层）。
 */
export interface CompLayer {
  /** 全项目唯一 UUID，同时决定 `imageFile` 的文件名 */
  id: string;
  name: string;
  /** 必须为 `<id 大写>.png`；空白图层 / 组 / 调整图层没有该字段 */
  imageFile?: string;
  isVisible: boolean;
  isGroup?: boolean;
  /** 所属图层组 id（v2+） */
  parentID?: string;
  /** 0–1，缺失默认全不透明 */
  opacity?: number;
  /** 缺失默认 `Normal`；组为直通（pass-through），v8 起才允许自带 opacity */
  blendMode?: CompBlendMode;
  transform?: CompTransform;
  /** 必须为 `<id 大写>.mask.png`，8-bit 灰度、无 Alpha，白显黑隐（v4+） */
  maskFile?: string;
  maskEnabled?: boolean;
  /** 剪切蒙版的实时 Alpha 链接来源图层 id（v5+），链长 ≤ 256 */
  maskSourceID?: string;
  /** 不链接的蒙版保留自身文档空间矩形 */
  maskPlacement?: unknown;
  maskLinked?: boolean;
  /** 出现即表示调整图层（此时没有 `imageFile`） */
  adjustment?: CompAdjustment;
  effects?: CompLayerEffects;
  shape?: CompShape;
  text?: CompText;
}

/** 参考线（v8+） */
export interface CompGuide {
  id: string;
  /** TODO：文档未给出取值枚举，待用真实样本校对 */
  axis: string;
  position: number;
}

/** `manifest.json` 的完整形态 */
export interface CompDocument {
  format: typeof COMP_FORMAT;
  version: number;
  colorSpace: typeof COMP_COLOR_SPACE;
  /** 编辑既有项目时必须原样保留 */
  documentID: string;
  width: number;
  height: number;
  /** 每英寸像素，1–9600，缺失默认 72 */
  resolution?: number;
  activeLayerID?: string;
  /** 自下而上排列 */
  layers: CompLayer[];
  guides?: CompGuide[];
}

/** 全局限制（超出即拒绝保存 / 打开） */
export const COMP_LIMITS = {
  /** 画布与图像单边上限（px）—— 浏览器无法企及，Web 侧需另设更保守的预算 */
  maxCanvasSide: 30_000,
  /** 源像素总量 */
  maxSourcePixels: 100_000_000,
  /** 蒙版像素（额外额度） */
  maxMaskPixels: 100_000_000,
  maxLayers: 10_000,
  /** manifest.json 体积上限 */
  maxManifestBytes: 4 * 1024 * 1024,
  /** 单个编码资源（PNG）体积上限 */
  maxEncodedAssetBytes: 512 * 1024 * 1024,
  /** 图层组最大嵌套深度 */
  maxGroupNesting: 64,
  maxGuides: 1000,
  /** 剪切蒙版链最大节点数 */
  maxClipChain: 256
} as const;

/** 由图层 id 推导像素文件名（必须大写），桌面版按此规则查找资源 */
export const compImageFile = (id: string) => `${id.toUpperCase()}.png`;

/** 由图层 id 推导蒙版文件名（必须大写） */
export const compMaskFile = (id: string) => `${id.toUpperCase()}.mask.png`;
