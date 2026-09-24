/**
 * 图片编辑器快捷键：动作定义、键位解析、持久化与冲突检测。
 *
 * 键位存储格式：修饰键小写 + KeyboardEvent.code，例如 "ctrl+shift+KeyZ"。
 * 用 code 而不是 key，避免中文输入法 / 大小写 / 不同键盘布局导致的识别偏差。
 */

export type ShortcutKind = 'tap' | 'hold' | 'repeat';

export type ShortcutGroup = '文件' | '编辑' | '变换 / 裁剪' | '视图' | '工具';

export type ShortcutActionId =
  | 'open'
  | 'export'
  | 'copy'
  | 'undo'
  | 'redo'
  | 'resetAll'
  | 'deleteSelected'
  | 'rotateLeft'
  | 'rotateRight'
  | 'flipH'
  | 'flipV'
  | 'cropMode'
  | 'applyCrop'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitView'
  | 'sizeUp'
  | 'sizeDown'
  | 'compare'
  | 'toolSelect'
  | 'toolBrush'
  | 'toolEraser'
  | 'toolMosaic'
  | 'toolShape'
  | 'toolRect'
  | 'toolSticker'
  | 'toolText'
  | 'cancelTool';

export interface ShortcutDef {
  id: ShortcutActionId;
  label: string;
  group: ShortcutGroup;
  defaultCombo: string | null;
  /** tap：按下触发；hold：按住生效、松开还原；repeat：长按可连续触发 */
  kind?: ShortcutKind;
  hint?: string;
}

/** 动作表：默认键位参考美图秀秀 / 主流修图工具的习惯 */
export const SHORTCUT_DEFS: ShortcutDef[] = [
  {
    id: 'open',
    label: '打开图片',
    group: '文件',
    defaultCombo: 'ctrl+KeyO',
    hint: '选择本地图片'
  },
  {
    id: 'export',
    label: '导出图片',
    group: '文件',
    defaultCombo: 'ctrl+KeyS',
    hint: '按当前格式与质量下载'
  },
  {
    id: 'copy',
    label: '复制到剪贴板',
    group: '文件',
    defaultCombo: 'ctrl+shift+KeyC',
    hint: '复制处理后的图片'
  },
  {
    id: 'undo',
    label: '撤销',
    group: '编辑',
    defaultCombo: 'ctrl+KeyZ'
  },
  {
    id: 'redo',
    label: '重做',
    group: '编辑',
    defaultCombo: 'ctrl+KeyY',
    hint: 'Ctrl + Shift + Z 同样可用'
  },
  {
    id: 'resetAll',
    label: '重置全部',
    group: '编辑',
    defaultCombo: 'ctrl+shift+KeyR',
    hint: '恢复所有参数与笔迹'
  },
  {
    id: 'deleteSelected',
    label: '删除选中元素',
    group: '编辑',
    defaultCombo: 'Delete'
  },
  {
    id: 'rotateLeft',
    label: '左转 90°',
    group: '变换 / 裁剪',
    defaultCombo: 'shift+BracketLeft'
  },
  {
    id: 'rotateRight',
    label: '右转 90°',
    group: '变换 / 裁剪',
    defaultCombo: 'shift+BracketRight'
  },
  {
    id: 'flipH',
    label: '水平翻转',
    group: '变换 / 裁剪',
    defaultCombo: 'shift+KeyH'
  },
  {
    id: 'flipV',
    label: '垂直翻转',
    group: '变换 / 裁剪',
    defaultCombo: 'shift+KeyV'
  },
  {
    id: 'cropMode',
    label: '切换裁剪模式',
    group: '变换 / 裁剪',
    defaultCombo: 'KeyX'
  },
  {
    id: 'applyCrop',
    label: '应用裁剪',
    group: '变换 / 裁剪',
    defaultCombo: 'Enter',
    hint: '仅在裁剪模式下生效'
  },
  {
    id: 'zoomIn',
    label: '放大视图',
    group: '视图',
    defaultCombo: 'ctrl+Equal',
    kind: 'repeat'
  },
  {
    id: 'zoomOut',
    label: '缩小视图',
    group: '视图',
    defaultCombo: 'ctrl+Minus',
    kind: 'repeat'
  },
  {
    id: 'fitView',
    label: '适应窗口 / 复位视图',
    group: '视图',
    defaultCombo: 'ctrl+Digit0'
  },
  {
    id: 'sizeUp',
    label: '输出尺寸 +10%',
    group: '视图',
    defaultCombo: 'BracketRight',
    kind: 'repeat'
  },
  {
    id: 'sizeDown',
    label: '输出尺寸 -10%',
    group: '视图',
    defaultCombo: 'BracketLeft',
    kind: 'repeat'
  },
  {
    id: 'compare',
    label: '按住对比原图',
    group: '视图',
    defaultCombo: 'KeyC',
    kind: 'hold',
    hint: '按住显示原图，松开还原'
  },
  {
    id: 'toolSelect',
    label: '选择 / 移动元素',
    group: '工具',
    defaultCombo: 'KeyM'
  },
  {
    id: 'toolBrush',
    label: '涂抹',
    group: '工具',
    defaultCombo: 'KeyB'
  },
  {
    id: 'toolEraser',
    label: '擦拭',
    group: '工具',
    defaultCombo: 'KeyE'
  },
  {
    id: 'toolMosaic',
    label: '马赛克',
    group: '工具',
    defaultCombo: 'KeyD'
  },
  {
    id: 'toolShape',
    label: '形状',
    group: '工具',
    defaultCombo: 'KeyS'
  },
  {
    id: 'toolRect',
    label: '涂层',
    group: '工具',
    defaultCombo: 'KeyR'
  },
  {
    id: 'toolSticker',
    label: '贴纸',
    group: '工具',
    defaultCombo: 'KeyK'
  },
  {
    id: 'toolText',
    label: '文本',
    group: '工具',
    defaultCombo: 'KeyT'
  },
  {
    id: 'cancelTool',
    label: '退出工具 / 取消裁剪',
    group: '工具',
    defaultCombo: 'Escape'
  }
];

export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  '文件',
  '编辑',
  '变换 / 裁剪',
  '视图',
  '工具'
];

export const SHORTCUT_DEF_BY_ID: Record<string, ShortcutDef> = Object.fromEntries(
  SHORTCUT_DEFS.map((d) => [d.id, d])
);

/** 键位映射：actionId -> combo（null 表示未绑定） */
export type ShortcutMap = Record<string, string | null>;

/** 内置别名：不受用户配置影响的固定组合（用户配置优先） */
export const BUILTIN_ALIASES: Record<string, ShortcutActionId> = {
  'ctrl+shift+KeyZ': 'redo',
  'meta+shift+KeyZ': 'redo'
};

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
]);

export const isMac = () =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent);

/** 把键盘事件转成规范化键位串；只按修饰键时返回 null */
export function comboFromEvent(e: {
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const code = e.code;
  if (!code || MODIFIER_CODES.has(code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  parts.push(code);
  return parts.join('+');
}

const CODE_LABELS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: '空格',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Tab: 'Tab',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/'
};

function codeLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith('Numpad')) return `小键盘${code.slice(6)}`;
  return code;
}

/** 键位串 -> 展示文本（Mac 用符号） */
export function formatCombo(combo: string | null | undefined): string {
  if (!combo) return '未设置';
  const parts = combo.split('+');
  const code = parts.pop() as string;
  const label = codeLabel(code);
  const mac = isMac();
  if (mac) {
    const symbols: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
    return parts.map((p) => symbols[p] ?? p).join('') + label;
  }
  const names: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
  return [...parts.map((p) => names[p] ?? p), label].join(' + ');
}

export function defaultShortcutMap(): ShortcutMap {
  return Object.fromEntries(SHORTCUT_DEFS.map((d) => [d.id, d.defaultCombo]));
}

function matchCombo(combo: string, map: ShortcutMap): ShortcutActionId | null {
  for (const def of SHORTCUT_DEFS) {
    const bound = map[def.id];
    if (bound && bound === combo) return def.id;
  }
  return BUILTIN_ALIASES[combo] ?? null;
}

/** Ctrl 与 ⌘ 互换，保证同一套配置在 Windows / macOS 都能用 */
function swapPrimaryMod(combo: string): string | null {
  if (combo.includes('ctrl+')) return combo.replace('ctrl+', 'meta+');
  if (combo.includes('meta+')) return combo.replace('meta+', 'ctrl+');
  return null;
}

/** combo -> 动作；用户配置优先，其次内置别名 */
export function resolveAction(combo: string, map: ShortcutMap): ShortcutActionId | null {
  const direct = matchCombo(combo, map);
  if (direct) return direct;
  const swapped = swapPrimaryMod(combo);
  return swapped ? matchCombo(swapped, map) : null;
}

/** 找出重复绑定的键位 */
export function findConflicts(map: ShortcutMap): Record<string, ShortcutActionId[]> {
  const used: Record<string, ShortcutActionId[]> = {};
  for (const def of SHORTCUT_DEFS) {
    const combo = map[def.id];
    if (!combo) continue;
    (used[combo] ??= []).push(def.id);
  }
  return Object.fromEntries(Object.entries(used).filter(([, ids]) => ids.length > 1));
}

/** 某个动作当前是否处于冲突中 */
export function conflictOf(
  map: ShortcutMap,
  id: ShortcutActionId,
  conflicts: Record<string, ShortcutActionId[]>
): ShortcutActionId[] | null {
  const combo = map[id];
  if (!combo) return null;
  const list = conflicts[combo];
  return list && list.length > 1 ? list.filter((x) => x !== id) : null;
}

export function describeConflicts(conflicts: Record<string, ShortcutActionId[]>): string | null {
  const entries = Object.entries(conflicts);
  if (entries.length === 0) return null;
  return entries
    .map(([combo, ids]) => {
      const names = ids.map((id) => SHORTCUT_DEF_BY_ID[id]?.label ?? id).join(' / ');
      return `${formatCombo(combo)} 被「${names}」同时占用`;
    })
    .join('；');
}

const STORAGE_KEY = 'pmp-image-shortcuts';

/** 清洗外部数据：只保留已知动作与合法键位串 */
function normalize(raw: unknown): ShortcutMap {
  const base = defaultShortcutMap();
  if (!raw || typeof raw !== 'object') return base;
  for (const def of SHORTCUT_DEFS) {
    const v = (raw as Record<string, unknown>)[def.id];
    if (v === null) base[def.id] = null;
    else if (typeof v === 'string' && v.length > 0) base[def.id] = v;
  }
  return base;
}

export function loadShortcutMap(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultShortcutMap();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultShortcutMap();
  }
}

export function saveShortcutMap(map: ShortcutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(map)));
  } catch {
    /* 存储不可用时忽略，仅当次生效 */
  }
}
