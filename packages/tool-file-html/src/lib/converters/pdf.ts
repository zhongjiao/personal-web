import type * as PdfjsTypes from 'pdfjs-dist';
import { errorMessage, escapeHtml } from '../dom';
import type { ConvertProgress, PdfOptions } from '../types';

/**
 * PDF → HTML，三种输出方式：
 *
 *  - `image`      逐页渲染到 canvas 再编码成图片。版式最忠实，代价是体积大、文字不可选。
 *  - `positioned` 取 pdf.js 的文本层，把每个文本块按原始坐标绝对定位成真实 DOM，
 *                 字号用 cqw（页面宽度百分比）换算 —— 文字可选可搜索、体积小一个数量级。
 *                 代价：**只还原文字**，图片 / 矢量图形 / 背景色不保留。
 *                 没有文本层的页（扫描页）自动回退成图片，所以图片型 PDF 也不会变空。
 *  - `text`       只取文字，按行重排成纯文本，便于复制与再加工（版式全丢）。
 *
 * 三种模式都只依赖 pdf.js，不换引擎、不联网。
 */

type PdfDocument = Awaited<ReturnType<typeof PdfjsTypes.getDocument>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PdfTextContent = Awaited<ReturnType<PdfPage['getTextContent']>>;
type PdfTextItem = Extract<PdfTextContent['items'][number], { str: string }>;
type PdfTextStyle = PdfTextContent['styles'][string];

export interface PdfConvertOutput {
  body: string;
  pageCount: number;
  renderedPages: number;
  /** 定位模式：文本块数量；纯文本模式：文本行数 */
  textChunkCount: number;
  /** 定位模式：因没有文本层而回退成图片的页数 */
  imageFallbackPages: number;
  /** 纯文本模式：没有文本的页数（多为扫描件） */
  emptyTextPages: number;
  warnings: string[];
}

let pdfjsPromise: Promise<typeof PdfjsTypes> | null = null;

/**
 * pdf.js 体积不小（~1MB），只在真正转换 PDF 时动态加载；
 * worker 用 `?url` 交给打包器处理，运行时同源加载，无需联网。
 */
async function getPdfjs(): Promise<typeof PdfjsTypes> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs as unknown as typeof PdfjsTypes;
    })();
  }
  return pdfjsPromise;
}

/**
 * 注意：pdf.js 会把传入的 ArrayBuffer 以 transferred（detached）方式交给 worker，
 * 因此调用方传入的 buffer 用完即废 —— convertFile 每次都重新 `file.arrayBuffer()`，
 * 所以「换参数重新转换」不受影响。
 */
async function loadDocument(
  data: ArrayBuffer,
  onProgress: (progress: ConvertProgress) => void
): Promise<PdfDocument> {
  const pdfjs = await getPdfjs();
  onProgress({ phase: '解析 PDF 结构' });
  try {
    return await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  } catch (error) {
    if ((error as { name?: string })?.name === 'PasswordException') {
      throw new Error('该 PDF 已加密，需要密码才能打开');
    }
    throw new Error(`PDF 解析失败：${errorMessage(error)}`);
  }
}

function pageLimitOf(pageCount: number, options: PdfOptions): number {
  return options.maxPages > 0 ? Math.min(options.maxPages, pageCount) : pageCount;
}

/** 单页渲染成图片（图片模式与「无文本层」回退共用） */
async function pageImage(
  page: PdfPage,
  options: PdfOptions,
  pageNumber: number,
  pageCount: number
): Promise<string> {
  const viewport = page.getViewport({ scale: options.scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D');

  // PDF 页面默认透明，先铺白底，否则 PNG 会是透明背景、JPEG 会变黑
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport }).promise;

  const src =
    options.format === 'jpeg'
      ? canvas.toDataURL('image/jpeg', options.quality)
      : canvas.toDataURL('image/png');

  return (
    `<figure class="pdf-page"><img alt="第 ${pageNumber} 页" src="${src}">` +
    `<figcaption class="pn">第 ${pageNumber} 页 / 共 ${pageCount} 页</figcaption></figure>`
  );
}

/** 2×3 矩阵相乘：等价于 pdf.js 的 `Util.transform`，自己实现便于在 Node 里单测 */
export function multiplyMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);

function fontFamilyOf(style: PdfTextStyle | undefined): string {
  const family = style?.fontFamily ?? '';
  return GENERIC_FAMILIES.has(family) ? family : 'sans-serif';
}

interface Viewport {
  width: number;
  height: number;
  transform: number[];
}

/**
 * 把一段文本按它在页面上的原始位置摆好。
 *
 * 定位公式与 pdf.js 官方 text layer 一致：
 *   tx = viewport.transform × item.transform（把 PDF 用户坐标转成「左上角为原点」的页面坐标）
 *   angle / fontHeight 从 tx 里取，基线用字体的 ascent 上推到文本框顶部。
 */
export function positionChunk(
  item: PdfTextItem,
  viewport: Viewport,
  style: PdfTextStyle | undefined
): string | null {
  const text = item.str.replace(/\s+$/, '');
  if (!text) return null;

  const tx = multiplyMatrix(viewport.transform, item.transform);
  let angle = Math.atan2(tx[1], tx[0]);
  const vertical = style?.vertical === true;
  if (vertical) angle += Math.PI / 2;

  const fontHeight = Math.hypot(tx[2], tx[3]);
  if (!Number.isFinite(fontHeight) || fontHeight <= 0) return null;

  const ascent = fontHeight * (style?.ascent ?? 0.8);
  let left = tx[4];
  let top = tx[5] - ascent;
  if (angle !== 0) {
    left = tx[4] + ascent * Math.sin(angle);
    top = tx[5] - ascent * Math.cos(angle);
  }

  const css = [
    `left:${((left / viewport.width) * 100).toFixed(4)}%`,
    `top:${((top / viewport.height) * 100).toFixed(4)}%`,
    // 1cqw = 页面宽度的 1%，因此整个页面会随容器等比缩放
    `font-size:${((fontHeight / viewport.width) * 100).toFixed(4)}cqw`,
    `font-family:${fontFamilyOf(style)}`
  ];
  if (angle !== 0) css.push(`transform:rotate(${angle.toFixed(5)}rad)`);
  if (vertical) css.push('writing-mode:vertical-rl');
  if (item.dir === 'rtl') css.push('direction:rtl');

  return `<span class="t" style="${css.join(';')}">${escapeHtml(text)}</span>`;
}

interface PageText {
  items: PdfTextItem[];
  styles: Record<string, PdfTextStyle>;
}

/** 取出一页的文本块（过滤掉没有实际字符的标记项） */
async function textItemsOf(page: PdfPage): Promise<PageText> {
  const content = await page.getTextContent();
  return {
    items: content.items.filter((item): item is PdfTextItem => 'str' in item && item.str.length > 0),
    styles: content.styles as Record<string, PdfTextStyle>
  };
}

/** 用文本块还原「行」：优先用 pdf.js 的 hasEOL，其次用基线跳变判断 */
export function groupTextLines(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let buffer = '';
  let lastY: number | null = null;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const previous = items[index - 1];
    const y = item.transform[5];

    if (lastY !== null && Math.abs(y - lastY) > 2 && buffer) {
      lines.push(buffer);
      buffer = '';
    } else if (previous && buffer && !buffer.endsWith(' ')) {
      // 同一行里两块文字之间的间距够大时补一个空格，避免「词粘在一起」
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      const fontHeight = Math.hypot(item.transform[2], item.transform[3]) || 12;
      if (gap > fontHeight * 0.25) buffer += ' ';
    }

    buffer += item.str;
    lastY = y;

    if (item.hasEOL) {
      lines.push(buffer);
      buffer = '';
      lastY = null;
    }
  }

  if (buffer) lines.push(buffer);
  return lines;
}

function pageNumberHtml(pageNumber: number, pageCount: number, suffix = ''): string {
  return `第 ${pageNumber} 页 / 共 ${pageCount} 页${suffix}`;
}

// ------------------------------------------------------------------ 图片模式

async function pdfToImages(
  data: ArrayBuffer,
  options: PdfOptions,
  onProgress: (progress: ConvertProgress) => void
): Promise<PdfConvertOutput> {
  const doc = await loadDocument(data, onProgress);
  const pageCount = doc.numPages;
  const limit = pageLimitOf(pageCount, options);
  const fixtures: string[] = [];
  const warnings: string[] = [];
  let rendered = 0;

  if (limit < pageCount) {
    warnings.push(`只渲染了前 ${limit} 页（原文件共 ${pageCount} 页），可在左侧调整页数上限`);
  }

  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    onProgress({ phase: '渲染 PDF 页面', current: pageNumber, total: limit });
    try {
      const page = await doc.getPage(pageNumber);
      fixtures.push(await pageImage(page, options, pageNumber, pageCount));
      rendered++;
      page.cleanup();
    } catch (error) {
      warnings.push(`第 ${pageNumber} 页渲染失败：${errorMessage(error)}`);
      fixtures.push(
        `<figure class="pdf-page pdf-page--failed">第 ${pageNumber} 页渲染失败：${errorMessage(error)}</figure>`
      );
    }
  }

  await doc.destroy();
  if (rendered === 0) throw new Error('所有页面都渲染失败，请确认文件是否为有效的 PDF');

  return {
    body: fixtures.join('\n'),
    pageCount,
    renderedPages: rendered,
    textChunkCount: 0,
    imageFallbackPages: 0,
    emptyTextPages: 0,
    warnings
  };
}

// ------------------------------------------------------------- 文本 + 定位模式

async function pdfToPositioned(
  data: ArrayBuffer,
  options: PdfOptions,
  onProgress: (progress: ConvertProgress) => void
): Promise<PdfConvertOutput> {
  const doc = await loadDocument(data, onProgress);
  const pageCount = doc.numPages;
  const limit = pageLimitOf(pageCount, options);
  const pages: string[] = [];
  const warnings: string[] = [];
  let chunks = 0;
  let fallbackPages = 0;

  if (limit < pageCount) {
    warnings.push(`只转换了前 ${limit} 页（原文件共 ${pageCount} 页），可在左侧调整页数上限`);
  }

  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    onProgress({ phase: '提取文本层', current: pageNumber, total: limit });

    try {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await textItemsOf(page);

      if (content.items.length === 0) {
        // 扫描件 / 纯图形页：没有文字可定位，回退成图片，保证这一页不会空着
        fallbackPages++;
        warnings.push(`第 ${pageNumber} 页没有文本层（可能是扫描页），已自动改用图片`);
        pages.push(await pageImage(page, options, pageNumber, pageCount));
        page.cleanup();
        continue;
      }

      const spans: string[] = [];
      for (const item of content.items) {
        const html = positionChunk(item, viewport, content.styles[item.fontName]);
        if (html) spans.push(html);
      }
      chunks += spans.length;

      pages.push(
        `<figure class="pdf-page--text">` +
          `<div class="pdf-layer" style="aspect-ratio:${viewport.width.toFixed(2)}/${viewport.height.toFixed(2)}">` +
          spans.join('') +
          `</div>` +
          `<figcaption class="pn">${pageNumberHtml(pageNumber, pageCount, ' · 文本层')}</figcaption>` +
          `</figure>`
      );
      page.cleanup();
    } catch (error) {
      warnings.push(`第 ${pageNumber} 页处理失败：${errorMessage(error)}`);
    }
  }

  await doc.destroy();
  if (chunks === 0 && fallbackPages === 0) throw new Error('没有取到任何页面内容');

  return {
    body: pages.join('\n'),
    pageCount,
    renderedPages: fallbackPages,
    textChunkCount: chunks,
    imageFallbackPages: fallbackPages,
    emptyTextPages: 0,
    warnings
  };
}

// ------------------------------------------------------------------ 纯文本模式

async function pdfToText(
  data: ArrayBuffer,
  options: PdfOptions,
  onProgress: (progress: ConvertProgress) => void
): Promise<PdfConvertOutput> {
  const doc = await loadDocument(data, onProgress);
  const pageCount = doc.numPages;
  const limit = pageLimitOf(pageCount, options);
  const sections: string[] = [];
  const warnings: string[] = [];
  let lines = 0;
  let emptyPages = 0;

  if (limit < pageCount) {
    warnings.push(`只提取了前 ${limit} 页（原文件共 ${pageCount} 页），可在左侧调整页数上限`);
  }

  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    onProgress({ phase: '提取文字', current: pageNumber, total: limit });

    try {
      const page = await doc.getPage(pageNumber);
      const content = await textItemsOf(page);
      const pageLines = groupTextLines(content.items);
      lines += pageLines.length;

      if (pageLines.length === 0) {
        emptyPages++;
        warnings.push(`第 ${pageNumber} 页没有文本层（可能是扫描页），需要 OCR 才能取到文字`);
        sections.push(
          `<section class="pdf-text-wrap"><div class="pn">${pageNumberHtml(
            pageNumber,
            pageCount
          )}</div><p class="empty-note">这一页没有文本层</p></section>`
        );
      } else {
        sections.push(
          `<section class="pdf-text-wrap"><div class="pn">${pageNumberHtml(
            pageNumber,
            pageCount
          )}</div><pre class="pdf-text">${escapeHtml(pageLines.join('\n'))}</pre></section>`
        );
      }
      page.cleanup();
    } catch (error) {
      warnings.push(`第 ${pageNumber} 页提取失败：${errorMessage(error)}`);
    }
  }

  await doc.destroy();
  if (lines === 0) throw new Error('没有提取到任何文字：这份 PDF 可能整份都是扫描件，请改用「图片」模式');

  return {
    body: sections.join('\n'),
    pageCount,
    renderedPages: 0,
    textChunkCount: lines,
    imageFallbackPages: 0,
    emptyTextPages: emptyPages,
    warnings
  };
}

/** 按 `options.mode` 分发：同一份 PDF 可以出图片、定位文本或纯文本 */
export function convertPdf(
  data: ArrayBuffer,
  options: PdfOptions,
  onProgress: (progress: ConvertProgress) => void
): Promise<PdfConvertOutput> {
  if (options.mode === 'positioned') return pdfToPositioned(data, options, onProgress);
  if (options.mode === 'text') return pdfToText(data, options, onProgress);
  return pdfToImages(data, options, onProgress);
}
