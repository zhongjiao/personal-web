/**
 * HTML 字符串 → 可预览文档，以及 HTML 美化。
 *
 * 预览文档会被塞进 `sandbox` 的 iframe（不带 allow-same-origin），
 * 因此预览页无法读写本应用的 localStorage / cookie，脚本只能在自己那一格里跑。
 * 允许脚本时额外注入一段桥接脚本，把 console 与运行时错误 postMessage 回来。
 */

/** 预览页与控制台面板之间的消息标识 */
export const PREVIEW_MESSAGE_SOURCE = 'pmp-html-preview';

export type PreviewLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface PreviewLogMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE;
  type: 'console';
  level: PreviewLogLevel;
  args: string[];
}

/** 纯 ES5 写法：用户页面里可能还有老旧的构建目标，不依赖任何新语法 */
const BRIDGE_SCRIPT = [
  '<script>',
  '(function () {',
  "  var SOURCE = 'pmp-html-preview';",
  '  function stringify(value) {',
  "    if (typeof value === 'string') return value;",
  '    try {',
  '      var text = JSON.stringify(value);',
  '      return text === undefined ? String(value) : text;',
  '    } catch (e) {',
  '      return String(value);',
  '    }',
  '  }',
  '  function send(level, args) {',
  '    try {',
  '      var list = [];',
  '      for (var i = 0; i < args.length; i++) list.push(stringify(args[i]));',
  "      parent.postMessage({ source: SOURCE, type: 'console', level: level, args: list }, '*');",
  '    } catch (e) { /* 跨域或已销毁时忽略 */ }',
  '  }',
  "  var methods = ['log', 'info', 'warn', 'error', 'debug'];",
  '  for (var i = 0; i < methods.length; i++) {',
  '    (function (key) {',
  '      var original = console[key];',
  '      console[key] = function () {',
  '        send(key, arguments);',
  '        if (original) original.apply(console, arguments);',
  '      };',
  '    })(methods[i]);',
  '  }',
  "  window.addEventListener('error', function (event) {",
  "    send('error', [event.message + '  (line ' + event.lineno + ':' + event.colno + ')']);",
  '  });',
  "  window.addEventListener('unhandledrejection', function (event) {",
  "    send('error', ['Unhandled rejection: ' + stringify(event.reason)]);",
  '  });',
  '})();',
  '</script>'
].join('\n');

const FRAGMENT_BASE_STYLE = [
  'html,body{margin:0;padding:0;}',
  'body{padding:16px;font-size:14px;line-height:1.6;color:#1f2933;',
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;}",
  'img{max-width:100%;height:auto;}',
  'table{border-collapse:collapse;}',
  'pre{overflow:auto;}'
].join('');

/** 判断是完整文档还是片段（只有片段才需要补 html/head/body 外壳） */
export function isFullDocument(source: string): boolean {
  return /<!doctype\s+html/i.test(source) || /<html[\s>]/i.test(source);
}

export interface PreviewOptions {
  /** 允许执行脚本（关掉后 iframe 的 sandbox 不含 allow-scripts） */
  allowScripts: boolean;
}

export function buildPreviewDocument(source: string, options: PreviewOptions): string {
  if (!source.trim()) return '';

  const bridge = options.allowScripts ? BRIDGE_SCRIPT : '';

  if (isFullDocument(source)) {
    if (!bridge) return source;
    // 桥接脚本要尽早执行，才能录到 head / body 里用户脚本的早期日志；
    // 但必须排在 <meta charset> 之后 —— 否则会把字符集声明挤出前 1024 字节。
    const charsetMeta = /<meta[^>]*charset[^>]*>/i;
    if (charsetMeta.test(source)) {
      return source.replace(charsetMeta, (match) => `${match}\n${bridge}`);
    }
    if (/<head(\s[^>]*)?>/i.test(source)) {
      return source.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`);
    }
    if (/<html(\s[^>]*)?>/i.test(source)) {
      return source.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`);
    }
    return `${bridge}\n${source}`;
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>${FRAGMENT_BASE_STYLE}</style>`,
    bridge,
    '</head>',
    '<body>',
    source,
    '</body>',
    '</html>'
  ]
    .filter(Boolean)
    .join('\n');
}

export function extractTitle(source: string): string | null {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const title = matched?.[1].trim();
  return title ? title : null;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

/** 一次性切出：注释 / 声明 / 原始内容块 / 标签 / 文本 */
const TOKEN_RE =
  /<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<pre[\s\S]*?<\/pre>|<textarea[\s\S]*?<\/textarea>|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;

const RAW_PAIR_RE = /^<(script|style|pre|textarea)([\s\S]*)<\/\1>$/i;

/**
 * 块级标签：只有它们才会产生换行。
 * `br / hr / img / span / a …` 都按行内处理，否则 `<p>a<br>b</p>` 会被拆成三行，
 * 行内元素之间的空白换行还会在浏览器里变成可见空隙 —— 那是会改变渲染结果的。
 */
const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'meta', 'link', 'base', 'title', 'style', 'script', 'noscript',
  'template', 'div', 'p', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'form', 'fieldset', 'legend', 'blockquote', 'pre', 'figure', 'figcaption',
  'canvas', 'video', 'audio', 'iframe', 'dialog', 'details', 'summary',
  'select', 'optgroup', 'address'
]);

const OPEN_TAG_NAME_RE = /^<([a-zA-Z][\w:-]*)/;

function openTagName(token: string): string | null {
  const matched = OPEN_TAG_NAME_RE.exec(token);
  return matched ? matched[1].toLowerCase() : null;
}

/** 找到与 tokens[start] 配对的闭合标签下标；不配对返回 -1 */
function findClose(tokens: string[], start: number, tag: string): number {
  const openRe = new RegExp(`^<${tag}(\\s[^>]*)?>`);
  const closeRe = new RegExp(`^</${tag}(\\s[^>]*)?>`);
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (closeRe.test(token)) {
      depth--;
      if (depth === 0) return i;
    } else if (openRe.test(token)) {
      depth++;
    }
  }
  return -1;
}

/** [from, to) 区间内是否含块级元素（决定父元素要不要换行） */
function hasBlockInside(tokens: string[], from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const name = openTagName(tokens[i].trim());
    if (name && BLOCK_TAGS.has(name)) return true;
  }
  return false;
}

/** 把一段 token 拼回单行：标签原样，块间空白折叠成一个空格 */
function sliceText(tokens: string[], from: number, to: number): string {
  let text = '';
  for (let i = from; i < to; i++) text += tokens[i].replace(/\s+/g, ' ');
  return text.trim();
}

function renderTokens(
  tokens: string[],
  from: number,
  to: number,
  depth: number,
  indentSize: number,
  lines: string[]
): void {
  const pad = ' '.repeat(Math.max(0, depth) * indentSize);
  let buffer = '';

  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    if (text) lines.push(pad + text);
    buffer = '';
  };

  for (let i = from; i < to; i++) {
    const raw = tokens[i];
    const token = raw.trim();
    if (!token) continue;

    // 源码本身不配对的闭合标签：原样成行，不试图纠错
    if (token.startsWith('</')) {
      flush();
      lines.push(pad + token);
      continue;
    }

    // script / style / pre / textarea：整块原样保留（缩进也算内容，不能动）
    if (RAW_PAIR_RE.test(token)) {
      flush();
      lines.push(pad + token);
      continue;
    }

    if (token.startsWith('<')) {
      const name = openTagName(token);
      const isBlock =
        !!name &&
        BLOCK_TAGS.has(name) &&
        !VOID_TAGS.has(name) &&
        !token.endsWith('/>') &&
        !token.startsWith('<!');

      // 行内元素、空元素、注释、DOCTYPE：留在当前行（按源码原样拼接，只在 flush 时折叠空白）
      if (!isBlock) {
        buffer += raw;
        continue;
      }

      const close = findClose(tokens, i, name);
      // 内部全是行内内容 → 整块保持一行（与常见格式化器的观感一致）
      if (close > i && !hasBlockInside(tokens, i + 1, close)) {
        flush();
        lines.push(pad + sliceText(tokens, i, close + 1));
        i = close;
        continue;
      }

      flush();
      lines.push(pad + token);
      if (close > i) {
        renderTokens(tokens, i + 1, close, depth + 1, indentSize, lines);
        lines.push(pad + tokens[close].trim());
        i = close;
      } else {
        // 找不到闭合标签（源码残缺）：把剩下的都当作子节点，不强行补一个闭合
        renderTokens(tokens, i + 1, to, depth + 1, indentSize, lines);
        i = to;
      }
      continue;
    }

    buffer += raw;
  }

  flush();
}

/**
 * HTML 美化：只在块级标签处换行，行内内容保持在同一行，
 * 因此**不会改变渲染结果**（`pre / textarea / script / style` 内容完全原样）。
 *
 * 已知取舍：标签属性里出现 `>`（如 `<div data-x="a>b">`）时按正则切分可能失手 ——
 * 这属于「格式化不完美」，不会破坏内容，因为正则只切分、不重写标签本身。
 */
export function formatHtml(source: string, indentSize = 2): string {
  const tokens = source.match(TOKEN_RE);
  if (!tokens) return source.trim();

  const lines: string[] = [];
  renderTokens(tokens, 0, tokens.length, 0, indentSize, lines);
  return lines.join('\n');
}

export interface HtmlStats {
  tags: number;
  lines: number;
  bytes: number;
}

export function htmlStats(source: string): HtmlStats {
  return {
    tags: source.match(/<[a-zA-Z][^>]*>/g)?.length ?? 0,
    lines: source ? source.split('\n').length : 0,
    bytes: typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(source).length : source.length
  };
}
