/**
 * JSON 处理的纯函数集合：解析 / 定位错误 / 宽松清洗 / 格式化 / 排序 / 统计。
 * 页面只负责把结果塞进 state，因此「格式化」「排序」「宽松重解析」共用同一套逻辑。
 */

export interface JsonError {
  /** 原生错误信息 */
  message: string;
  /** 出错字符在原文中的下标（无法定位时为 -1） */
  position: number;
  /** 1 基行号（无法定位时为 0） */
  line: number;
  /** 1 基列号（无法定位时为 0） */
  column: number;
}

export interface JsonParseResult {
  ok: boolean;
  value?: unknown;
  error?: JsonError;
  /** 实际参与解析的文本（宽松模式下与输入不同） */
  source: string;
}

/** 由字符下标换算 1 基的行 / 列（按字符计，不做 tab 展开） */
export function locate(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(position < 0 ? 0 : position, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * 从原生错误信息里抠出位置。
 * V8：`Unexpected token } in JSON at position 12 (line 2 column 3)`；
 * 新版 V8 只剩 `... position 12 (line 2 column 3)`，两条正则都兜住。
 */
function extractPosition(message: string, text: string): number {
  const byPosition = /position (\d+)/.exec(message);
  if (byPosition) return Number(byPosition[1]);

  const byLineColumn = /line (\d+) column (\d+)/.exec(message);
  if (byLineColumn) {
    const line = Number(byLineColumn[1]);
    const column = Number(byLineColumn[2]);
    const lines = text.split('\n');
    let position = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) position += lines[i].length + 1;
    return position + Math.max(0, column - 1);
  }
  return -1;
}

export function parseJson(text: string, loose = false): JsonParseResult {
  const source = loose ? stripJsonComments(text) : text;
  try {
    return { ok: true, value: JSON.parse(source), source };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = extractPosition(message, source);
    const { line, column } = position >= 0 ? locate(source, position) : { line: 0, column: 0 };
    return { ok: false, source, error: { message, position, line, column } };
  }
}

/**
 * 宽松清洗：字符串之外去掉 `//`、`/* *\/` 注释与尾随逗号
 *（VSCode 的 settings.json 这类「JSONC」粘贴进来也能直接看）。
 * 手写扫描器而不是正则：必须知道当前是否在字符串里，否则 `{"a": "逗号,}"}` 会被改坏。
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    // 字符串：原样拷贝，含转义
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        const c = text[i];
        if (c === '\\') {
          out += c + (text[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += c;
        i++;
        if (c === '"') break;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (ch === ',') {
      // 向后跳过空白与注释：若下一个有效字符是 } 或 ] 说明是尾随逗号，丢掉
      let j = i + 1;
      for (;;) {
        const c = text[j];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
          j++;
          continue;
        }
        if (c === '/' && text[j + 1] === '/') {
          while (j < n && text[j] !== '\n') j++;
          continue;
        }
        if (c === '/' && text[j + 1] === '*') {
          j += 2;
          while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
          j += 2;
          continue;
        }
        break;
      }
      if (text[j] === '}' || text[j] === ']') {
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function formatJson(value: unknown, indent: number | string = 2): string {
  return JSON.stringify(value, null, indent) ?? '';
}

export function minifyJson(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

/** 深度递归排序对象的键（数组顺序保持不变，避免破坏业务语义） */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    const result: Record<string, unknown> = {};
    for (const [key, child] of entries) result[key] = sortKeysDeep(child);
    return result;
  }
  return value;
}

export interface JsonStats {
  /** 节点总数（对象 / 数组 / 标量都算一个） */
  nodes: number;
  /** 最大嵌套深度（标量为 1） */
  depth: number;
  objects: number;
  arrays: number;
  keys: number;
  bytes: number;
  lines: number;
}

export function computeStats(value: unknown, text: string): JsonStats {
  const stats: JsonStats = {
    nodes: 0,
    depth: 0,
    objects: 0,
    arrays: 0,
    keys: 0,
    bytes: utf8Size(text),
    lines: text ? text.split('\n').length : 0
  };

  // 迭代式遍历：避免极深结构把调用栈打爆
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];
  while (stack.length) {
    const { value: current, depth } = stack.pop()!;
    stats.nodes++;
    if (depth > stats.depth) stats.depth = depth;

    if (Array.isArray(current)) {
      stats.arrays++;
      for (const child of current) stack.push({ value: child, depth: depth + 1 });
    } else if (current && typeof current === 'object') {
      stats.objects++;
      const entries = Object.entries(current as Record<string, unknown>);
      stats.keys += entries.length;
      for (const [, child] of entries) stack.push({ value: child, depth: depth + 1 });
    }
  }
  return stats;
}

export function utf8Size(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}
