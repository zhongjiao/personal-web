import type { CompBlendMode, CompTransform } from './comp-format';
import { maskFromGray, type EditorDocument, type LayerNode, type LayerMask } from './document';
import type { Adjustment } from './adjustments';
import type { LayerEffects } from './effects';
import type { ShapeState, TextState } from './text-shape';

/**
 * 撤销 / 重做。
 *
 * 采用**线性快照历史**（`entries[i]` 是一个状态，`index` 指向当前状态），
 * 但快照只保存图层树的**元数据**，像素画布一律共享引用：
 * 只有某张蒙版真的要被就地改写时，才借 `ownMaskGray` 复制一次（写时复制）。
 *
 * 这样一步操作的内存开销 ≈ 图层树元数据大小；只有「涂过的蒙版」才会额外占一份像素。
 * 历史总量超过 `byteLimit` 时从最旧的一端丢弃。
 *
 * 一次拖拽（涂抹 / 移动图层）会触发几十次改动，用 `beginTransaction` /
 * `endTransaction` 把它合并成**一步**撤销。
 */

interface SnapshotBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: CompBlendMode;
  maskEnabled: boolean;
  /** 共享引用；被就地改写前由 `ownMaskGray` 复制 */
  maskGray: HTMLCanvasElement | null;
  expanded: boolean;
}

interface RasterSnapshot extends SnapshotBase {
  kind: 'raster';
  image: HTMLCanvasElement | null;
  transform: CompTransform;
  effects: LayerEffects | null;
  text: TextState | null;
  shape: ShapeState | null;
}

interface GroupSnapshot extends SnapshotBase {
  kind: 'group';
  children: LayerSnapshot[];
  effects: LayerEffects | null;
}

interface AdjustmentSnapshot extends SnapshotBase {
  kind: 'adjustment';
  adjustment: Adjustment;
}

type LayerSnapshot = RasterSnapshot | GroupSnapshot | AdjustmentSnapshot;

export interface DocumentSnapshot {
  /** 画布尺寸必须进快照 —— 裁剪会改它，否则撤销回不到裁剪前 */
  width: number;
  height: number;
  name: string;
  resolution: number;
  activeLayerID: string | null;
  layers: LayerSnapshot[];
  /** 选区按引用保存：选区操作每次都产出新画布，不会污染快照 */
  selection: HTMLCanvasElement | null;
}

export interface History {
  entries: DocumentSnapshot[];
  index: number;
  /** 最多保留多少步 */
  limit: number;
  /** 像素总预算（字节） */
  byteLimit: number;
  /** 事务嵌套深度 */
  depth: number;
  /** 当前事务里是否真的发生过改动 */
  touched: boolean;
}

export const createHistory = (): History => ({
  entries: [],
  index: -1,
  limit: 60,
  byteLimit: 128 * 1024 * 1024,
  depth: 0,
  touched: false
});

/* ────────────────────────────── 快照 ────────────────────────────── */

function captureLayer(layer: LayerNode): LayerSnapshot {
  const mask = layer.mask;
  // 交出引用后置为共享：下一次就地改写会先复制，快照因此保住旧像素
  if (mask) mask.grayShared = true;

  const base: SnapshotBase = {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    maskEnabled: layer.maskEnabled,
    maskGray: mask ? mask.gray : null,
    expanded: layer.kind === 'group' ? layer.expanded : true
  };

  if (layer.kind === 'group') {
    return {
      ...base,
      kind: 'group',
      children: layer.children.map(captureLayer),
      effects: layer.effects ? structuredClone(layer.effects) : null
    };
  }
  if (layer.kind === 'adjustment') {
    return { ...base, kind: 'adjustment', adjustment: structuredClone(layer.adjustment) };
  }
  return {
    ...base,
    kind: 'raster',
    image: layer.image,
    effects: layer.effects ? structuredClone(layer.effects) : null,
    text: layer.text ? structuredClone(layer.text) : null,
    shape: layer.shape ? structuredClone(layer.shape) : null,
    transform: {
      ...layer.transform,
      origin: [layer.transform.origin[0], layer.transform.origin[1]],
      size: [layer.transform.size[0], layer.transform.size[1]]
    }
  };
}

export function captureDocument(doc: EditorDocument): DocumentSnapshot {
  return {
    width: doc.width,
    height: doc.height,
    name: doc.name,
    resolution: doc.resolution,
    activeLayerID: doc.activeLayerID,
    layers: doc.layers.map(captureLayer),
    selection: doc.selection
  };
}

function restoreLayer(snap: LayerSnapshot): LayerNode {
  const mask: LayerMask | null = snap.maskGray ? maskFromGray(snap.maskGray) : null;
  const base = {
    id: snap.id,
    name: snap.name,
    visible: snap.visible,
    opacity: snap.opacity,
    blendMode: snap.blendMode,
    maskEnabled: snap.maskEnabled,
    mask
  };

  if (snap.kind === 'group') {
    return {
      ...base,
      kind: 'group',
      children: snap.children.map(restoreLayer),
      expanded: snap.expanded,
      // 快照要能反复恢复，所以交出去的必须是副本
      effects: snap.effects ? structuredClone(snap.effects) : null
    };
  }
  if (snap.kind === 'adjustment') {
    return { ...base, kind: 'adjustment', adjustment: structuredClone(snap.adjustment) };
  }
  return {
    ...base,
    kind: 'raster',
    image: snap.image,
    effects: snap.effects ? structuredClone(snap.effects) : null,
    text: snap.text ? structuredClone(snap.text) : null,
    shape: snap.shape ? structuredClone(snap.shape) : null,
    transform: {
      ...snap.transform,
      origin: [snap.transform.origin[0], snap.transform.origin[1]],
      size: [snap.transform.size[0], snap.transform.size[1]]
    }
  };
}

/** 就地写回文档（保持 `doc` 对象身份不变，React 侧只靠 revision 感知变化） */
export function restoreDocument(doc: EditorDocument, snap: DocumentSnapshot): void {
  doc.name = snap.name;
  doc.resolution = snap.resolution;
  doc.width = snap.width;
  doc.height = snap.height;
  doc.activeLayerID = snap.activeLayerID;
  doc.layers = snap.layers.map(restoreLayer);
  doc.selection = snap.selection;
  doc.dirty = 'all';
}

/* ────────────────────────────── 历史栈 ────────────────────────────── */

function* eachMaskGray(snap: DocumentSnapshot): Generator<HTMLCanvasElement> {
  const stack = [...snap.layers];
  while (stack.length) {
    const layer = stack.pop();
    if (!layer) continue;
    if (layer.maskGray) yield layer.maskGray;
    if (layer.kind === 'group') stack.push(...layer.children);
  }
}

function historyBytes(h: History): number {
  const seen = new Set<HTMLCanvasElement>();
  let total = 0;
  for (const snap of h.entries) {
    for (const gray of eachMaskGray(snap)) {
      if (seen.has(gray)) continue;
      seen.add(gray);
      total += gray.width * gray.height * 4;
    }
  }
  return total;
}

function pushSnapshot(h: History, doc: EditorDocument): void {
  const snap = captureDocument(doc);
  if (h.index < h.entries.length - 1) h.entries = h.entries.slice(0, h.index + 1);
  h.entries.push(snap);
  h.index = h.entries.length - 1;

  // 越界就丢最旧的一端（永远保留至少 2 个状态，否则无法撤销）
  while (h.entries.length > 2 && (h.entries.length > h.limit || historyBytes(h) > h.byteLimit)) {
    h.entries.shift();
  }
  h.index = h.entries.length - 1;
}

/**
 * 记录一步改动。
 * 处于事务中时只打标记，由 `endTransaction` 统一落一步。
 */
export function commit(h: History, doc: EditorDocument): void {
  if (h.depth > 0) {
    h.touched = true;
    return;
  }
  pushSnapshot(h, doc);
}

/** 开始一次会连续改动的事务（一次拖拽 = 一步撤销） */
export function beginTransaction(h: History): void {
  h.depth += 1;
  if (h.depth === 1) h.touched = false;
}

export function endTransaction(h: History, doc: EditorDocument | null): void {
  h.depth = Math.max(0, h.depth - 1);
  if (h.depth > 0) return;
  if (h.touched && doc) pushSnapshot(h, doc);
  h.touched = false;
}

/** 新建文档后重置历史，把当前状态作为起点 */
export function resetHistory(h: History, doc: EditorDocument): void {
  h.entries = [captureDocument(doc)];
  h.index = 0;
  h.depth = 0;
  h.touched = false;
}

export const canUndo = (h: History): boolean => h.index > 0;
export const canRedo = (h: History): boolean => h.index < h.entries.length - 1;

export function undo(h: History, doc: EditorDocument): boolean {
  if (!canUndo(h)) return false;
  h.index -= 1;
  restoreDocument(doc, h.entries[h.index]);
  return true;
}

export function redo(h: History, doc: EditorDocument): boolean {
  if (!canRedo(h)) return false;
  h.index += 1;
  restoreDocument(doc, h.entries[h.index]);
  return true;
}
