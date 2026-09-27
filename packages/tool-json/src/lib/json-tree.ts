/**
 * 把解析后的值转成「可折叠树」模型。
 *
 * 两件事需要小心：
 *  1. 超大 JSON 不能无限建节点 —— 用 maxNodes 预算 + truncated 标记兜住；
 *  2. 递归遍历深结构会爆栈，这里用广度优先 + 显式队列。
 */

export type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonTreeNode {
  /** 唯一 id（就是 path，可直接用于展开集合） */
  id: string;
  /** 对象的键；数组元素与根为 null */
  key: string | null;
  /** 数组下标；非数组为 -1 */
  index: number;
  /** 展示用路径：$.a.b[0] */
  path: string;
  /** 距离根的层数（根为 0） */
  depth: number;
  type: JsonValueType;
  /** 原始值（对象 / 数组保留引用，展开时才渲染） */
  value: unknown;
  /** 子节点数量 */
  size: number;
  children: JsonTreeNode[];
}

export interface BuildTreeResult {
  root: JsonTreeNode;
  nodeCount: number;
  /** 节点数超出预算，后半部分未展开 */
  truncated: boolean;
}

export function valueType(value: unknown): JsonValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 路径规则与调试习惯一致：能当标识符用 `.key`，否则用 `["key-with-dash"]` */
export function childPath(parentPath: string, key: string | null, index: number): string {
  if (index >= 0) return `${parentPath}[${index}]`;
  if (key === null) return parentPath;
  return IDENTIFIER_RE.test(key)
    ? `${parentPath}.${key}`
    : `${parentPath}[${JSON.stringify(key)}]`;
}

/** 单行摘要：字符串截断，对象 / 数组只给括号 */
export function previewOf(node: JsonTreeNode, maxLength = 120): string {
  switch (node.type) {
    case 'object':
      return '{…}';
    case 'array':
      return '[…]';
    case 'null':
      return 'null';
    case 'string': {
      const text = JSON.stringify(node.value as string);
      return text.length > maxLength ? `${text.slice(0, maxLength)}…"` : text;
    }
    default:
      return String(node.value);
  }
}

function createNode(
  value: unknown,
  key: string | null,
  index: number,
  path: string,
  depth: number
): JsonTreeNode {
  const type = valueType(value);
  const size =
    type === 'array'
      ? (value as unknown[]).length
      : type === 'object'
        ? Object.keys(value as Record<string, unknown>).length
        : 0;
  return { id: path, key, index, path, depth, type, value, size, children: [] };
}

export function buildTree(value: unknown, maxNodes = 20000): BuildTreeResult {
  const root = createNode(value, null, -1, '$', 0);
  let nodeCount = 1;
  let truncated = false;

  const queue: JsonTreeNode[] = [root];
  while (queue.length) {
    const parent = queue.shift()!;
    if (parent.type !== 'object' && parent.type !== 'array') continue;

    const entries: [string | null, number, unknown][] =
      parent.type === 'array'
        ? (parent.value as unknown[]).map((child, i) => [null, i, child] as [null, number, unknown])
        : Object.entries(parent.value as Record<string, unknown>).map(
            ([k, child]) => [k, -1, child] as [string, number, unknown]
          );

    for (const [key, index, child] of entries) {
      if (nodeCount >= maxNodes) {
        truncated = true;
        break;
      }
      const node = createNode(
        child,
        key,
        index,
        childPath(parent.path, key, index),
        parent.depth + 1
      );
      parent.children.push(node);
      nodeCount++;
      if (node.type === 'object' || node.type === 'array') queue.push(node);
    }

    if (truncated) break;
  }

  return { root, nodeCount, truncated };
}

export interface TreeMatchResult {
  /** 命中的节点 id */
  matchIds: Set<string>;
  /** 命中节点的全部祖先 id（用于自动展开） */
  ancestorIds: Set<string>;
  count: number;
}

/** 关键字搜索：匹配键名、数组下标与标量值的文本形式 */
export function findMatches(root: JsonTreeNode, query: string, limit = 2000): TreeMatchResult {
  const matchIds = new Set<string>();
  const ancestorIds = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (!needle) return { matchIds, ancestorIds, count: 0 };

  let count = 0;
  const stack: { node: JsonTreeNode; chain: string[] }[] = [{ node: root, chain: [] }];
  while (stack.length) {
    const { node, chain } = stack.pop()!;
    const haystack = [
      node.key ?? '',
      node.index >= 0 ? String(node.index) : '',
      node.type === 'string' ? (node.value as string) : '',
      node.type === 'number' || node.type === 'boolean' ? String(node.value) : ''
    ]
      .join('\u0000')
      .toLowerCase();

    const nextChain = [...chain, node.id];
    if (haystack.includes(needle)) {
      count++;
      matchIds.add(node.id);
      for (const id of chain) ancestorIds.add(id);
      if (count >= limit) break;
    }

    for (const child of node.children) stack.push({ node: child, chain: nextChain });
  }

  return { matchIds, ancestorIds, count };
}

/** 默认展开策略：小文档展开两层，大文档只展开根，避免一次性渲染上万行 */
export function defaultExpandedIds(tree: BuildTreeResult): Set<string> {
  const ids = new Set<string>();
  const maxDepth = tree.nodeCount <= 200 ? 1 : 0;
  const stack: JsonTreeNode[] = [tree.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.depth > maxDepth) continue;
    if (node.type === 'object' || node.type === 'array') ids.add(node.id);
    for (const child of node.children) stack.push(child);
  }
  return ids;
}

/** 收集所有可折叠节点的 id（展开全部时使用） */
export function allBranchIds(tree: BuildTreeResult): Set<string> {
  const ids = new Set<string>();
  const stack: JsonTreeNode[] = [tree.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'object' || node.type === 'array') ids.add(node.id);
    for (const child of node.children) stack.push(child);
  }
  return ids;
}

/** 某个节点的完整 JSON 文本（复制用） */
export function nodeToJson(node: JsonTreeNode, indent = 2): string {
  return JSON.stringify(node.value, null, indent) ?? 'null';
}
