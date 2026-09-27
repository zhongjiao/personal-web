import {
  COMP_COLOR_SPACE,
  COMP_FORMAT,
  COMP_VERSION,
  compImageFile,
  compMaskFile,
  COMP_BLEND_MODES,
  type CompAdjustment,
  type CompBlendMode,
  type CompColorBalanceSettings,
  type CompCurves,
  type CompDocument,
  type CompLayer,
  type CompLayerEffects,
  type CompLevels,
  type CompRgb,
  type CompSampling,
  type CompTransform
} from './comp-format';
import {
  ADJUSTMENT_LABELS,
  createAdjustment,
  SUPPORTED_KINDS,
  type Adjustment,
  type AdjustmentKind
} from './adjustments';
import { emptyEffects, type LayerEffects } from './effects';
import { fromCompShape, fromCompText, toCompShape, toCompText } from './text-shape';
import {
  createCanvas,
  createLayerId,
  maskFromGray,
  type EditorDocument,
  type LayerNode
} from './document';
import { bytesToBlob } from './binary';
import { unzipEntries, zipEntries, type ZipEntry } from './comp-zip';
import { encodeGrayPng, rgbaToGray } from './png';

/**
 * `.comp` 项目包的读写。
 *
 * 线格式（见 `comp-format.ts`）与运行时模型（见 `document.ts`）的差异：
 * - 线格式是**扁平数组 + `parentID`**、同级自下而上、组占连续子树；
 *   运行时是**嵌套树**。这里做双向转换。
 * - 像素一律按 `<图层 id 大写>.png` 命名，蒙版为 `<id 大写>.mask.png`。
 * - 图层图是 RGBA PNG；蒙版必须是 **8-bit 灰度** PNG，所以走 `png.ts` 手写编码。
 *
 * 打包成一个 zip 时，会把所有条目放进 `<项目名>.comp/` 前缀下 ——
 * 用户解压后直接得到桌面版能打开的 `.comp` 文件夹。
 */

export interface CompPackage {
  doc: EditorDocument;
  /** 读到了但做了降级处理的字段（例如非法的混合模式名），交给 UI 提示 */
  warnings: string[];
}

/* ────────────────────────────── 导出 ────────────────────────────── */

interface PendingImage {
  file: string;
  canvas: HTMLCanvasElement;
  /** 蒙版要按 8-bit 灰度编码 */
  gray: boolean;
}

export interface ExportOptions {
  onProgress?: (text: string) => void;
}

async function encodeCanvas(canvas: HTMLCanvasElement, gray: boolean): Promise<Uint8Array> {
  if (!gray) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 编码失败');
    return new Uint8Array(await blob.arrayBuffer());
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法读取蒙版像素');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return encodeGrayPng(
    rgbaToGray(image.data, canvas.width * canvas.height),
    canvas.width,
    canvas.height
  );
}

/** 运行时效果状态 → `.comp` 的 `effects` 记录（字段完全同名，直接深拷贝） */
function toCompEffects(effects: LayerEffects | null): CompLayerEffects | undefined {
  if (!effects) return undefined;
  const out: CompLayerEffects = {};
  if (effects.stroke) out.stroke = structuredClone(effects.stroke);
  if (effects.shadow) out.shadow = structuredClone(effects.shadow);
  if (effects.colorOverlay) out.colorOverlay = structuredClone(effects.colorOverlay);
  if (effects.innerShadow) out.innerShadow = structuredClone(effects.innerShadow);
  if (effects.outerGlow) out.outerGlow = structuredClone(effects.outerGlow);
  if (effects.innerGlow) out.innerGlow = structuredClone(effects.innerGlow);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 运行时调整状态 → `.comp` 的 `adjustment` 记录（含恒等的 levels / curves 块） */
function toCompAdjustment(adj: Adjustment): CompAdjustment {
  return {
    kind: adj.kind,
    hue: adj.hue,
    saturation: adj.saturation,
    lightness: adj.lightness,
    colorize: adj.colorize,
    levels: structuredClone(adj.levels),
    curves: structuredClone(adj.curves),
    colorBalanceSettings: structuredClone(adj.colorBalanceSettings),
    noiseAmount: adj.noiseAmount,
    noiseGaussian: adj.noiseGaussian,
    noiseMonochromatic: adj.noiseMonochromatic,
    noiseSeed: adj.noiseSeed
  };
}

function collectForExport(
  nodes: LayerNode[],
  parentID: string | null,
  out: CompLayer[],
  pending: PendingImage[]
): void {
  for (const layer of nodes) {
    const record: CompLayer = {
      id: layer.id,
      name: layer.name,
      isVisible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode
    };
    if (parentID) record.parentID = parentID;

    if (layer.mask) {
      record.maskFile = compMaskFile(layer.id);
      record.maskEnabled = layer.maskEnabled;
      pending.push({ file: record.maskFile, canvas: layer.mask.gray, gray: true });
    }

    if (layer.kind === 'group') {
      record.isGroup = true;
      const effects = toCompEffects(layer.effects);
      if (effects) record.effects = effects;
      out.push(record);
      // 组是直通（pass-through），占据连续子树
      collectForExport(layer.children, layer.id, out, pending);
      continue;
    }

    if (layer.kind === 'adjustment') {
      // 调整图层没有 imageFile
      record.isGroup = false;
      record.adjustment = toCompAdjustment(layer.adjustment);
      out.push(record);
      continue;
    }

    record.isGroup = false;
    record.transform = {
      origin: [layer.transform.origin[0], layer.transform.origin[1]],
      size: [layer.transform.size[0], layer.transform.size[1]],
      rotation: layer.transform.rotation,
      flipX: layer.transform.flipX,
      flipY: layer.transform.flipY,
      sampling: layer.transform.sampling
    };
    const effects = toCompEffects(layer.effects);
    if (effects) record.effects = effects;
    // 文字 / 形状：PNG 是显示与导出回退，这几条元数据只负责保持可编辑
    if (layer.text) record.text = toCompText(layer.text);
    if (layer.shape) record.shape = toCompShape(layer.shape);
    if (layer.image) {
      record.imageFile = compImageFile(layer.id);
      pending.push({ file: record.imageFile, canvas: layer.image, gray: false });
    }
    out.push(record);
  }
}

/** 把文档打成 `.comp` 的 ZIP 字节 */
export async function buildCompZip(
  doc: EditorDocument,
  options: ExportOptions = {}
): Promise<Blob> {
  const layers: CompLayer[] = [];
  const pending: PendingImage[] = [];
  collectForExport(doc.layers, null, layers, pending);

  const root = `${doc.name.replace(/\.comp$/i, '') || 'project'}.comp/`;
  const entries: ZipEntry[] = [];

  for (let i = 0; i < pending.length; i += 1) {
    options.onProgress?.(`编码图片 ${i + 1}/${pending.length}`);
    entries.push({
      name: `${root}images/${pending[i].file}`,
      data: await encodeCanvas(pending[i].canvas, pending[i].gray)
    });
  }

  const manifest: CompDocument = {
    format: COMP_FORMAT,
    version: COMP_VERSION,
    colorSpace: COMP_COLOR_SPACE,
    documentID: doc.id,
    width: doc.width,
    height: doc.height,
    resolution: doc.resolution,
    ...(doc.activeLayerID ? { activeLayerID: doc.activeLayerID } : {}),
    layers
  };

  options.onProgress?.('打包');
  entries.unshift({
    name: `${root}manifest.json`,
    data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  });

  return bytesToBlob(zipEntries(entries), 'application/zip');
}

/* ────────────────────────────── 导入 ────────────────────────────── */

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normaliseTransform(
  raw: CompTransform | undefined,
  image: HTMLCanvasElement | null
): CompTransform {
  const sampling = raw?.sampling;
  return {
    origin: [num(raw?.origin?.[0], 0), num(raw?.origin?.[1], 0)],
    size: [
      num(raw?.size?.[0], image?.width ?? 1),
      num(raw?.size?.[1], image?.height ?? 1)
    ],
    rotation: num(raw?.rotation, 0),
    flipX: raw?.flipX === true,
    flipY: raw?.flipY === true,
    sampling:
      sampling === 'Nearest' || sampling === 'Smooth' ? (sampling as CompSampling) : 'High quality'
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const normEnabled = (v: boolean | undefined) => v !== false;

/**
 * `.comp` 里的颜色。规格只写了「color」，没写死取值范围，
 * 因此 >1 时按 0–255 解释，否则按 0–1 —— 读别人的文件时不至于整片变白。
 */
function fromCompRgb(raw: unknown, fallback: CompRgb): CompRgb {
  if (!raw || typeof raw !== 'object') return fallback;
  const c = raw as { red?: unknown; green?: unknown; blue?: unknown };
  const r = num(c.red, NaN);
  const g = num(c.green, NaN);
  const b = num(c.blue, NaN);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return fallback;
  const scale = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
  return { red: clamp01(r * scale), green: clamp01(g * scale), blue: clamp01(b * scale) };
}

const BLACK: CompRgb = { red: 0, green: 0, blue: 0 };
const WHITE: CompRgb = { red: 1, green: 1, blue: 1 };

function fromCompEffects(raw: CompLayerEffects | undefined): LayerEffects | null {
  if (!raw) return null;
  const out = emptyEffects();
  if (raw.stroke) {
    out.stroke = {
      enabled: normEnabled(raw.stroke.enabled),
      size: Math.max(0, num(raw.stroke.size, 8)),
      color: fromCompRgb(raw.stroke.color, BLACK),
      opacity: clamp01(num(raw.stroke.opacity, 1)),
      inside: raw.stroke.inside === true
    };
  }
  if (raw.shadow) {
    out.shadow = {
      enabled: normEnabled(raw.shadow.enabled),
      angle: num(raw.shadow.angle, 315),
      distance: num(raw.shadow.distance, 12),
      blur: Math.max(0, num(raw.shadow.blur, 16)),
      color: fromCompRgb(raw.shadow.color, BLACK),
      opacity: clamp01(num(raw.shadow.opacity, 0.6))
    };
  }
  if (raw.colorOverlay) {
    out.colorOverlay = {
      enabled: normEnabled(raw.colorOverlay.enabled),
      color: fromCompRgb(raw.colorOverlay.color, BLACK),
      opacity: clamp01(num(raw.colorOverlay.opacity, 1))
    };
  }
  if (raw.innerShadow) {
    out.innerShadow = {
      enabled: normEnabled(raw.innerShadow.enabled),
      angle: num(raw.innerShadow.angle, 315),
      distance: num(raw.innerShadow.distance, 8),
      blur: Math.max(0, num(raw.innerShadow.blur, 12)),
      color: fromCompRgb(raw.innerShadow.color, BLACK),
      opacity: clamp01(num(raw.innerShadow.opacity, 0.6))
    };
  }
  if (raw.outerGlow) {
    out.outerGlow = {
      enabled: normEnabled(raw.outerGlow.enabled),
      size: Math.max(0, num(raw.outerGlow.size, 18)),
      color: fromCompRgb(raw.outerGlow.color, WHITE),
      opacity: clamp01(num(raw.outerGlow.opacity, 0.9))
    };
  }
  if (raw.innerGlow) {
    out.innerGlow = {
      enabled: normEnabled(raw.innerGlow.enabled),
      size: Math.max(0, num(raw.innerGlow.size, 14)),
      color: fromCompRgb(raw.innerGlow.color, WHITE),
      opacity: clamp01(num(raw.innerGlow.opacity, 0.8))
    };
  }
  return out;
}

function normaliseLevels(raw: CompLevels | undefined, fallback: CompLevels): CompLevels {
  if (!raw || !Array.isArray(raw.ranges) || raw.ranges.length < 4) return fallback;
  return {
    channel: 'RGB',
    ranges: raw.ranges.slice(0, 4).map((range, index) => ({
      black: num(range?.black, fallback.ranges[index].black),
      gamma: Math.max(0.01, num(range?.gamma, fallback.ranges[index].gamma)),
      white: num(range?.white, fallback.ranges[index].white),
      outputBlack: num(range?.outputBlack, fallback.ranges[index].outputBlack),
      outputWhite: num(range?.outputWhite, fallback.ranges[index].outputWhite)
    }))
  };
}

function normaliseCurves(raw: CompCurves | undefined, fallback: CompCurves): CompCurves {
  if (!raw || !Array.isArray(raw.channels) || raw.channels.length < 4) return fallback;
  return {
    channel: 'RGB',
    channels: raw.channels.slice(0, 4).map((points, index) => {
      if (!Array.isArray(points) || points.length < 2) return fallback.channels[index];
      const clean = points
        .map((p) => ({ x: Math.round(num(p?.x, 0)), y: Math.round(num(p?.y, 0)) }))
        .filter((p) => p.x >= 0 && p.x <= 255)
        .sort((a, b) => a.x - b.x);
      return clean.length >= 2 ? clean : fallback.channels[index];
    })
  };
}

function normaliseColorBalance(
  raw: CompColorBalanceSettings | undefined,
  fallback: CompColorBalanceSettings
): CompColorBalanceSettings {
  if (!raw || typeof raw !== 'object') return fallback;
  const pick = (key: keyof CompColorBalanceSettings): number =>
    typeof raw[key] === 'number' ? (raw[key] as number) : (fallback[key] as number);
  return {
    shadowCyanRed: pick('shadowCyanRed'),
    shadowMagentaGreen: pick('shadowMagentaGreen'),
    shadowYellowBlue: pick('shadowYellowBlue'),
    midtoneCyanRed: pick('midtoneCyanRed'),
    midtoneMagentaGreen: pick('midtoneMagentaGreen'),
    midtoneYellowBlue: pick('midtoneYellowBlue'),
    highlightCyanRed: pick('highlightCyanRed'),
    highlightMagentaGreen: pick('highlightMagentaGreen'),
    highlightYellowBlue: pick('highlightYellowBlue'),
    preserveLuminosity: raw.preserveLuminosity !== false
  };
}

/** 不支持的 `kind` 返回 null，由调用方跳过并给出提示 */
function fromCompAdjustment(raw: CompAdjustment): Adjustment | null {
  if (!(SUPPORTED_KINDS as readonly string[]).includes(raw.kind)) return null;
  const kind = raw.kind as AdjustmentKind;
  const base = createAdjustment(kind);
  return {
    ...base,
    hue: num(raw.hue, base.hue),
    saturation: num(raw.saturation, base.saturation),
    lightness: num(raw.lightness, base.lightness),
    colorize: raw.colorize === true,
    levels: normaliseLevels(raw.levels, base.levels),
    curves: normaliseCurves(raw.curves, base.curves),
    colorBalanceSettings: normaliseColorBalance(
      raw.colorBalanceSettings as CompColorBalanceSettings | undefined,
      base.colorBalanceSettings
    ),
    noiseAmount: num(raw.noiseAmount, base.noiseAmount),
    noiseGaussian: raw.noiseGaussian === true,
    noiseMonochromatic: raw.noiseMonochromatic !== false,
    noiseSeed: num(raw.noiseSeed, base.noiseSeed)
  };
}

async function decodePng(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(bytesToBlob(bytes, 'image/png'));
  } catch {
    throw new Error('图片资源解码失败（可能不是 PNG）');
  }
  const { canvas, ctx } = createCanvas(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/**
 * 把一组「相对路径 → 字节」当作 `.comp` 包解析。
 * 兼容「zip 里又套了一层文件夹」的情况（自动找 manifest.json 所在的前缀）。
 *
 * @param name 项目名（通常来自文件名），仅用于展示
 */
export async function loadCompPackage(
  files: Map<string, Uint8Array>,
  name = '导入的.comp'
): Promise<CompPackage> {
  const warnings: string[] = [];

  const manifestKey = [...files.keys()].find((key) => key.endsWith('manifest.json'));
  if (!manifestKey) throw new Error('包里没有 manifest.json，不是 .comp 项目');
  const root = manifestKey.slice(0, manifestKey.length - 'manifest.json'.length);

  let manifest: CompDocument;
  try {
    manifest = JSON.parse(new TextDecoder().decode(files.get(manifestKey) as Uint8Array)) as CompDocument;
  } catch {
    throw new Error('manifest.json 不是合法 JSON');
  }

  if (manifest.format !== COMP_FORMAT) {
    throw new Error(`不是 Compositor 项目（format = ${String(manifest.format)}）`);
  }
  if (!(manifest.version <= COMP_VERSION)) {
    throw new Error(`项目格式版本 v${manifest.version} 高于本工具支持的 v${COMP_VERSION}`);
  }
  if (!(num(manifest.width, 0) > 0) || !(num(manifest.height, 0) > 0)) {
    throw new Error('manifest.json 里的画布尺寸不合法');
  }
  if (!Array.isArray(manifest.layers)) throw new Error('manifest.json 缺少 layers');

  // 资源解码（同一文件名只解一次）
  const decoded = new Map<string, HTMLCanvasElement>();
  for (const record of manifest.layers) {
    for (const file of [record.imageFile, record.maskFile]) {
      if (!file || decoded.has(file)) continue;
      const bytes = files.get(`${root}images/${file}`) ?? files.get(`${root}${file}`);
      // 规格要求：manifest 里列出的每个图层，其图片都必须存在
      if (!bytes) throw new Error(`缺少图片资源 images/${file}`);
      decoded.set(file, await decodePng(bytes));
    }
  }

  // 扁平 + parentID → 嵌套树
  const byId = new Map<string, LayerNode>();
  const skippedAdjustments: string[] = [];

  for (const record of manifest.layers) {
    if (!record.id) throw new Error('存在缺少 id 的图层记录');
    if (byId.has(record.id)) throw new Error(`图层 id 重复：${record.id}`);

    const maskCanvas = record.maskFile ? decoded.get(record.maskFile) ?? null : null;
    let blendMode: CompBlendMode = 'Normal';
    if (record.blendMode) {
      if ((COMP_BLEND_MODES as readonly string[]).includes(record.blendMode)) {
        blendMode = record.blendMode;
      } else {
        warnings.push(`图层「${record.name ?? record.id}」的混合模式 ${record.blendMode} 无法识别，已按正常处理`);
      }
    }

    const common = {
      id: record.id,
      name: typeof record.name === 'string' && record.name ? record.name : '未命名图层',
      visible: record.isVisible !== false,
      opacity: Math.min(1, Math.max(0, num(record.opacity, 1))),
      blendMode,
      mask: maskCanvas ? maskFromGray(maskCanvas, false) : null,
      maskEnabled: record.maskEnabled !== false
    };

    if (record.adjustment) {
      const adjustment = fromCompAdjustment(record.adjustment);
      if (!adjustment) {
        // 这类调整没有像素可以降级承载，只能整层跳过
        skippedAdjustments.push(
          `${common.name}（${ADJUSTMENT_LABELS[record.adjustment.kind] ?? String(record.adjustment.kind)}）`
        );
        continue;
      }
      byId.set(record.id, { ...common, kind: 'adjustment', adjustment });
      continue;
    }

    if (record.isGroup) {
      byId.set(record.id, {
        ...common,
        kind: 'group',
        children: [],
        expanded: true,
        effects: fromCompEffects(record.effects)
      });
    } else {
      const image = record.imageFile ? decoded.get(record.imageFile) ?? null : null;
      byId.set(record.id, {
        ...common,
        kind: 'raster',
        image,
        effects: fromCompEffects(record.effects),
        // 文字 / 形状的元数据只影响「可编辑性」，像素一律以 PNG 为准
        text: record.text ? fromCompText(record.text) : null,
        shape: record.shape ? fromCompShape(record.shape) : null,
        transform: normaliseTransform(record.transform, image)
      });
    }
  }

  const roots: LayerNode[] = [];
  for (const record of manifest.layers) {
    const node = byId.get(record.id);
    if (!node) continue;
    if (record.parentID) {
      const parent = byId.get(record.parentID);
      if (!parent || parent.kind !== 'group') {
        throw new Error(`图层「${record.name ?? record.id}」的父级 ${record.parentID} 不是图层组`);
      }
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  if (roots.length === 0) throw new Error('项目里没有任何顶层图层');

  if (skippedAdjustments.length > 0) {
    const shown = skippedAdjustments.slice(0, 3).join('、');
    const more = skippedAdjustments.length > 3 ? ` 等 ${skippedAdjustments.length} 个` : '';
    warnings.push(`已跳过尚未支持的调整图层：${shown}${more}`);
  }
  if (manifest.guides?.length) warnings.push(`参考线（${manifest.guides.length} 条）尚未支持，已忽略`);

  const activeLayerID =
    manifest.activeLayerID && byId.has(manifest.activeLayerID)
      ? manifest.activeLayerID
      : roots[roots.length - 1].id;

  return {
    doc: {
      id: manifest.documentID || createLayerId(),
      name,
      width: Math.round(manifest.width),
      height: Math.round(manifest.height),
      resolution: num(manifest.resolution, 72),
      layers: roots,
      activeLayerID,
      dirty: 'all',
      // 选区是会话状态，规范里不序列化
      selection: null
    },
    warnings
  };
}

/** 从 `.comp` 的 ZIP 字节导入 */
export async function importCompZip(
  bytes: Uint8Array,
  name?: string
): Promise<CompPackage> {
  return loadCompPackage(await unzipEntries(bytes), name);
}
