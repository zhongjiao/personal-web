import { escapeAttr, escapeHtml } from './escape';

/**
 * 轻量 Markdown 渲染器（纯函数、零依赖）。
 *
 * 仓库里没有 markdown 解析库，也不想为「预览」这一个诉求再装一个依赖，
 * 所以这里实现 CommonMark + 常用 GFM 子集：
 *   块级：ATX / setext 标题、段落、围栏与缩进代码、引用、有序/无序/任务列表（可嵌套）、
 *         GFM 表格（含对齐）、分隔线、原始 HTML 透传
 *   行内：粗体 / 斜体 / 粗斜体 / 删除线 / 行内代码 / 链接（内联 + 引用式 + 自动链接）/
 *         图片 / 硬换行 / 反斜杠转义 / 命名实体
 *
 * 不支持（会在界面里注明）：脚注、定义列表、数学公式、目录生成、代码语法高亮。
 * 输出只依赖 HTML 字符串，因此可以在 Node 里直接做回归测试。
 */

export interface MarkdownOptions {
  /** 单个换行是否渲染成 `<br>`（GitHub 评论风格）；默认 false，即 README 风格（视为空格） */
  breaks?: boolean;
  /** 是否透传原始 HTML（默认透传；预览 iframe 已禁用脚本） */
  allowHtml?: boolean;
}

export interface MarkdownStats {
  chars: number;
  words: number;
  lines: number;
  headings: number;
  codeBlocks: number;
  links: number;
  tables: number;
  tasks: number;
}

export interface MarkdownHeading {
  level: number;
  text: string;
  id: string;
}

export interface MarkdownResult {
  html: string;
  stats: MarkdownStats;
  headings: MarkdownHeading[];
}

interface Reference {
  url: string;
  title: string;
}

interface Context {
  refs: Map<string, Reference>;
  stats: MarkdownStats;
  headings: MarkdownHeading[];
  slugs: Map<string, number>;
  breaks: boolean;
  allowHtml: boolean;
}

const LIST_LINE_RE = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)([\s\S]*)$/;
const HR_LINE_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const ATX_LINE_RE = /^ {0,3}(#{1,6})(?:[ \t]+([\s\S]*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_LINE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*([\s\S]*)$/;
const SETEXT_LINE_RE = /^ {0,3}(=+|-{2,})[ \t]*$/;
const REFERENCE_RE = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/;

function isBlank(line: string | undefined): boolean {
  return !line || !line.trim();
}

function indentOf(line: string): number {
  let count = 0;
  while (line[count] === ' ') count++;
  return count;
}

function dedent(line: string, width: number): string {
  const strip = Math.min(width, indentOf(line));
  return line.slice(strip);
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/`+/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** 标题的纯文本（用于目录与大 anchor id） */
function plainText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
}

function uniqueSlug(ctx: Context, base: string): string {
  const used = ctx.slugs.get(base) ?? 0;
  ctx.slugs.set(base, used + 1);
  return used === 0 ? base : `${base}-${used}`;
}

function headingHtml(ctx: Context, level: number, text: string): string {
  const label = plainText(text) || '（空标题）';
  const id = uniqueSlug(ctx, slugify(label));
  ctx.stats.headings++;
  ctx.headings.push({ level, text: label, id });
  return `<h${level} id="${escapeAttr(id)}">${renderInline(text, ctx)}</h${level}>`;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  if (!line || !line.trim()) return true;
  if (FENCE_LINE_RE.test(line)) return true;
  if (ATX_LINE_RE.test(line)) return true;
  if (HR_LINE_RE.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (LIST_LINE_RE.test(line)) return true;
  if (isHtmlBlockStart(line)) return true;
  return false;
}

/** 自动链接 `<https://…>` 长得像标签，但它属于行内语法，不能当成 HTML 块 */
const AUTOLINK_LINE_RE = /^ {0,3}<(?:https?:\/\/|mailto:)[^<>\s]+>[ \t]*$/;

function isHtmlBlockStart(line: string): boolean {
  return /^ {0,3}<[a-zA-Z/!?]/.test(line) && !AUTOLINK_LINE_RE.test(line);
}

// ---------------------------------------------------------------- 行内渲染

/** 挡掉 javascript: / vbscript: 这类协议，其余原样（相对路径、锚点、mailto 都合法） */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '#';
  if (/^(?:javascript|vbscript|file|blob):/i.test(trimmed)) return '#';
  if (/^data:/i.test(trimmed) && !/^data:image\//i.test(trimmed)) return '#';
  return trimmed;
}

/** 把用户写的命名 / 数字实体还原（`&amp;copy;` → `&copy;`），其余转义保持不变 */
function restoreEntities(text: string): string {
  return text.replace(/&amp;(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, '&$1;');
}

/**
 * 原始 HTML 的轻量清洗：Markdown 允许内嵌 HTML，但预览与导出的都是「单文件 HTML」，
 * 里面不该带脚本、内联事件或 javascript: 链接（GitHub 也是这么做的）。
 * 只做黑名单，不做语义解析 —— 目的不是当通用 sanitizer，而是让 HTML 透传不至于成为注入面。
 */
function sanitizeRawHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi,
      ' $1="#"'
    );
}

/** 行内替换用的占位符：NUL 包住下标，正常文本里不会出现 */
const PLACEHOLDER_MARK = '\u0000';
const PLACEHOLDER_RE = new RegExp(`${PLACEHOLDER_MARK}(\\d+)${PLACEHOLDER_MARK}`, 'g');

/**
 * 行内渲染。
 *
 * 链接文字要递归解析（`[**粗**](url)` 里的强调得生效），而占位符（代码、图片等）是
 * 「下标 → HTML」的数组引用 —— 如果每次递归都新建数组，里层就查不到外层的占位符
 * （表现为链接文字里的行内代码被吞掉）。因此所有递归共用同一个 store，只在最外层还原。
 */
interface InlineStore {
  holds: string[];
}

function renderInline(source: string, ctx: Context, store?: InlineStore): string {
  if (!source) return '';

  const outermost = store === undefined;
  const shared = store ?? { holds: [] };
  const hold = (html: string) =>
    `${PLACEHOLDER_MARK}${shared.holds.push(html) - 1}${PLACEHOLDER_MARK}`;

  let text = source;

  // 1. 行内代码：先摘出来，避免里面的 * _ [ ] 被当成语法
  text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_match, _ticks: string, body: string) => {
    const content = /^ [\s\S]* $/.test(body) ? body.slice(1, -1) : body;
    return hold(`<code>${escapeHtml(content)}</code>`);
  });

  // 2. 自动链接 `<https://…>` / `<mailto:…>`（要早于原始 HTML，否则会被当成标签）
  text = text.replace(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/g, (_match, url: string) => {
    const href = safeUrl(url);
    ctx.stats.links++;
    return hold(`<a href="${escapeAttr(href)}" rel="noreferrer noopener">${escapeHtml(url)}</a>`);
  });

  // 3. 原始 HTML 标签：清洗后原样保留（预览 iframe 也禁了脚本，双保险）
  if (ctx.allowHtml) {
    text = text.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => hold(sanitizeRawHtml(tag)));
  }

  // 4. 反斜杠转义
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!>~|"'])/g, (_match, ch: string) => hold(escapeHtml(ch)));

  // 5. 图片与链接（在转义前处理，标题里的引号才能正常识别）
  text = text.replace(
    /!\[([^\]]*)\]\(\s*<?([^\s)<>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/g,
    (_match, alt: string, url: string, title?: string) => {
      ctx.stats.links++;
      return hold(
        `<img src="${escapeAttr(safeUrl(url))}" alt="${escapeAttr(alt)}"${
          title ? ` title="${escapeAttr(title)}"` : ''
        }>`
      );
    }
  );

  text = text.replace(
    /\[([^\]]*)\]\(\s*<?([^\s)<>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/g,
    (_match, label: string, url: string, title?: string) => {
      ctx.stats.links++;
      return hold(
        `<a href="${escapeAttr(safeUrl(url))}"${title ? ` title="${escapeAttr(title)}"` : ''} rel="noreferrer noopener">${renderInline(
          label,
          ctx,
          shared
        )}</a>`
      );
    }
  );

  // 6. 引用式链接：`[text][id]` / `[text][]` / `[id]`
  text = text.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label: string, id: string) => {
    const ref = ctx.refs.get(referenceKey(id || label));
    if (!ref) return match;
    ctx.stats.links++;
    return hold(
      `<a href="${escapeAttr(safeUrl(ref.url))}"${
        ref.title ? ` title="${escapeAttr(ref.title)}"` : ''
      } rel="noreferrer noopener">${renderInline(label, ctx, shared)}</a>`
    );
  });
  text = text.replace(/\[([^\]]+)\](?![([])/g, (match, label: string) => {
    const ref = ctx.refs.get(referenceKey(label));
    if (!ref) return match;
    ctx.stats.links++;
    return hold(
      `<a href="${escapeAttr(safeUrl(ref.url))}"${
        ref.title ? ` title="${escapeAttr(ref.title)}"` : ''
      } rel="noreferrer noopener">${renderInline(label, ctx, shared)}</a>`
    );
  });

  // 7. 剩下的文本整体转义，再把常见的命名实体还原回去
  text = restoreEntities(escapeHtml(text));

  // 8. 光秃秃的 URL 自动变链接（GFM 扩展）
  text = text.replace(
    // 遇到中英文标点就断开，「见 https://x.com/a。后面」不会被整段吞成链接。
    // 尾部再排除一次 ASCII 标点，避免链接末尾带上 `.` `,` 之类。
    /(^|[\s(])((?:https?:\/\/|www\.)[^\s<>"'`。，；：！？、）》」』】…]*[^\s<>"'`.,;:!?)\]}\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u300b\u300d\u300f\u3011\u2026])/g,
    (_match, prefix: string, url: string) => {
      const href = /^www\./i.test(url) ? `https://${url}` : url;
      ctx.stats.links++;
      return `${prefix}${hold(
        `<a href="${escapeAttr(href)}" rel="noreferrer noopener">${url}</a>`
      )}`;
    }
  );

  // 9. 强调 / 删除线（顺序有意义：先三连，再两连，最后单字符）
  // 内容允许只有一个字符（`**3**`），所以用 `[^\s*](?:...)?` 而不是两个必选字符
  text = text
    .replace(/\*\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])___([^\s_](?:[\s\S]*?[^\s_])?)___(?!\w)/g, '$1<strong><em>$2</em></strong>')
    .replace(/(^|[^\w])__([^\s_](?:[\s\S]*?[^\s_])?)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^\w*])\*([^\s*](?:[^*]*?[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w*])_([^\s_](?:[^_]*?[^\s_])?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g, '<del>$1</del>');

  // 10. 换行：两个以上空格 / 反斜杠 = 硬换行；开启 breaks 时单个换行也是硬换行
  text = text.replace(/(?: {2,}|\\)\n/g, '<br>\n');
  if (ctx.breaks) text = text.replace(/\n/g, '<br>\n');

  // 内层递归：占位符交给最外层统一还原
  if (!outermost) return text.trim();

  // 占位符可能多层（链接文字里又嵌了代码 / 强调），多跑几轮直到没有。
  // 用 NUL 当哨兵：正常文本里不会出现；写成 RegExp 构造函数是为了避开 no-control-regex。
  for (let pass = 0; pass < 4 && text.includes(PLACEHOLDER_MARK); pass++) {
    text = text.replace(PLACEHOLDER_RE, (_match, index: string) => shared.holds[Number(index)] ?? '');
  }

  return text.trim();
}

function referenceKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------- 块级渲染

function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let buffer = '';
  let escaped = false;
  let inCode = false;

  for (const ch of text) {
    if (escaped) {
      buffer += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      buffer += ch;
      escaped = true;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      buffer += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  cells.push(buffer.trim());

  return cells;
}

function isTableDelimiter(line: string | undefined): boolean {
  if (!line || !line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

/** 紧凑列表：剥掉**第一个**段落外层 `<p>`，后面跟着的嵌套列表等块级内容保持不动 */
function unwrapParagraph(html: string): string {
  const matched = /^<p>([\s\S]*?)<\/p>/.exec(html);
  if (!matched) return html;
  return matched[1] + html.slice(matched[0].length);
}

function parseBlockquote(
  lines: string[],
  start: number,
  ctx: Context
): { html: string; next: number } {
  const inner: string[] = [];
  let i = start;

  while (i < lines.length) {
    const quoted = /^ {0,3}>[ \t]?([\s\S]*)$/.exec(lines[i]);
    if (quoted) {
      inner.push(quoted[1]);
      i++;
      continue;
    }
    if (isBlank(lines[i])) {
      if (/^ {0,3}>/.test(lines[i + 1] ?? '')) {
        inner.push('');
        i++;
        continue;
      }
      break;
    }
    // 惰性续行：不构成新块的内容继续留在引用里
    if (!startsBlock(lines, i)) {
      inner.push(lines[i]);
      i++;
      continue;
    }
    break;
  }

  return { html: `<blockquote>\n${parseBlocks(inner, ctx)}\n</blockquote>`, next: i };
}

interface ListItem {
  content: string[];
  task?: boolean;
  checked?: boolean;
}

function parseList(
  lines: string[],
  start: number,
  ctx: Context
): { html: string; next: number } | null {
  const first = LIST_LINE_RE.exec(lines[start]);
  if (!first) return null;

  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const startNumber = ordered ? Number.parseInt(first[2], 10) : 1;

  const items: ListItem[] = [];
  let current: ListItem | null = null;
  let contentIndent = 0;
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      // 空行只有「后面还属于这个列表」时才收下，同时把列表标记为 loose
      let lookahead = i + 1;
      while (lookahead < lines.length && isBlank(lines[lookahead])) lookahead++;
      if (lookahead >= lines.length) {
        i = lookahead;
        break;
      }

      const nextLine = lines[lookahead];
      const nextMarker = LIST_LINE_RE.exec(nextLine);
      const nextIndent = indentOf(nextLine);
      const sibling = nextMarker !== null && nextMarker[1].length <= baseIndent + 1;

      if (sibling && /\d/.test(nextMarker![2]) !== ordered) break;
      if (!sibling && nextIndent < contentIndent) break;

      loose = true;
      current?.content.push('');
      i = lookahead;
      continue;
    }

    const marker = LIST_LINE_RE.exec(line);
    const indent = indentOf(line);

    if (marker && indent <= baseIndent + 1) {
      if (/\d/.test(marker[2]) !== ordered) break;

      if (current) items.push(current);
      contentIndent = indent + marker[2].length + marker[3].length;
      current = { content: [marker[4]] };

      const task = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(current.content[0]);
      if (task) {
        current.task = true;
        current.checked = task[1].toLowerCase() === 'x';
        current.content[0] = task[2];
        ctx.stats.tasks++;
      }

      i++;
      continue;
    }

    if (current && (indent >= contentIndent || (indent > baseIndent && !startsBlock(lines, i)))) {
      current.content.push(dedent(line, contentIndent));
      i++;
      continue;
    }

    break;
  }

  if (current) items.push(current);
  if (!items.length) return null;

  const itemsHtml = items.map((item) => {
    const inner = parseBlocks(item.content, ctx);
    const body = loose ? inner : unwrapParagraph(inner);
    const checkbox = item.task
      ? `<input type="checkbox" disabled${item.checked ? ' checked' : ''}>`
      : '';
    const content = checkbox
      ? body.startsWith('<p>')
        ? body.replace(/^<p>/, `<p>${checkbox} `)
        : `${checkbox} ${body}`
      : body;
    return `<li${item.task ? ' class="task"' : ''}>${content}</li>`;
  });

  const tag = ordered ? 'ol' : 'ul';
  const attrs = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';

  return {
    html: `<${tag}${attrs}>\n${itemsHtml.join('\n')}\n</${tag}>`,
    next: i
  };
}

function parseTable(
  lines: string[],
  start: number,
  ctx: Context
): { html: string; next: number } {
  const header = splitTableRow(lines[start]);
  const alignments = splitTableRow(lines[start + 1]).map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });

  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
    rows.push(splitTableRow(lines[i]));
    i++;
  }

  const cell = (tag: 'th' | 'td', text: string, index: number) =>
    `<${tag}${alignments[index] ? ` style="text-align:${alignments[index]}"` : ''}>${renderInline(
      text,
      ctx
    )}</${tag}>`;

  const head = `<thead><tr>${header
    .map((text, index) => cell('th', text, index))
    .join('')}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${Array.from({ length: header.length }, (_, index) =>
              cell('td', row[index] ?? '', index)
            ).join('')}</tr>`
        )
        .join('')}</tbody>`
    : '';

  ctx.stats.tables++;
  return { html: `<div class="md-table"><table>${head}${body}</table></div>`, next: i };
}

function parseBlocks(lines: string[], ctx: Context): string {
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    // 围栏代码块
    const fence = FENCE_LINE_RE.exec(line);
    if (fence) {
      const marker = fence[2];
      const fenceChar = marker[0] === '~' ? '~' : '`';
      const closeRe = new RegExp(`^ {0,3}${fenceChar}{${marker.length},}[ \\t]*$`);
      const info = fence[3].trim().split(/\s+/)[0] ?? '';
      const lang = info.replace(/[^\w+#.-]/g, '').slice(0, 20);
      const body: string[] = [];

      i++;
      while (i < lines.length) {
        if (closeRe.test(lines[i])) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }

      ctx.stats.codeBlocks++;
      blocks.push(
        `<pre class="md-code"${lang ? ` data-lang="${escapeAttr(lang)}"` : ''}><code>${escapeHtml(
          body.join('\n')
        )}</code></pre>`
      );
      continue;
    }

    // ATX 标题
    const atx = ATX_LINE_RE.exec(line);
    if (atx) {
      blocks.push(headingHtml(ctx, atx[1].length, (atx[2] ?? '').trim()));
      i++;
      continue;
    }

    // 分隔线
    if (HR_LINE_RE.test(line)) {
      blocks.push('<hr>');
      i++;
      continue;
    }

    // 引用
    if (/^ {0,3}>/.test(line)) {
      const parsed = parseBlockquote(lines, i, ctx);
      blocks.push(parsed.html);
      i = parsed.next;
      continue;
    }

    // 列表
    if (LIST_LINE_RE.test(line)) {
      const parsed = parseList(lines, i, ctx);
      if (parsed) {
        blocks.push(parsed.html);
        i = parsed.next;
        continue;
      }
    }

    // GFM 表格
    if (line.includes('|') && isTableDelimiter(lines[i + 1])) {
      const parsed = parseTable(lines, i, ctx);
      blocks.push(parsed.html);
      i = parsed.next;
      continue;
    }

    // 缩进代码块
    if (/^ {4}/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (isBlank(lines[i]) || /^ {4}/.test(lines[i]))) {
        body.push(lines[i].slice(4));
        i++;
      }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      ctx.stats.codeBlocks++;
      blocks.push(`<pre class="md-code"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // 原始 HTML 块
    if (isHtmlBlockStart(line)) {
      const tagName = /^ {0,3}<([a-zA-Z][\w-]*)/.exec(line)?.[1]?.toLowerCase() ?? '';
      const rawUntilCloseTag = tagName === 'script' || tagName === 'style' || tagName === 'pre';
      const body: string[] = [];

      while (i < lines.length) {
        if (!rawUntilCloseTag && isBlank(lines[i])) break;
        body.push(lines[i]);
        const done = rawUntilCloseTag && new RegExp(`</${tagName}\\s*>`, 'i').test(lines[i]);
        i++;
        if (done) break;
      }

      blocks.push(
        ctx.allowHtml ? sanitizeRawHtml(body.join('\n')) : `<p>${escapeHtml(body.join('\n'))}</p>`
      );
      continue;
    }

    // 段落（下一行是 === / --- 时升级成 setext 标题）
    const paragraph: string[] = [];
    let next = i;
    let setextLevel = 0;

    while (next < lines.length) {
      const candidate = lines[next];
      if (isBlank(candidate)) break;

      if (next > i) {
        const setext = SETEXT_LINE_RE.exec(candidate);
        if (setext && paragraph.length) {
          setextLevel = setext[1][0] === '=' ? 1 : 2;
          next++;
          break;
        }
        if (startsBlock(lines, next)) break;
        if (candidate.includes('|') && isTableDelimiter(lines[next + 1])) break;
      }

      paragraph.push(candidate);
      next++;
    }

    if (setextLevel > 0) {
      blocks.push(headingHtml(ctx, setextLevel, paragraph.join(' ').trim()));
    } else if (paragraph.length) {
      blocks.push(`<p>${renderInline(paragraph.join('\n'), ctx)}</p>`);
    } else {
      // 兜底：保证循环一定前进
      blocks.push(`<p>${renderInline(line, ctx)}</p>`);
      next = i + 1;
    }

    i = next > i ? next : i + 1;
  }

  return blocks.join('\n');
}

// ---------------------------------------------------------------- 入口

function extractReferences(lines: string[]): { lines: string[]; refs: Map<string, Reference> } {
  const refs = new Map<string, Reference>();
  const kept = lines.map((line) => {
    const matched = REFERENCE_RE.exec(line);
    if (!matched) return line;
    refs.set(referenceKey(matched[1]), {
      url: matched[2],
      title: matched[3] ?? matched[4] ?? matched[5] ?? ''
    });
    return '';
  });
  return { lines: kept, refs };
}

function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9_'-]+/g);
  return cjk + (latin?.length ?? 0);
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): MarkdownResult {
  const normalized = source.replace(/\r\n?/g, '\n');
  const extracted = extractReferences(normalized.split('\n'));

  const ctx: Context = {
    refs: extracted.refs,
    stats: {
      chars: source.length,
      words: 0,
      lines: source ? normalized.split('\n').length : 0,
      headings: 0,
      codeBlocks: 0,
      links: 0,
      tables: 0,
      tasks: 0
    },
    headings: [],
    slugs: new Map(),
    breaks: options.breaks ?? false,
    allowHtml: options.allowHtml ?? true
  };

  const html = parseBlocks(extracted.lines, ctx);

  // 字数按「去掉标记后的可见文本」估算，避免把 # * ` 也算进去
  ctx.stats.words = countWords(
    normalized.replace(/^ {0,3}(?:`{3,}|~{3,}).*$/gm, '').replace(/[*_~`#>|-]/g, ' ')
  );

  return { html, stats: ctx.stats, headings: ctx.headings };
}
