/**
 * 图层模型（纯函数，不依赖 React）
 *
 * 设计参考 Figma / Photoshop：
 * - 所有内容都是图层，**支持编组嵌套**（`GroupLayer` 内可再放图层或组，任意深度）；
 * - 同一父级内数组顺序 = z 轴顺序（index 0 在最底），面板展示时反转（上层在前）；
 * - 每个图层带 名称 / 可见性 / 锁定 / 不透明度 / 混合模式；
 * - 组的坐标不额外存变换：组的位移 / 缩放 / 旋转直接作用在子图层上（选中组 = 选中其后代节点），
 *   这样模型里只有一套归一化坐标，交互与导出始终一致；
 * - 所有修改都是纯函数，页面只负责把新树塞回 state，撤销重做与批量操作共用同一套逻辑。
 */

import { markBounds, scaleMark, translateMark, type Mark } from '@pmp/image-kit';

/* ================= 类型 ================= */

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: '正常' },
  { id: 'multiply', label: '正片叠底' },
  { id: 'screen', label: '滤色' },
  { id: 'overlay', label: '叠加' },
  { id: 'darken', label: '变暗' },
  { id: 'lighten', label: '变亮' },
  { id: 'color-dodge', label: '颜色减淡' },
  { id: 'color-burn', label: '颜色加深' },
  { id: 'hard-light', label: '强光' },
  { id: 'soft-light', label: '柔光' },
  { id: 'difference', label: '差值' },
  { id: 'exclusion', label: '排除' },
  { id: 'hue', label: '色相' },
  { id: 'saturation', label: '饱和度' },
  { id: 'color', label: '颜色' },
  { id: 'luminosity', label: '明度' }
];

export interface LayerBase {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0 ~ 1，与元素自身不透明度相乘 */
  opacity: number;
  /** 与下方图层混合（画布内生效） */
  blend: BlendMode;
}

/** 图片图层：归一化坐标（相对底图，中心点定位 + 宽高比例） */
export interface PhotoLayer extends LayerBase {
  kind: 'photo';
  src: string;
  natural: { w: number; h: number };
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/** 标注图层：涂抹 / 形状 / 文本 / 贴纸等矢量元素 */
export interface MarkLayer extends LayerBase {
  kind: 'mark';
  mark: Mark;
}

/** 组图层：只负责组织与层级，不额外存变换 */
export interface GroupLayer extends LayerBase {
  kind: 'group';
  collapsed: boolean;
  children: CanvasLayer[];
}

export type CanvasLayer = PhotoLayer | MarkLayer | GroupLayer;
/** 可被变换 / 命中的叶子图层 */
export type LeafLayer = PhotoLayer | MarkLayer;

export type ZOrderOp = 'front' | 'forward' | 'backward' | 'back';
export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type Bounds = { x: number; y: number; w: number; h: number };

export const isGroup = (l: CanvasLayer): l is GroupLayer => l.kind === 'group';
export const isPhoto = (l: CanvasLayer): l is PhotoLayer => l.kind === 'photo';
export const isMark = (l: CanvasLayer): l is MarkLayer => l.kind === 'mark';
export const isLeaf = (l: CanvasLayer): l is LeafLayer => l.kind !== 'group';

/** 底图在选中集合里的伪 id */
export const BASE_LAYER_ID = -1;

export const MARK_MODE_LABEL: Record<Mark['mode'], string> = {
  brush: '涂抹',
  eraser: '擦拭',
  mosaic: '马赛克',
  rect: '涂层',
  shape: '形状',
  text: '文本',
  sticker: '贴纸',
  photo: '图片'
};

/* ================= 遍历 ================= */

/** 深度优先遍历（同层自底向上） */
export function walk(
  layers: CanvasLayer[],
  visit: (layer: CanvasLayer, parent: GroupLayer | null, depth: number) => void,
  parent: GroupLayer | null = null,
  depth = 0
) {
  layers.forEach((l) => {
    visit(l, parent, depth);
    if (isGroup(l)) walk(l.children, visit, l, depth + 1);
  });
}

export function findLayerDeep(layers: CanvasLayer[], id: number): CanvasLayer | undefined {
  let found: CanvasLayer | undefined;
  walk(layers, (l) => {
    if (l.id === id) found = l;
  });
  return found;
}

/** 找到某个节点所在的父级与下标 */
export function findLocation(
  layers: CanvasLayer[],
  id: number
): { parent: GroupLayer | null; index: number } | null {
  const search = (list: CanvasLayer[], parent: GroupLayer | null): { parent: GroupLayer | null; index: number } | null => {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return { parent, index: i };
      const child = list[i];
      if (isGroup(child)) {
        const hit = search(child.children, child);
        if (hit) return hit;
      }
    }
    return null;
  };
  return search(layers, null);
}

/** 某个节点的祖先链（自外向内） */
export function ancestorsOf(layers: CanvasLayer[], id: number): GroupLayer[] {
  const path: GroupLayer[] = [];
  const search = (list: CanvasLayer[], trail: GroupLayer[]): boolean => {
    for (const l of list) {
      if (l.id === id) {
        path.push(...trail);
        return true;
      }
      if (isGroup(l) && search(l.children, [...trail, l])) return true;
    }
    return false;
  };
  search(layers, []);
  return path;
}

export function siblingList(layers: CanvasLayer[], parentId: number | null): CanvasLayer[] {
  if (parentId === null) return layers;
  const parent = findLayerDeep(layers, parentId);
  return parent && isGroup(parent) ? parent.children : layers;
}

/** 所有叶子图层（组展开为其后代叶子） */
export function leavesOf(layer: CanvasLayer): LeafLayer[] {
  if (!isGroup(layer)) return [layer];
  return layer.children.flatMap(leavesOf);
}

/** 面板用的扁平列表：自上而下（上层在前），带缩进层级 */
export interface FlatRow {
  layer: CanvasLayer;
  depth: number;
  parentId: number | null;
  /** 在父级 children 中的下标（0 = 最底） */
  index: number;
}

export function flattenTree(layers: CanvasLayer[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (list: CanvasLayer[], parentId: number | null, depth: number) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const l = list[i];
      rows.push({ layer: l, depth, parentId, index: i });
      if (isGroup(l) && !l.collapsed) visit(l.children, l.id, depth + 1);
    }
  };
  visit(layers, null, 0);
  return rows;
}

/* ================= 深拷贝 ================= */

export function cloneMark(m: Mark): Mark {
  if (m.mode === 'brush' || m.mode === 'eraser' || m.mode === 'mosaic') {
    return { ...m, points: m.points.map((p) => ({ ...p })) };
  }
  return { ...m };
}

export function cloneLayer(l: CanvasLayer): CanvasLayer {
  if (isGroup(l)) return { ...l, children: l.children.map(cloneLayer) };
  return isPhoto(l) ? { ...l } : { ...l, mark: cloneMark(l.mark) };
}

export function cloneLayers(layers: CanvasLayer[]): CanvasLayer[] {
  return layers.map(cloneLayer);
}

/* ================= 基础查询 ================= */

export function layerBounds(l: CanvasLayer): Bounds {
  if (isPhoto(l)) return { x: l.x - l.width / 2, y: l.y - l.height / 2, w: l.width, h: l.height };
  if (isMark(l)) return markBounds(l.mark);
  const boxes = l.children.map(layerBounds).filter((b) => b.w > 0 || b.h > 0);
  if (boxes.length === 0) return { x: 0.5, y: 0.5, w: 0, h: 0 };
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBounds(ids: number[], layers: CanvasLayer[]): Bounds | null {
  const boxes = ids
    .map((id) => findLayerDeep(layers, id))
    .filter((l): l is CanvasLayer => !!l)
    .map(layerBounds);
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 生成不重名图层名：优先用原名，重名时追加序号 */
export function uniqueName(layers: CanvasLayer[], base: string): string {
  const taken = new Set<string>();
  walk(layers, (l) => taken.add(l.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/* ================= 结构操作 ================= */

/** 就地替换某个节点（保持位置） */
export function replaceNode(
  layers: CanvasLayer[],
  id: number,
  fn: (node: CanvasLayer) => CanvasLayer
): CanvasLayer[] {
  return layers.map((l) => {
    if (l.id === id) return fn(l);
    if (isGroup(l)) {
      const children = replaceNode(l.children, id, fn);
      return children === l.children ? l : { ...l, children };
    }
    return l;
  });
}

/** 摘出某个节点（返回新树与被摘出的节点） */
export function detachNode(
  layers: CanvasLayer[],
  id: number
): { layers: CanvasLayer[]; node: CanvasLayer | null } {
  let node: CanvasLayer | null = null;
  const next = layers.flatMap((l) => {
    if (l.id === id) {
      node = l;
      return [];
    }
    if (isGroup(l)) {
      const res = detachNode(l.children, id);
      if (res.node) {
        node = res.node;
        return [{ ...l, children: res.layers }];
      }
    }
    return [l];
  });
  return { layers: next, node };
}

export function removeLayers(layers: CanvasLayer[], ids: number[]): CanvasLayer[] {
  if (ids.length === 0) return layers;
  const set = new Set(ids);
  const strip = (list: CanvasLayer[]): CanvasLayer[] =>
    list
      .filter((l) => !set.has(l.id))
      .map((l) => (isGroup(l) ? { ...l, children: strip(l.children) } : l));
  return strip(layers);
}

export function patchLayer(layers: CanvasLayer[], id: number, patch: Partial<LayerBase>): CanvasLayer[] {
  return replaceNode(layers, id, (l) => ({ ...l, ...patch }));
}

export function patchLayers(layers: CanvasLayer[], ids: number[], patch: Partial<LayerBase>): CanvasLayer[] {
  if (ids.length === 0) return layers;
  const set = new Set(ids);
  return mapDeep(layers, (l) => (set.has(l.id) ? { ...l, ...patch } : l));
}

/** 自底向上做一次整体映射（组会先处理子级） */
export function mapDeep(layers: CanvasLayer[], fn: (l: CanvasLayer) => CanvasLayer): CanvasLayer[] {
  return layers.map((l) => {
    const mapped = isGroup(l) ? { ...l, children: mapDeep(l.children, fn) } : l;
    return fn(mapped);
  });
}

export function updatePhoto(layers: CanvasLayer[], id: number, patch: Partial<PhotoLayer>): CanvasLayer[] {
  return replaceNode(layers, id, (l) => (isPhoto(l) ? { ...l, ...patch } : l));
}

export function updateMark(layers: CanvasLayer[], id: number, mark: Mark): CanvasLayer[] {
  return replaceNode(layers, id, (l) => (isMark(l) ? { ...l, mark } : l));
}

/** 插入到指定父级（parentId = null 表示顶层）的指定下标 */
export function insertInto(
  layers: CanvasLayer[],
  items: CanvasLayer[],
  parentId: number | null,
  index?: number
): CanvasLayer[] {
  if (items.length === 0) return layers;
  if (parentId === null) {
    const next = [...layers];
    const at = index === undefined ? next.length : Math.max(0, Math.min(next.length, index));
    next.splice(at, 0, ...items);
    return next;
  }
  return replaceNode(layers, parentId, (l) => {
    if (!isGroup(l)) return l;
    const children = [...l.children];
    const at = index === undefined ? children.length : Math.max(0, Math.min(children.length, index));
    children.splice(at, 0, ...items);
    return { ...l, children };
  });
}

/** 是否为目标节点的后代（用于阻止把组拖进自己内部） */
export function isDescendantOf(layers: CanvasLayer[], id: number, maybeAncestorId: number): boolean {
  if (id === maybeAncestorId) return true;
  return ancestorsOf(layers, id).some((a) => a.id === maybeAncestorId);
}

/** 跨父级移动节点 */
export function moveLayer(
  layers: CanvasLayer[],
  id: number,
  parentId: number | null,
  index: number
): CanvasLayer[] {
  if (parentId !== null && isDescendantOf(layers, parentId, id)) return layers;
  const detached = detachNode(layers, id);
  if (!detached.node) return layers;
  return insertInto(detached.layers, [detached.node], parentId, index);
}

/** 同一父级内整体重排 */
export function reorderInParent(
  layers: CanvasLayer[],
  parentId: number | null,
  orderedIds: number[]
): CanvasLayer[] {
  const sort = (list: CanvasLayer[]): CanvasLayer[] => {
    const byId = new Map(list.map((l) => [l.id, l]));
    const out: CanvasLayer[] = [];
    orderedIds.forEach((id) => {
      const l = byId.get(id);
      if (l) {
        out.push(l);
        byId.delete(id);
      }
    });
    list.forEach((l) => {
      if (byId.has(l.id)) out.push(l);
    });
    return out;
  };
  if (parentId === null) return sort(layers);
  return replaceNode(layers, parentId, (l) => (isGroup(l) ? { ...l, children: sort(l.children) } : l));
}

/** 在各自父级内调整 z 轴顺序（Figma 语义：置顶 = 移到所属组的顶层） */
export function applyZOrder(layers: CanvasLayer[], ids: number[], op: ZOrderOp): CanvasLayer[] {
  if (ids.length === 0) return layers;
  const set = new Set(ids);
  // 只处理「父级没有被同时选中」的节点，避免组内组外重复调整
  const targets = ids.filter((id) => !ancestorsOf(layers, id).some((a) => set.has(a.id)));
  const byParent = new Map<string, { parentId: number | null; ids: number[] }>();
  targets.forEach((id) => {
    const loc = findLocation(layers, id);
    if (!loc) return;
    const parentId = loc.parent?.id ?? null;
    const key = String(parentId);
    const entry = byParent.get(key) ?? { parentId, ids: [] };
    entry.ids.push(id);
    byParent.set(key, entry);
  });
  let next = layers;
  byParent.forEach(({ parentId, ids: group }) => {
    const list = siblingList(next, parentId);
    let ordered = list.map((l) => l.id);
    const picked = ordered.filter((id) => group.includes(id));
    if (picked.length === 0) return;
    const rest = ordered.filter((id) => !group.includes(id));
    if (op === 'front') ordered = [...rest, ...picked];
    else if (op === 'back') ordered = [...picked, ...rest];
    else {
      const delta = op === 'forward' ? 1 : -1;
      const step = (arr: number[]) => {
        const out = [...arr];
        const sel = new Set(group);
        if (delta > 0) {
          for (let i = out.length - 2; i >= 0; i -= 1) {
            if (sel.has(out[i]) && !sel.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
          }
        } else {
          for (let i = 1; i < out.length; i += 1) {
            if (sel.has(out[i]) && !sel.has(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
          }
        }
        return out;
      };
      ordered = step(ordered);
    }
    next = reorderInParent(next, parentId, ordered);
  });
  return next;
}

/* ================= 编组 / 解组 ================= */

export function makeGroupLayer(id: number, name: string, children: CanvasLayer[]): GroupLayer {
  return {
    id,
    kind: 'group',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    collapsed: false,
    children
  };
}

/** 编组：把选中的节点（同层）收进一个新的组，组落在原位置（最高被选项目的层位） */
export function groupLayers(
  layers: CanvasLayer[],
  ids: number[],
  groupId: number,
  name: string
): { layers: CanvasLayer[]; groupId: number } {
  const set = new Set(ids);
  // 父级也被选中的节点不再单独处理（会被父级整组带走）
  const targets = ids.filter((id) => !ancestorsOf(layers, id).some((a) => set.has(a.id)));
  if (targets.length === 0) return { layers, groupId: -1 };
  const loc = findLocation(layers, targets[0]);
  const parentId = loc?.parent?.id ?? null;
  const list = siblingList(layers, parentId);
  const picked = list.filter((l) => targets.includes(l.id));
  if (picked.length === 0) return { layers, groupId: -1 };

  const lastIndex = Math.max(...picked.map((p) => list.findIndex((l) => l.id === p.id)));
  let tree = layers;
  picked.forEach((p) => {
    tree = detachNode(tree, p.id).layers;
  });
  const kept = siblingList(tree, parentId);
  const insertIndex = kept.filter((l) => list.findIndex((x) => x.id === l.id) < lastIndex).length;
  const group = makeGroupLayer(groupId, name, picked);
  return { layers: insertInto(tree, [group], parentId, insertIndex), groupId };
}

/** 解组：把选中的组就地展开为子图层（可递归选中多层） */
export function ungroupLayers(layers: CanvasLayer[], ids: number[]): { layers: CanvasLayer[]; released: number[] } {
  const set = new Set(ids);
  const released: number[] = [];
  const walkList = (list: CanvasLayer[]): CanvasLayer[] =>
    list.flatMap((l) => {
      if (isGroup(l)) {
        const children = walkList(l.children);
        if (set.has(l.id)) {
          children.forEach((c) => released.push(c.id));
          return children;
        }
        return [{ ...l, children }];
      }
      return [l];
    });
  return { layers: walkList(layers), released };
}

/* ================= 变换 / 对齐 / 分布 ================= */

/** 按整体平移节点（组则递归平移所有后代） */
export function translateNode(layers: CanvasLayer[], id: number, dx: number, dy: number): CanvasLayer[] {
  return replaceNode(layers, id, (l) => {
    if (isPhoto(l)) return { ...l, x: l.x + dx, y: l.y + dy };
    if (isMark(l)) {
      const mark = cloneMark(l.mark);
      translateMark(mark, dx, dy);
      return { ...l, mark };
    }
    return { ...l, children: l.children.map((c) => translateNode([c], c.id, dx, dy)[0]) };
  });
}

/** 以某点为中心等比缩放节点 */
export function scaleNodeAt(
  layers: CanvasLayer[],
  id: number,
  k: number,
  cx: number,
  cy: number
): CanvasLayer[] {
  if (Math.abs(k - 1) < 1e-6 || k <= 0) return layers;
  return replaceNode(layers, id, (l) => {
    if (isPhoto(l)) {
      const nx = cx + (l.x - cx) * k;
      const ny = cy + (l.y - cy) * k;
      return { ...l, x: nx, y: ny, width: l.width * k, height: l.height * k };
    }
    if (isMark(l)) {
      const b = markBounds(l.mark);
      const mark = cloneMark(l.mark);
      scaleMark(mark, k);
      translateMark(mark, cx + (b.x + b.w / 2 - cx) * k - (b.x + b.w / 2), cy + (b.y + b.h / 2 - cy) * k - (b.y + b.h / 2));
      return { ...l, mark };
    }
    return {
      ...l,
      children: l.children.map((c) => scaleNodeAt([c], c.id, k, cx, cy)[0])
    };
  });
}

/** 平移到目标包围盒左上角 */
function moveBoundsTo(layers: CanvasLayer[], id: number, x: number, y: number): CanvasLayer[] {
  const node = findLayerDeep(layers, id);
  if (!node) return layers;
  const b = layerBounds(node);
  return translateNode(layers, id, x - b.x, y - b.y);
}

/** 相对选区（多个）或画布（单个）对齐 */
export function alignLayers(layers: CanvasLayer[], ids: number[], mode: AlignMode): CanvasLayer[] {
  if (ids.length === 0) return layers;
  const ref = ids.length > 1 ? unionBounds(ids, layers) : { x: 0, y: 0, w: 1, h: 1 };
  if (!ref) return layers;
  let next = layers;
  ids.forEach((id) => {
    const node = findLayerDeep(next, id);
    if (!node) return;
    const b = layerBounds(node);
    switch (mode) {
      case 'left':
        next = translateNode(next, id, ref.x - b.x, 0);
        break;
      case 'centerX':
        next = translateNode(next, id, ref.x + ref.w / 2 - (b.x + b.w / 2), 0);
        break;
      case 'right':
        next = translateNode(next, id, ref.x + ref.w - (b.x + b.w), 0);
        break;
      case 'top':
        next = translateNode(next, id, 0, ref.y - b.y);
        break;
      case 'centerY':
        next = translateNode(next, id, 0, ref.y + ref.h / 2 - (b.y + b.h / 2));
        break;
      default:
        next = translateNode(next, id, 0, ref.y + ref.h - (b.y + b.h));
    }
  });
  return next;
}

/** 分布：≥3 个时按中心等距排布 */
export function distributeLayers(layers: CanvasLayer[], ids: number[], axis: 'x' | 'y'): CanvasLayer[] {
  if (ids.length < 3) return layers;
  const items = ids
    .map((id) => {
      const node = findLayerDeep(layers, id);
      return node ? { id, b: layerBounds(node) } : null;
    })
    .filter((x): x is { id: number; b: Bounds } => !!x);
  if (items.length < 3) return layers;

  const center = (b: Bounds) => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2);
  items.sort((a, b) => center(a.b) - center(b.b));
  const first = center(items[0].b);
  const last = center(items[items.length - 1].b);
  const step = (last - first) / (items.length - 1);

  let next = layers;
  items.forEach((item, i) => {
    if (i === 0 || i === items.length - 1) return;
    const node = findLayerDeep(next, item.id);
    if (!node) return;
    const b = layerBounds(node);
    const target = first + step * i;
    const delta = target - center(b);
    next = translateNode(next, item.id, axis === 'x' ? delta : 0, axis === 'x' ? 0 : delta);
  });
  return next;
}

/** 居中到画布 */
export function centerInCanvas(layers: CanvasLayer[], ids: number[], axis: 'x' | 'y'): CanvasLayer[] {
  if (ids.length === 0) return layers;
  let next = layers;
  ids.forEach((id) => {
    const node = findLayerDeep(next, id);
    if (!node) return;
    const b = layerBounds(node);
    if (axis === 'x') next = moveBoundsTo(next, id, 0.5 - b.w / 2, b.y);
    else next = moveBoundsTo(next, id, b.x, 0.5 - b.h / 2);
  });
  return next;
}

/* ================= 复制 / 落位 ================= */

export function duplicateLayer(layer: CanvasLayer, nextId: () => number): CanvasLayer {
  if (isPhoto(layer)) {
    return {
      ...layer,
      id: nextId(),
      name: `${layer.name} 副本`,
      x: Math.min(0.95, layer.x + 0.045),
      y: Math.min(0.95, layer.y + 0.045)
    };
  }
  if (isMark(layer)) {
    const id = nextId();
    return { ...layer, id, name: `${layer.name} 副本`, mark: { ...cloneMark(layer.mark), id } };
  }
  return {
    ...layer,
    id: nextId(),
    name: `${layer.name} 副本`,
    children: layer.children.map((c) => duplicateLayer(c, nextId))
  };
}

export function containInCanvas(
  natural: { w: number; h: number },
  canvas: { w: number; h: number },
  ratio = 0.6
): { width: number; height: number } {
  const cw = Math.max(1, canvas.w);
  const ch = Math.max(1, canvas.h);
  const k = Math.min((cw * ratio) / natural.w, (ch * ratio) / natural.h);
  return { width: (natural.w * k) / cw, height: (natural.h * k) / ch };
}

export interface PhotoInit {
  name: string;
  src: string;
  natural: { w: number; h: number };
  canvas: { w: number; h: number };
  id: number;
  cascade?: number;
}

export function makePhotoLayer(init: PhotoInit): PhotoLayer {
  const { width, height } = containInCanvas(init.natural, init.canvas);
  const step = 0.04 * ((init.cascade ?? 0) % 6);
  return {
    id: init.id,
    kind: 'photo',
    name: init.name,
    src: init.src,
    natural: init.natural,
    x: Math.min(1 - width / 2, Math.max(width / 2, 0.5 + step)),
    y: Math.min(1 - height / 2, Math.max(height / 2, 0.5 + step)),
    width,
    height,
    rotation: 0,
    flipH: false,
    flipV: false,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal'
  };
}

export function makeMarkLayer(id: number, name: string, mark: Mark): MarkLayer {
  return {
    id,
    kind: 'mark',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    mark: { ...mark, id }
  };
}

/** 适应画布：图片按 contain 缩放进画布，标注 / 组整体等比缩放到画布 80% 内 */
export function fitToCanvas(layers: CanvasLayer[], ids: number[], canvas: { w: number; h: number }): CanvasLayer[] {
  let next = layers;
  ids.forEach((id) => {
    const node = findLayerDeep(next, id);
    if (!node) return;
    if (isPhoto(node)) {
      const { width, height } = containInCanvas(node.natural, canvas, 0.8);
      const b = layerBounds(node);
      next = updatePhoto(next, id, { width, height });
      next = moveBoundsTo(
        next,
        id,
        Math.min(1 - width / 2, Math.max(width / 2, b.x + b.w / 2 - width / 2)),
        Math.min(1 - height / 2, Math.max(height / 2, b.y + b.h / 2 - height / 2))
      );
      return;
    }
    const b = layerBounds(node);
    if (b.w <= 0 || b.h <= 0) return;
    const k = Math.min(0.8 / b.w, 0.8 / b.h, 4);
    if (Math.abs(k - 1) > 1e-3) next = scaleNodeAt(next, id, k, b.x + b.w / 2, b.y + b.h / 2);
  });
  return next;
}

/** 恢复原始比例（保持当前宽度，按原图宽高比改高度） */
export function resetAspect(layers: CanvasLayer[], ids: number[], canvas: { w: number; h: number }): CanvasLayer[] {
  let next = layers;
  ids.forEach((id) => {
    const node = findLayerDeep(next, id);
    if (!node || !isPhoto(node)) return;
    const ratio = node.natural.h / node.natural.w;
    const height = (node.width * (canvas.w || 1) * ratio) / (canvas.h || 1);
    next = updatePhoto(next, id, { height: Math.max(0.01, Math.min(6, height)) });
  });
  return next;
}

/* ================= 吸附对齐辅助线 ================= */

export interface SnapGuide {
  axis: 'x' | 'y';
  /** 归一化坐标 */
  value: number;
  kind: 'canvas' | 'layer';
}

export function collectSnapTargets(
  layers: CanvasLayer[],
  excludeIds: number[]
): { x: number[]; y: number[] } {
  const xs = [0, 0.5, 1];
  const ys = [0, 0.5, 1];
  const skip = new Set(excludeIds);
  walk(layers, (l) => {
    if (skip.has(l.id) || !l.visible) return;
    if (isGroup(l) || l.locked) return;
    const b = layerBounds(l);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  });
  return { x: xs, y: ys };
}

/** 计算吸附位移与需要显示的辅助线 */
export function snapBounds(
  bounds: Bounds,
  targets: { x: number[]; y: number[] },
  thresholdX: number,
  thresholdY: number
): { dx: number; dy: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  const edges = (b: Bounds, axis: 'x' | 'y') =>
    axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h];

  const best = (axis: 'x' | 'y') => {
    const th = axis === 'x' ? thresholdX : thresholdY;
    let delta = 0;
    let dist = th;
    let value = 0;
    const pool = axis === 'x' ? targets.x : targets.y;
    edges(bounds, axis).forEach((e) => {
      pool.forEach((t) => {
        const d = Math.abs(t - e);
        if (d < dist) {
          dist = d;
          delta = t - e;
          value = t;
        }
      });
    });
    return { delta, value, hit: dist < th };
  };

  const bx = best('x');
  const by = best('y');
  if (bx.hit) guides.push({ axis: 'x', value: bx.value, kind: Math.abs(bx.value - Math.round(bx.value)) < 0.001 ? 'canvas' : 'layer' });
  if (by.hit) guides.push({ axis: 'y', value: by.value, kind: Math.abs(by.value - Math.round(by.value)) < 0.001 ? 'canvas' : 'layer' });
  return { dx: bx.hit ? bx.delta : 0, dy: by.hit ? by.delta : 0, guides };
}
