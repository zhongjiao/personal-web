import { escapeHtml } from '../dom';

/**
 * 轻量文本类格式：CSV / TSV、纯文本、JSON、图片、以及本来就是 HTML 的文件。
 * 都不需要额外依赖，顺手支持，覆盖「预览性文件」里剩下的常见几类。
 */

const MAX_ROWS = 5000;
const MAX_COLS = 200;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** RFC 4180 风格：支持引号包裹、字段内换行、`""` 转义 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }

  return rows;
}

export interface CsvConvertOutput {
  body: string;
  warnings: string[];
  rows: number;
  cols: number;
}

export function csvToHtml(source: string): CsvConvertOutput {
  const text = stripBom(source);
  if (!text.trim()) throw new Error('文件是空的');

  const delimiter = detectDelimiter(text);
  const all = parseDelimited(text, delimiter);
  const warnings: string[] = [];
  const truncated = all.length > MAX_ROWS;
  const rows = all.slice(0, MAX_ROWS);

  if (truncated) warnings.push(`表格超过 ${MAX_ROWS} 行，只导出了前 ${MAX_ROWS} 行`);

  const width = rows.reduce((max, row) => Math.max(max, Math.min(row.length, MAX_COLS)), 0);
  const [header, ...rest] = rows;

  const headHtml = `<thead><tr>${header
    .slice(0, MAX_COLS)
    .map((cell) => `<th>${escapeHtml(cell)}</th>`)
    .join('')}</tr></thead>`;

  const bodyHtml = rest
    .map(
      (row) =>
        `<tr>${Array.from({ length: width }, (_, index) => {
          const value = row[index] ?? '';
          return `<td${value === '' ? ' class="empty"' : ''}>${escapeHtml(value)}</td>`;
        }).join('')}</tr>`
    )
    .join('\n');

  if (delimiter !== ',') {
    warnings.push(`按「${delimiter === '\t' ? 'Tab' : delimiter}」作为分隔符解析`);
  }

  return {
    body: `<div class="sheet-wrap"><table class="sheet">${headHtml}<tbody>${bodyHtml}</tbody></table></div>`,
    warnings,
    rows: rows.length,
    cols: width
  };
}

export function plainTextToHtml(source: string): string {
  const text = stripBom(source);
  return `<pre class="plain-text">${escapeHtml(text)}</pre>`;
}

export interface JsonConvertOutput {
  body: string;
  warnings: string[];
}

export function jsonToHtml(source: string): JsonConvertOutput {
  const text = stripBom(source);
  try {
    const formatted = JSON.stringify(JSON.parse(text), null, 2);
    return { body: `<pre class="plain-text">${escapeHtml(formatted)}</pre>`, warnings: [] };
  } catch {
    return {
      body: `<pre class="plain-text">${escapeHtml(text)}</pre>`,
      warnings: ['JSON 解析失败，已按原文输出']
    };
  }
}

export function imageToHtml(dataUrl: string, name: string): string {
  return `<figure class="figure"><img alt="${escapeHtml(name)}" src="${dataUrl}"><figcaption>${escapeHtml(
    name
  )}</figcaption></figure>`;
}

export interface HtmlFileOutput {
  html: string;
  warnings: string[];
}

/** 本来就是 HTML：原样输出，不重新排版（保留原有样式与脚本） */
export function htmlFileToHtml(source: string): HtmlFileOutput {
  if (!source.trim()) throw new Error('HTML 文件是空的');
  return {
    html: source,
    warnings: ['原文件本身就是 HTML，已原样输出（样式与脚本保持原样，未重新包装）']
  };
}
