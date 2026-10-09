import { formatBytes } from '@pmp/ui';
import { dataUrl, mimeFromPath, utf8Size } from './dom';
import { buildHtmlDocument } from './html-shell';
import { docxToHtml } from './converters/docx';
import { convertPdf } from './converters/pdf';
import { pptxToHtml } from './converters/pptx';
import { csvToHtml, htmlFileToHtml, imageToHtml, jsonToHtml, plainTextToHtml } from './converters/text';
import { xlsxToHtml } from './converters/xlsx';
import { loadZip } from './zip';
import {
  KIND_LABELS,
  type ConvertKind,
  type ConvertOptions,
  type ConvertProgress,
  type ConvertResult,
  type ConvertStat,
  type ShellLayout
} from './types';

const EXT_KIND: Record<string, ConvertKind> = {
  pdf: 'pdf',
  docx: 'docx',
  docm: 'docx',
  doc: 'doc',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xltx: 'xlsx',
  pptx: 'pptx',
  pptm: 'pptx',
  csv: 'csv',
  tsv: 'csv',
  txt: 'text',
  log: 'text',
  md: 'text',
  markdown: 'text',
  json: 'json',
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  avif: 'image'
};

/** 旧二进制格式：浏览器解析不了，直接给出可行的替代方案 */
const LEGACY_FORMATS: Record<string, { name: string; saveAs: string }> = {
  xls: { name: 'Excel 97-2003 工作簿', saveAs: 'xlsx' },
  xlt: { name: 'Excel 97-2003 模板', saveAs: 'xlsx' },
  ppt: { name: 'PowerPoint 97-2003 演示文稿', saveAs: 'pptx' },
  pps: { name: 'PowerPoint 97-2003 放映文件', saveAs: 'pptx' }
};

export const ACCEPT_ATTRIBUTE = Object.keys(EXT_KIND)
  .map((ext) => `.${ext}`)
  .join(',');

export interface SupportGroup {
  label: string;
  formats: string;
  note: string;
}

export const SUPPORT_GROUPS: SupportGroup[] = [
  {
    label: 'PDF',
    formats: '.pdf',
    note: '三种输出：图片（最忠实）/ 文本+定位（可选可搜索）/ 纯文本；扫描页自动回退为图片'
  },
  { label: 'Word', formats: '.docx / .docm', note: '保留标题、列表、表格与图片' },
  { label: 'Word 旧格式', formats: '.doc', note: '需要本地服务（LibreOffice）先转成 docx' },
  { label: 'Excel', formats: '.xlsx / .xlsm', note: '多工作表页签、合并单元格、数字格式' },
  { label: 'PowerPoint', formats: '.pptx / .pptm', note: '文本、图片、表格按原始坐标还原' },
  { label: '表格 / 文本', formats: '.csv / .tsv / .txt / .json / .md', note: '表格转 HTML 表格，文本按等宽输出' },
  { label: '图片 / 网页', formats: '.png / .jpg / .webp / .svg / .html', note: '图片内联为 data URI，HTML 原样输出' }
];

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function detectKind(fileName: string): ConvertKind | null {
  return EXT_KIND[extensionOf(fileName)] ?? null;
}

/** .doc → docx：复用 diff-api 里现成的 LibreOffice 转换路由 */
async function convertLegacyDoc(
  file: File,
  onProgress: (progress: ConvertProgress) => void
): Promise<{ body: string; warnings: string[] }> {
  onProgress({ phase: '调用本地服务转换 .doc' });

  let response: Response;
  try {
    const form = new FormData();
    form.append('file', file);
    response = await fetch('/api/doc/convert', { method: 'POST', body: form });
  } catch {
    throw new Error(
      '无法连接本地转换服务（servers/diff-api）：请先运行 pnpm dev:server，或把文件另存为 .docx 后再转换'
    );
  }

  if (!response.ok) {
    let message = `本地服务返回 HTTP ${response.status}`;
    try {
      const json = (await response.json()) as { message?: string };
      if (json?.message) message = json.message;
    } catch {
      /* 忽略：保持默认信息 */
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('officedocument.wordprocessingml')) {
    return docxToHtml(await response.arrayBuffer(), onProgress);
  }

  const json = (await response.json().catch(() => null)) as { mode?: string; message?: string } | null;
  if (json?.mode === 'text') {
    throw new Error(
      `本地服务未安装 LibreOffice，只能提取纯文本，无法生成带排版的 HTML${
        json.message ? `：${json.message}` : ''
      }`
    );
  }
  throw new Error('本地服务返回了未知格式');
}

export async function convertFile(
  file: File,
  options: ConvertOptions,
  onProgress: (progress: ConvertProgress) => void
): Promise<ConvertResult> {
  const started = performance.now();
  const ext = extensionOf(file.name);

  const legacy = LEGACY_FORMATS[ext];
  if (legacy) {
    throw new Error(
      `${legacy.name}（.${ext}）是旧二进制格式，浏览器无法直接解析。请用 Office / WPS 另存为 .${legacy.saveAs} 后再转换。`
    );
  }

  const kind = detectKind(file.name);
  if (!kind) {
    throw new Error(
      ext
        ? `暂不支持 .${ext} 格式：支持 PDF / Word / Excel / PowerPoint / CSV / 文本 / 图片 / HTML`
        : '无法识别文件类型，请确认文件名带扩展名'
    );
  }

  onProgress({ phase: '读取文件' });

  const title = file.name;
  const stats: ConvertStat[] = [{ label: '原文件', value: formatBytes(file.size) }];
  const warnings: string[] = [];
  let body = '';
  let layout: ShellLayout = 'doc';
  let extraCss = '';
  let meta = KIND_LABELS[kind];
  let htmlOverride: string | null = null;

  switch (kind) {
    case 'pdf': {
      const output = await convertPdf(await file.arrayBuffer(), options.pdf, onProgress);
      body = output.body;
      layout = 'plain';
      warnings.push(...output.warnings);
      stats.push({ label: '页数', value: `${output.pageCount}` });

      if (options.pdf.mode === 'image') {
        stats.push({ label: '已渲染', value: `${output.renderedPages} 页` });
        meta = `PDF · 图片 · ${output.renderedPages}/${output.pageCount} 页 · ${options.pdf.scale}x · ${
          options.pdf.format === 'jpeg' ? 'JPEG' : 'PNG'
        }`;
      } else if (options.pdf.mode === 'positioned') {
        stats.push({ label: '文本块', value: `${output.textChunkCount}` });
        if (output.imageFallbackPages > 0) {
          stats.push({ label: '回退为图片', value: `${output.imageFallbackPages} 页` });
        }
        warnings.push(
          '「文本 + 定位」只还原文字与坐标：PDF 里的图片、矢量图形与背景色不会保留，需要完整视觉请改用「图片」方式'
        );
        meta = `PDF · 文本层定位 · ${output.pageCount} 页 · ${output.textChunkCount} 个文本块`;
      } else {
        stats.push({ label: '文本行', value: `${output.textChunkCount}` });
        if (output.emptyTextPages > 0) {
          stats.push({ label: '无文本页', value: `${output.emptyTextPages} 页` });
        }
        warnings.push('「纯文本」不保留版式：多栏、表格、图片与字体样式都会丢失');
        meta = `PDF · 纯文本 · ${output.pageCount} 页 · ${output.textChunkCount} 行`;
      }
      break;
    }

    case 'docx': {
      const output = await docxToHtml(await file.arrayBuffer(), onProgress);
      body = output.body;
      warnings.push(...output.warnings);
      break;
    }

    case 'doc': {
      const output = await convertLegacyDoc(file, onProgress);
      body = output.body;
      warnings.push(...output.warnings);
      warnings.push('旧版 .doc 由本地 LibreOffice 转换，复杂版式可能与原稿略有出入');
      meta = 'Word 97-2003（经 LibreOffice → docx → HTML）';
      break;
    }

    case 'xlsx': {
      const zip = await loadZip(await file.arrayBuffer());
      const output = await xlsxToHtml(zip, onProgress);
      body = output.body;
      extraCss = output.extraCss;
      layout = 'wide';
      warnings.push(...output.warnings);
      stats.push({ label: '工作表', value: `${output.sheetCount}` });
      stats.push({ label: '行数', value: `${output.rowCount}` });
      stats.push({ label: '单元格', value: `${output.cellCount}` });
      meta = `Excel · ${output.sheetCount} 个工作表 · ${output.rowCount} 行`;
      break;
    }

    case 'pptx': {
      const zip = await loadZip(await file.arrayBuffer());
      const output = await pptxToHtml(zip, onProgress);
      body = output.body;
      extraCss = output.extraCss;
      layout = 'deck';
      warnings.push(...output.warnings);
      stats.push({ label: '幻灯片', value: `${output.slideCount}` });
      stats.push({ label: '文本框', value: `${output.textShapeCount}` });
      stats.push({ label: '图片', value: `${output.imageCount}` });
      meta = `PowerPoint · ${output.slideCount} 张幻灯片`;
      break;
    }

    case 'csv': {
      const text = await file.text();
      const output = csvToHtml(text);
      body = output.body;
      layout = 'wide';
      warnings.push(...output.warnings);
      stats.push({ label: '行数', value: `${output.rows}` });
      stats.push({ label: '列数', value: `${output.cols}` });
      meta = `表格 · ${output.rows} 行 × ${output.cols} 列`;
      break;
    }

    case 'text': {
      body = plainTextToHtml(await file.text());
      if (ext === 'md' || ext === 'markdown') {
        warnings.push('Markdown 按纯文本呈现，未做 Markdown 渲染');
      }
      meta = '文本';
      break;
    }

    case 'json': {
      const output = jsonToHtml(await file.text());
      body = output.body;
      warnings.push(...output.warnings);
      meta = 'JSON · 已格式化';
      break;
    }

    case 'image': {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = mimeFromPath(file.name) ?? 'application/octet-stream';
      body = imageToHtml(dataUrl(mime, bytes), file.name);
      break;
    }

    case 'html': {
      const output = htmlFileToHtml(await file.text());
      htmlOverride = output.html;
      warnings.push(...output.warnings);
      break;
    }
  }

  const html = htmlOverride ?? buildHtmlDocument({ title, body, layout, extraCss, meta });
  const bytes = utf8Size(html);

  stats.push({ label: 'HTML 大小', value: formatBytes(bytes) });
  stats.push({ label: '耗时', value: `${((performance.now() - started) / 1000).toFixed(2)} s` });

  if (bytes > 8 * 1024 * 1024) {
    warnings.push(
      '生成的 HTML 超过 8MB，下载与分享都会偏慢：PDF 可降低渲染倍率，截图类文件建议改用 PNG/JPEG'
    );
  }

  return {
    kind,
    title,
    html,
    bytes,
    stats,
    warnings,
    durationMs: performance.now() - started
  };
}
