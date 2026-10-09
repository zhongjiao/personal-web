import type JSZip from 'jszip';
import {
  attrOf,
  descendants,
  elementChildren,
  escapeHtml,
  firstDescendant,
  firstElement,
  joinedText,
  parseXml,
  textOf
} from '../dom';
import { readZipText, resolvePath } from '../zip';
import type { ConvertProgress } from '../types';

/**
 * Excel（.xlsx / .xlsm）→ HTML。
 *
 * 自己解 OOXML 而不是引 SheetJS：仓库里已经有 jszip，xlsx 需要的
 * `sharedStrings / workbook(+rels) / styles / worksheets` 四个部件解析量不大，
 * 却能少装一个体积不小的依赖，也能按需只输出「表格」这一种形态。
 */

/** 单元格渲染上限：超出就截断并给出提示，避免一个工作表把浏览器拖死 */
const MAX_ROWS = 5000;
const MAX_COLS = 200;
/** 合并区域面积上限：防止「整列合并」这种引用把覆盖集合撑爆 */
const MAX_MERGE_AREA = 20000;

const DATE_NUM_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58
]);

interface CellStyle {
  bold: boolean;
  date: boolean;
  format: string;
}

interface SheetData {
  name: string;
  /** 每行是一组已渲染好的 `<td>` 片段 */
  rows: string[][];
  cols: number[];
  rowCount: number;
  cellCount: number;
  truncated: boolean;
}

export interface XlsxConvertOutput {
  body: string;
  extraCss: string;
  warnings: string[];
  sheetCount: number;
  rowCount: number;
  cellCount: number;
}

function isDateFormat(code: string): boolean {
  const cleaned = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  if (!cleaned) return false;
  if (/^[#0.,%\s]+$/.test(cleaned)) return false;
  return /[ymdhs]/i.test(cleaned);
}

function parseStyles(xml: string | null): CellStyle[] {
  if (!xml) return [];
  const doc = parseXml(xml, 'styles.xml');

  const customFormats = new Map<number, string>();
  for (const numFmt of descendants(doc, 'numFmt')) {
    const id = Number(attrOf(numFmt, 'numFmtId'));
    if (Number.isFinite(id)) customFormats.set(id, attrOf(numFmt, 'formatCode'));
  }

  const fontsContainer = descendants(doc, 'fonts')[0] ?? null;
  const boldByFontId = elementChildren(fontsContainer).map(
    (font) => firstElement(font, 'b') !== null
  );

  const cellXfs = descendants(doc, 'cellXfs')[0] ?? null;
  return elementChildren(cellXfs).map((xf) => {
    const numFmtId = Number(attrOf(xf, 'numFmtId') || '0');
    const fontId = Number(attrOf(xf, 'fontId') || '0');
    const format = customFormats.get(numFmtId) ?? '';
    const date = DATE_NUM_FMT_IDS.has(numFmtId) || (numFmtId >= 164 && isDateFormat(format));
    return { bold: boldByFontId[fontId] ?? false, date, format };
  });
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const doc = parseXml(xml, 'sharedStrings.xml');
  return descendants(doc, 'si').map((si) => joinedText(si, 't'));
}

interface SheetRef {
  name: string;
  path: string;
}

function parseSheetRefs(workbookXml: string, relsXml: string | null): SheetRef[] {
  const doc = parseXml(workbookXml, 'workbook.xml');
  const targets = new Map<string, string>();

  if (relsXml) {
    for (const rel of descendants(parseXml(relsXml, 'workbook.xml.rels'), 'Relationship')) {
      targets.set(attrOf(rel, 'Id'), attrOf(rel, 'Target'));
    }
  }

  const refs: SheetRef[] = [];
  for (const sheet of descendants(doc, 'sheet')) {
    const name = attrOf(sheet, 'name') || `Sheet${refs.length + 1}`;
    const relId = attrOf(sheet, 'r:id') || attrOf(sheet, 'id');
    const target = targets.get(relId);
    if (!target) continue;
    refs.push({ name, path: resolvePath('xl', target) });
  }
  return refs;
}

/** `C12` → `{ col: 2, row: 11 }`（0 基） */
function columnIndex(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0]?.toUpperCase() ?? '';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function rowIndex(ref: string): number {
  const digits = /\d+/.exec(ref)?.[0];
  return digits ? Number(digits) - 1 : 0;
}

function trimNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

/** 套用 Excel 数字格式里最常见的几种：小数位、千分位、百分比、货币 */
function formatNumber(value: number, format: string): string {
  if (!format || /general/i.test(format)) return trimNumber(value);

  const section = format.split(';')[0] ?? '';
  if (!section) return trimNumber(value);

  const cleaned = section.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  const percent = cleaned.includes('%');
  const decimals = /\.(0+)/.exec(cleaned)?.[1]?.length ?? 0;
  const grouped = /[#0],/.test(cleaned);

  let text = (percent ? value * 100 : value).toFixed(decimals);
  if (grouped) {
    const [intPart, fracPart] = text.split('.');
    const sign = intPart.startsWith('-') ? '-' : '';
    const digits = sign ? intPart.slice(1) : intPart;
    text = `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fracPart ? `.${fracPart}` : ''}`;
  }
  if (percent) text += '%';

  // 货币符号可能直接写（¥#,##0）也可能在引号里（"¥"#,##0）
  const literal = /"([^"]{1,3})"/.exec(section)?.[1];
  const currency = /([¥$€£₩₹])/.exec(section)?.[1] ?? literal;
  return currency ? `${currency}${text}` : text;
}

/** Excel 序列号 → 日期。1900 闰年 bug 用「1899-12-30 为起点」抵消（25569 天到 1970-01-01） */
function formatExcelDate(serial: number, format: string): string {
  const date = new Date(Math.round((serial - 25569) * 86400000));
  if (Number.isNaN(date.getTime())) return trimNumber(serial);

  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const cleaned = format.replace(/"[^"]*"/g, '');
  const withTime = /[hs]/i.test(cleaned) || serial % 1 !== 0;
  if (!withTime) return day;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatIsoDate(raw: string): string {
  return raw.replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '');
}

function renderCell(
  cell: Element,
  styles: CellStyle[],
  shared: string[],
  merge: { colspan: number; rowspan: number } | undefined
): string {
  const style = styles[Number(attrOf(cell, 's') || '0')] ?? { bold: false, date: false, format: '' };
  const type = attrOf(cell, 't');
  const raw = textOf(firstElement(cell, 'v'));
  const formula = firstElement(cell, 'f');

  let text = '';
  let extraClass = '';
  let numeric = false;
  let hasValue = true;

  if (type === 'inlineStr') {
    text = joinedText(cell, 't');
  } else if (type === 's') {
    const index = Number(raw);
    text = Number.isFinite(index) ? (shared[index] ?? '') : '';
  } else if (type === 'str') {
    text = raw;
  } else if (type === 'b') {
    text = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
  } else if (type === 'e') {
    text = raw || '#ERROR';
    extraClass = 'fx';
  } else if (type === 'd') {
    text = formatIsoDate(raw);
    numeric = true;
  } else if (raw !== '') {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      text = raw;
    } else if (style.date) {
      text = formatExcelDate(value, style.format);
      numeric = true;
    } else {
      text = formatNumber(value, style.format);
      numeric = true;
    }
  } else if (formula) {
    text = `=${textOf(formula)}`;
    extraClass = 'fx';
  } else {
    hasValue = false;
  }

  const classes = [
    !hasValue ? 'empty' : '',
    numeric && hasValue ? 'num' : '',
    style.bold && hasValue ? 'bold' : '',
    extraClass
  ]
    .filter(Boolean)
    .join(' ');

  const attrs = [
    classes ? ` class="${classes}"` : '',
    merge && merge.colspan > 1 ? ` colspan="${merge.colspan}"` : '',
    merge && merge.rowspan > 1 ? ` rowspan="${merge.rowspan}"` : ''
  ].join('');

  return `<td${attrs}>${escapeHtml(text)}</td>`;
}

function parseSheet(name: string, xml: string, styles: CellStyle[], shared: string[]): SheetData {
  const doc = parseXml(xml, `工作表「${name}」`);
  const sheetData = firstDescendant(doc, 'sheetData');

  const merges = new Map<string, { colspan: number; rowspan: number }>();
  const covered = new Set<string>();

  for (const mergeEl of descendants(doc, 'mergeCell')) {
    const ref = attrOf(mergeEl, 'ref');
    const [start, end] = ref.split(':');
    if (!start || !end) continue;
    const c1 = columnIndex(start);
    const r1 = rowIndex(start);
    const c2 = columnIndex(end);
    const r2 = rowIndex(end);
    if (c1 < 0 || r1 < 0 || c2 < c1 || r2 < r1) continue;
    if ((c2 - c1 + 1) * (r2 - r1 + 1) > MAX_MERGE_AREA) continue;
    if (c1 >= MAX_COLS) continue;

    merges.set(`${r1}:${c1}`, { colspan: c2 - c1 + 1, rowspan: r2 - r1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue;
        covered.add(`${r}:${c}`);
      }
    }
  }

  const cols: number[] = [];
  const colsContainer = firstDescendant(doc, 'cols');
  if (colsContainer) {
    for (const colEl of elementChildren(colsContainer, 'col')) {
      const min = Math.max(1, Number(attrOf(colEl, 'min') || '1'));
      const max = Math.min(MAX_COLS, Number(attrOf(colEl, 'max') || String(min)));
      const width = Number(attrOf(colEl, 'width') || '0');
      const px = width > 0 ? Math.min(900, Math.round(width * 7 + 5)) : 0;
      for (let c = min; c <= max; c++) cols[c - 1] = px;
    }
  }

  const rows: string[][] = [];
  let cellCount = 0;
  let truncated = false;

  for (const rowEl of elementChildren(sheetData, 'row')) {
    if (attrOf(rowEl, 'hidden') === '1') continue;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }

    const position = rowEl.hasAttribute('r') ? rowIndex(attrOf(rowEl, 'r')) : rows.length;
    while (rows.length < position && rows.length < MAX_ROWS) rows.push([]);

    const cells: string[] = [];
    let cursor = 0;

    for (const cellEl of elementChildren(rowEl, 'c')) {
      const ref = attrOf(cellEl, 'r');
      const col = ref ? columnIndex(ref) : cursor;
      cursor = col + 1;
      if (col < 0 || col >= MAX_COLS) {
        truncated = true;
        continue;
      }
      if (covered.has(`${position}:${col}`)) continue;

      while (cells.length < col) cells.push('<td class="empty"></td>');
      cells.push(renderCell(cellEl, styles, shared, merges.get(`${position}:${col}`)));
      cellCount++;
    }

    rows.push(cells);
  }

  // 空行（隐藏行 / 中间的空档）不渲染：`<tr>` 里没有单元格，视觉上本来就是空白
  const visibleRows = rows.filter((row) => row.length > 0);

  return { name, rows: visibleRows, cols, rowCount: visibleRows.length, cellCount, truncated };
}

function renderTable(sheet: SheetData): string {
  const columns = Math.max(sheet.cols.length, sheet.rows.reduce((max, row) => Math.max(max, row.length), 0));

  const colgroup = columns
    ? `<colgroup>${Array.from({ length: columns }, (_, i) => {
        const width = sheet.cols[i] ?? 0;
        return width > 0 ? `<col style="width:${width}px">` : '<col>';
      }).join('')}</colgroup>`
    : '';

  const body = sheet.rows.map((row) => `<tr>${row.join('')}</tr>`).join('\n');
  return `<div class="sheet-wrap"><table class="sheet">${colgroup}<tbody>${body}</tbody></table></div>`;
}

export async function xlsxToHtml(
  zip: JSZip,
  onProgress: (progress: ConvertProgress) => void
): Promise<XlsxConvertOutput> {
  onProgress({ phase: '读取工作簿结构' });

  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  if (!workbookXml) {
    throw new Error(
      '未找到 xl/workbook.xml：这不是有效的 .xlsx 文件（.xls 是旧二进制格式，请先另存为 .xlsx）'
    );
  }

  const [relsXml, stylesXml, sharedXml] = await Promise.all([
    readZipText(zip, 'xl/_rels/workbook.xml.rels'),
    readZipText(zip, 'xl/styles.xml'),
    readZipText(zip, 'xl/sharedStrings.xml')
  ]);

  const styles = parseStyles(stylesXml);
  const shared = parseSharedStrings(sharedXml);
  const refs = parseSheetRefs(workbookXml, relsXml);
  if (!refs.length) throw new Error('工作簿里没有可读的工作表');

  const sheets: SheetData[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < refs.length; i++) {
    onProgress({ phase: `解析工作表 ${i + 1}/${refs.length}`, current: i + 1, total: refs.length });
    const xml = await readZipText(zip, refs[i].path);
    if (!xml) {
      warnings.push(`工作表「${refs[i].name}」缺少数据部件，已跳过`);
      continue;
    }
    const sheet = parseSheet(refs[i].name, xml, styles, shared);
    if (sheet.truncated) {
      warnings.push(
        `工作表「${sheet.name}」超过 ${MAX_ROWS} 行 / ${MAX_COLS} 列，已截断显示`
      );
    }
    sheets.push(sheet);
  }

  if (!sheets.length) throw new Error('没有解析出任何工作表数据');

  const multi = sheets.length > 1;
  const panels = sheets
    .map((sheet) => {
      const note = `<p class="sheet-note">${escapeHtml(sheet.name)} · ${sheet.rowCount} 行 × ${Math.max(
        ...sheet.rows.map((row) => row.length),
        0
      )} 列</p>`;
      const table = sheet.rows.length
        ? renderTable(sheet)
        : '<p class="empty-note">这个工作表是空的</p>';
      return `<div class="panel">${note}${table}</div>`;
    })
    .join('\n');

  const body = multi
    ? [
        '<div class="tabs">',
        ...sheets.map(
          (sheet, index) =>
            `<input type="radio" name="sheet-tab" id="sheet-tab-${index + 1}"${
              index === 0 ? ' checked' : ''
            }><label for="sheet-tab-${index + 1}">${escapeHtml(sheet.name)}</label>`
        ),
        '<div class="panels">',
        panels,
        '</div>',
        '</div>'
      ].join('\n')
    : panels;

  const extraCss = multi
    ? sheets
        .map(
          (_, index) =>
            `.tabs>input:nth-of-type(${index + 1}):checked~.panels>.panel:nth-of-type(${
              index + 1
            }){display:block}`
        )
        .join('\n')
    : '';

  return {
    body,
    extraCss,
    warnings,
    sheetCount: sheets.length,
    rowCount: sheets.reduce((total, sheet) => total + sheet.rowCount, 0),
    cellCount: sheets.reduce((total, sheet) => total + sheet.cellCount, 0)
  };
}
