import type JSZip from 'jszip';
import {
  attrOf,
  dataUrl,
  descendants,
  elementChildren,
  escapeHtml,
  firstDescendant,
  mimeFromPath,
  parseXml
} from '../dom';
import { dirOf, readZipBytes, readZipText, resolvePath } from '../zip';
import type { ConvertProgress } from '../types';

/**
 * PowerPoint（.pptx）→ HTML。
 *
 * 思路和 xlsx 一样：直接读 OOXML，把每张幻灯片还原成「按百分比绝对定位的文本框」。
 * 定位用百分比、字号用 cqw（容器宽度的 1%），所以整张幻灯片会随窗口等比缩放，
 * 既不需要固定像素宽，也不需要一行 JS。
 *
 * 明确不做：母版 / 版式上的装饰图、图表（c:chart）、SmartArt、音视频、动画与切换。
 * 这些要么是动态对象、要么依赖完整渲染引擎，静态 HTML 无法忠实呈现，会在提示里说明。
 */

const EMU_PER_POINT = 12700;
const DEFAULT_SLIDE_CX = 12192000; // 16:9 · 13.33in
const DEFAULT_SLIDE_CY = 6858000;
const DEFAULT_BODY_PT = 18;
const DEFAULT_TITLE_PT = 32;
const DEFAULT_COLOR = '#202124';
const LIGHT_TEXT = '#f2f4f7';

/** 背景是纯色时粗略判断深浅：深底浅字，避免「深色主题」整段文字看不见 */
function isDarkBackground(background: string): boolean {
  const match = /#([0-9a-fA-F]{6})/.exec(background);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

const SHAPE_TAGS = ['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'];

interface Xfrm {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

const IDENTITY: Xfrm = { ox: 0, oy: 0, sx: 1, sy: 1 };

interface SlideContext {
  zip: JSZip;
  /** rels 所属部件所在目录：图片等相对引用基于它解析 */
  baseDir: string;
  rels: Map<string, string>;
  slideCx: number;
  slideCy: number;
  /** 1pt 等于多少 cqw */
  cqwPerPt: number;
  /** 版式里各占位符的默认字号（pt），key 形如 `title:0` / `body:1` */
  layoutSizes: Map<string, number>;
  mediaCache: Map<string, string | null>;
  unsupported: Map<string, number>;
  /** 未显式指定颜色时的兜底字色：按幻灯片背景深浅取深色 / 浅色，避免深底黑字看不清 */
  defaultColor: string;
}

export interface PptxConvertOutput {
  body: string;
  extraCss: string;
  warnings: string[];
  slideCount: number;
  textShapeCount: number;
  imageCount: number;
}

function localNameOf(node: Element): string {
  return node.localName || node.nodeName.split(':').pop() || node.nodeName;
}

function childrenOf(node: Element | Document | null, localName: string): Element[] {
  return elementChildren(node).filter((child) => localNameOf(child) === localName);
}

function firstChildOf(node: Element | Document | null, localName: string): Element | null {
  return childrenOf(node, localName)[0] ?? null;
}

function parseRels(xml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of descendants(parseXml(xml, 'rels'), 'Relationship')) {
    map.set(attrOf(rel, 'Id'), attrOf(rel, 'Target'));
  }
  return map;
}

function normalizeColor(value: string): string | null {
  const hex = value.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length === 6) return `#${hex.toLowerCase()}`;
  if (hex.length === 8) return `#${hex.slice(0, 6).toLowerCase()}`;
  return null;
}

/** 从任意节点里取 `a:srgbClr`（节点本身是 srgbClr 时直接取） */
function srgbOf(node: Element | null): string | null {
  if (!node) return null;
  if (localNameOf(node) === 'srgbClr') return normalizeColor(attrOf(node, 'val'));
  const found = firstDescendant(node, 'a:srgbClr');
  return found ? normalizeColor(attrOf(found, 'val')) : null;
}

function runColor(rPr: Element | null, ctx: SlideContext): string {
  const fromFill = srgbOf(firstChildOf(rPr, 'solidFill'));
  if (fromFill) return fromFill;

  const sys = firstChildOf(rPr, 'sysClr');
  if (sys) return normalizeColor(attrOf(sys, 'lastClr')) ?? ctx.defaultColor;

  const highlight = srgbOf(firstChildOf(rPr, 'highlight'));
  if (highlight) return highlight;

  // 主题色（schemeClr）没做映射，这里按背景深浅兜底，至少不会出现「深底深字」
  return ctx.defaultColor;
}

function emuToCqw(emu: number, totalEmu: number): number {
  return (emu / totalEmu) * 100;
}

function ptToCqw(pt: number, cqwPerPt: number): string {
  return `${Number((pt * cqwPerPt).toFixed(3))}cqw`;
}

/** `<a:xfrm>` + 组合（grpSp）子坐标系换算 */
function childTransform(grpSpPr: Element | null, parent: Xfrm): Xfrm {
  const xfrm = firstChildOf(grpSpPr, 'xfrm');
  if (!xfrm) return parent;

  const off = firstChildOf(xfrm, 'off');
  const ext = firstChildOf(xfrm, 'ext');
  const chOff = firstChildOf(xfrm, 'chOff');
  const chExt = firstChildOf(xfrm, 'chExt');
  if (!off || !ext || !chOff || !chExt) return parent;

  const sx = Number(attrOf(ext, 'cx')) / Math.max(1, Number(attrOf(chExt, 'cx')));
  const sy = Number(attrOf(ext, 'cy')) / Math.max(1, Number(attrOf(chExt, 'cy')));
  const ox = Number(attrOf(off, 'x')) - Number(attrOf(chOff, 'x')) * sx;
  const oy = Number(attrOf(off, 'y')) - Number(attrOf(chOff, 'y')) * sy;

  return {
    ox: parent.ox + ox * parent.sx,
    oy: parent.oy + oy * parent.sy,
    sx: sx * parent.sx,
    sy: sy * parent.sy
  };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
}

function shapeBox(
  xfrm: Element | null,
  t: Xfrm,
  slideCx: number,
  slideCy: number
): Box | null {
  if (!xfrm) return null;
  const off = firstChildOf(xfrm, 'off');
  const ext = firstChildOf(xfrm, 'ext');
  if (!off || !ext) return null;

  return {
    left: emuToCqw(Number(attrOf(off, 'x')) * t.sx + t.ox, slideCx),
    top: emuToCqw(Number(attrOf(off, 'y')) * t.sy + t.oy, slideCy),
    width: emuToCqw(Number(attrOf(ext, 'cx')) * t.sx, slideCx),
    height: emuToCqw(Number(attrOf(ext, 'cy')) * t.sy, slideCy),
    rotate: Number(attrOf(xfrm, 'rot') || '0') / 60000
  };
}

function boxStyle(box: Box, extra = ''): string {
  const parts = [
    `left:${box.left.toFixed(3)}%`,
    `top:${box.top.toFixed(3)}%`,
    `width:${Math.max(0.2, box.width).toFixed(3)}%`,
    `height:${Math.max(0.2, box.height).toFixed(3)}%`
  ];
  if (box.rotate) parts.push(`transform:rotate(${box.rotate.toFixed(2)}deg)`);
  if (extra) parts.push(extra);
  return parts.join(';');
}

function placeholderKey(shape: Element): string | null {
  const ph = firstDescendant(shape, 'p:ph');
  if (!ph) return null;
  return `${attrOf(ph, 'type') || 'body'}:${attrOf(ph, 'idx') || '0'}`;
}

function runPt(rPr: Element | null): number | null {
  const sz = Number(attrOf(rPr, 'sz') || '0');
  return sz > 0 ? sz / 100 : null;
}

function runStyle(rPr: Element | null, ctx: SlideContext, fallbackPt: number, fontScale: number): string {
  const pt = (runPt(rPr) ?? fallbackPt) * fontScale;
  const parts = [`font-size:${ptToCqw(pt, ctx.cqwPerPt)}`, `color:${runColor(rPr, ctx)}`];
  if (attrOf(rPr, 'b') === '1') parts.push('font-weight:700');
  if (attrOf(rPr, 'i') === '1') parts.push('font-style:italic');
  const underline = attrOf(rPr, 'u');
  if (underline && underline !== 'none') parts.push('text-decoration:underline');
  return parts.join(';');
}

/** 段落：对齐 / 缩进 / 项目符号 / 段间距 + 各行内 run */
function paragraphHtml(
  paragraph: Element,
  ctx: SlideContext,
  fallbackPt: number,
  fontScale: number,
  autoNumber: { value: number }
): string {
  const pPr = firstChildOf(paragraph, 'pPr');
  const defRPr = firstChildOf(pPr, 'defRPr');
  const align = attrOf(pPr, 'algn');
  const lvl = Number(attrOf(pPr, 'lvl') || '0');
  const marL = Number(attrOf(pPr, 'marL') || '0');

  const parts: string[] = [];
  if (align === 'ctr') parts.push('text-align:center');
  else if (align === 'r') parts.push('text-align:right');
  else if (align === 'just') parts.push('text-align:justify');

  if (marL > 0) parts.push(`padding-left:${emuToCqw(marL, ctx.slideCx).toFixed(3)}cqw`);
  if (lvl > 0) parts.push(`margin-left:${(lvl * 4).toFixed(1)}%`);

  const before = Number(attrOf(firstChildOf(firstChildOf(pPr, 'spcBef'), 'spcPts'), 'val') || '0') / 100;
  const after = Number(attrOf(firstChildOf(firstChildOf(pPr, 'spcAft'), 'spcPts'), 'val') || '0') / 100;
  if (before > 0) parts.push(`margin-top:${ptToCqw(before * fontScale, ctx.cqwPerPt)}`);
  if (after > 0) parts.push(`margin-bottom:${ptToCqw(after * fontScale, ctx.cqwPerPt)}`);

  const buChar = firstChildOf(pPr, 'buChar');
  const buAutoNum = firstChildOf(pPr, 'buAutoNum');
  const buNone = firstChildOf(pPr, 'buNone');
  let bullet = '';
  if (buChar) bullet = attrOf(buChar, 'char') || '•';
  else if (buAutoNum) {
    autoNumber.value += 1;
    bullet = `${autoNumber.value}.`;
  } else if (!buNone && (marL > 0 || lvl > 0)) {
    // 版式里定义的列表符号读不到，这里按缩进给一个最保守的圆点
    bullet = '•';
  }

  const runs: string[] = [];
  let maxPt = 0;

  for (const node of elementChildren(paragraph)) {
    const local = localNameOf(node);
    if (local === 'br') {
      runs.push('<br>');
      continue;
    }
    if (local !== 'r' && local !== 'fld') continue;

    const text = descendants(node, 'a:t')
      .map((item) => item.textContent ?? '')
      .join('');
    if (!text) continue;

    const rPr = firstChildOf(node, 'rPr') ?? defRPr;
    maxPt = Math.max(maxPt, (runPt(rPr) ?? fallbackPt) * fontScale);
    runs.push(
      `<span style="${runStyle(rPr, ctx, fallbackPt, fontScale)}">${escapeHtml(text).replace(/\n/g, '<br>')}</span>`
    );
  }

  if (!runs.length) return '';

  const sizePt = maxPt || (runPt(defRPr) ?? fallbackPt) * fontScale;
  const style = [`font-size:${ptToCqw(sizePt, ctx.cqwPerPt)}`, ...parts].join(';');
  const bulletHtml = bullet
    ? `<span style="font-size:${ptToCqw(sizePt, ctx.cqwPerPt)}">${escapeHtml(bullet)}</span>`
    : '';

  return `<p style="${style}">${bulletHtml}${runs.join('')}</p>`;
}

function textBodyHtml(
  txBody: Element | null,
  ctx: SlideContext,
  fallbackPt: number
): { html: string; fontScale: number } {
  if (!txBody) return { html: '', fontScale: 1 };

  const bodyPr = firstChildOf(txBody, 'bodyPr');
  const normAutofit = firstChildOf(bodyPr, 'normAutofit');
  const rawScale = Number(attrOf(normAutofit, 'fontScale') || '0');
  const fontScale = rawScale > 0 ? rawScale / 100000 : 1;

  const autoNumber = { value: 0 };
  const paragraphs: string[] = [];
  for (const paragraph of childrenOf(txBody, 'p')) {
    const html = paragraphHtml(paragraph, ctx, fallbackPt, fontScale, autoNumber);
    if (html) paragraphs.push(html);
  }

  return { html: paragraphs.join(''), fontScale };
}

function insetStyle(bodyPr: Element | null, ctx: SlideContext): string {
  if (!bodyPr) return '';
  const l = Number(attrOf(bodyPr, 'lIns') || '91440');
  const t = Number(attrOf(bodyPr, 'tIns') || '45720');
  const r = Number(attrOf(bodyPr, 'rIns') || '91440');
  const b = Number(attrOf(bodyPr, 'bIns') || '45720');
  return `padding:${emuToCqw(t, ctx.slideCy).toFixed(3)}cqw ${emuToCqw(r, ctx.slideCx).toFixed(3)}cqw ${emuToCqw(
    b,
    ctx.slideCy
  ).toFixed(3)}cqw ${emuToCqw(l, ctx.slideCx).toFixed(3)}cqw`;
}

function anchorStyle(bodyPr: Element | null): string {
  const anchor = attrOf(bodyPr, 'anchor');
  if (anchor === 'ctr') return 'justify-content:center';
  if (anchor === 'b') return 'justify-content:flex-end';
  return 'justify-content:flex-start';
}

async function imageDataUrl(
  ctx: SlideContext,
  relId: string,
  baseDir: string
): Promise<string | null> {
  const target = ctx.rels.get(relId);
  if (!target) return null;

  const path = resolvePath(baseDir, target);
  const cached = ctx.mediaCache.get(path);
  if (cached !== undefined) return cached;

  const bytes = await readZipBytes(ctx.zip, path);
  const mime = mimeFromPath(path);
  const url = bytes && mime ? dataUrl(mime, bytes) : null;
  ctx.mediaCache.set(path, url);
  return url;
}

function noteUnsupported(ctx: SlideContext, key: string): void {
  ctx.unsupported.set(key, (ctx.unsupported.get(key) ?? 0) + 1);
}

interface RenderStats {
  textShapes: number;
  images: number;
}

function renderTable(table: Element, ctx: SlideContext): string {
  const rows: string[] = [];
  for (const row of childrenOf(table, 'tr')) {
    const cells: string[] = [];
    for (const cell of childrenOf(row, 'tc')) {
      const text = textBodyHtml(firstChildOf(cell, 'txBody'), ctx, DEFAULT_BODY_PT).html;
      const color = srgbOf(firstDescendant(firstChildOf(cell, 'tcPr'), 'a:solidFill'));
      cells.push(`<td${color ? ` style="background:${color}"` : ''}>${text}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return rows.join('');
}

async function renderShape(
  shape: Element,
  ctx: SlideContext,
  transform: Xfrm,
  stats: RenderStats
): Promise<string> {
  const local = localNameOf(shape);

  if (local === 'grpSp') {
    const inner: string[] = [];
    const childXfrm = childTransform(firstChildOf(shape, 'grpSpPr'), transform);
    for (const child of elementChildren(shape)) {
      if (!SHAPE_TAGS.includes(localNameOf(child))) continue;
      inner.push(await renderShape(child, ctx, childXfrm, stats));
    }
    return inner.join('');
  }

  if (local === 'graphicFrame') {
    if (firstDescendant(shape, 'c:chart')) {
      noteUnsupported(ctx, '图表（chart）');
      return '';
    }
    if (firstDescendant(shape, 'dgm:relIds')) {
      noteUnsupported(ctx, 'SmartArt 图示');
      return '';
    }

    const table = firstDescendant(shape, 'a:tbl');
    const box = shapeBox(firstChildOf(shape, 'xfrm'), transform, ctx.slideCx, ctx.slideCy);
    if (!table || !box) return '';
    return `<div class="shape" style="${boxStyle(box)}"><table>${renderTable(table, ctx)}</table></div>`;
  }

  if (local === 'pic') {
    if (firstDescendant(shape, 'a:videoFile') || firstDescendant(shape, 'p14:media')) {
      noteUnsupported(ctx, '视频 / 音频');
      return '';
    }

    const spPr = firstChildOf(shape, 'spPr');
    const box = shapeBox(firstChildOf(spPr, 'xfrm'), transform, ctx.slideCx, ctx.slideCy);
    const blip = firstDescendant(shape, 'a:blip');
    if (!box || !blip) return '';

    const url = await imageDataUrl(ctx, attrOf(blip, 'r:embed'), ctx.baseDir);
    if (!url) {
      noteUnsupported(ctx, '无法解析的图片');
      return '';
    }

    stats.images += 1;
    return `<div class="shape" style="${boxStyle(box)}"><img alt="" src="${url}"></div>`;
  }

  if (local !== 'sp' && local !== 'cxnSp') return '';

  const spPr = firstChildOf(shape, 'spPr');
  const box = shapeBox(firstChildOf(spPr, 'xfrm'), transform, ctx.slideCx, ctx.slideCy);
  if (!box) return '';

  const txBody = firstChildOf(shape, 'txBody');
  const bodyPr = firstChildOf(txBody, 'bodyPr');

  // 占位符常常不写字号，靠版式继承：标题和正文的默认字号差很多，必须补上
  const key = placeholderKey(shape);
  const isTitle = key?.startsWith('title') || key?.startsWith('ctrTitle');
  const fallbackPt =
    (key ? ctx.layoutSizes.get(key) : undefined) ??
    (isTitle ? ctx.layoutSizes.get('title:*') ?? DEFAULT_TITLE_PT : DEFAULT_BODY_PT);

  const { html: text } = textBodyHtml(txBody, ctx, fallbackPt);
  if (text) stats.textShapes += 1;

  // 没有文字但有纯色填充的图形（色块 / 分隔条）也要画，否则版面会塌
  const fill = srgbOf(firstChildOf(spPr, 'solidFill'));
  if (!text && !fill) return '';

  const inner = text
    ? `<div class="tb" style="${anchorStyle(bodyPr)};${insetStyle(bodyPr, ctx)}">${text}</div>`
    : '';

  return `<div class="shape" style="${boxStyle(box, fill ? `background:${fill}` : '')}">${inner}</div>`;
}

/** 版式里各占位符的默认字号 */
async function loadLayoutSizes(
  zip: JSZip,
  rels: Map<string, string>,
  slideDir: string
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  const target = [...rels.values()].find((value) => value.includes('slideLayout'));
  if (!target) return sizes;

  const layoutPath = resolvePath(slideDir, target);
  const xml = await readZipText(zip, layoutPath);
  if (!xml) return sizes;

  const doc = parseXml(xml, 'slideLayout.xml');
  for (const shape of descendants(doc, 'p:sp')) {
    const key = placeholderKey(shape);
    if (!key) continue;
    const defRPr = firstDescendant(
      firstDescendant(firstChildOf(shape, 'txBody'), 'a:lstStyle'),
      'a:defRPr'
    );
    const sz = Number(attrOf(defRPr, 'sz') || '0');
    if (sz > 0) sizes.set(key, sz / 100);
  }

  const titleSize =
    Number(
      attrOf(
        firstDescendant(firstDescendant(firstDescendant(doc, 'p:titleStyle'), 'a:lvl1pPr'), 'a:defRPr'),
        'sz'
      ) || '0'
    ) / 100;
  if (titleSize > 0) {
    sizes.set('title:*', titleSize);
    sizes.set('ctrTitle:*', titleSize);
  }

  return sizes;
}

/** 背景：幻灯片 → 版式 → 母版，只处理纯色与幻灯片自身的图片背景 */
async function resolveBackground(
  zip: JSZip,
  slideDoc: Document,
  rels: Map<string, string>,
  slideDir: string
): Promise<string> {
  const own = firstDescendant(slideDoc, 'p:bg');
  const ownSolid = srgbOf(firstDescendant(own, 'a:srgbClr'));
  if (ownSolid) return `background:${ownSolid}`;

  const ownBlip = firstDescendant(own, 'a:blip');
  if (ownBlip) {
    const target = rels.get(attrOf(ownBlip, 'r:embed'));
    if (target) {
      const path = resolvePath(slideDir, target);
      const bytes = await readZipBytes(zip, path);
      const mime = mimeFromPath(path);
      if (bytes && mime) {
        return `background-image:url(${dataUrl(mime, bytes)});background-size:cover;background-position:center`;
      }
    }
  }

  const layoutTarget = [...rels.values()].find((value) => value.includes('slideLayout'));
  if (!layoutTarget) return '';

  const layoutPath = resolvePath(slideDir, layoutTarget);
  const layoutXml = await readZipText(zip, layoutPath);
  if (!layoutXml) return '';

  const layoutDoc = parseXml(layoutXml, 'slideLayout.xml');
  const layoutSolid = srgbOf(firstDescendant(firstDescendant(layoutDoc, 'p:bg'), 'a:srgbClr'));
  if (layoutSolid) return `background:${layoutSolid}`;

  const layoutRels = parseRels(
    await readZipText(zip, `${dirOf(layoutPath)}/_rels/${layoutPath.split('/').pop()}.rels`)
  );
  const masterTarget = [...layoutRels.values()].find((value) => value.includes('slideMaster'));
  if (!masterTarget) return '';

  const masterPath = resolvePath(dirOf(layoutPath), masterTarget);
  const masterXml = await readZipText(zip, masterPath);
  if (!masterXml) return '';

  const masterSolid = srgbOf(firstDescendant(firstDescendant(parseXml(masterXml, 'slideMaster.xml'), 'p:bg'), 'a:srgbClr'));
  return masterSolid ? `background:${masterSolid}` : '';
}

export async function pptxToHtml(
  zip: JSZip,
  onProgress: (progress: ConvertProgress) => void
): Promise<PptxConvertOutput> {
  onProgress({ phase: '读取演示文稿结构' });

  const presentationXml = await readZipText(zip, 'ppt/presentation.xml');
  if (!presentationXml) {
    throw new Error(
      '未找到 ppt/presentation.xml：这不是有效的 .pptx 文件（.ppt 是旧二进制格式，请先另存为 .pptx）'
    );
  }

  const doc = parseXml(presentationXml, 'presentation.xml');
  const sizeNode = firstDescendant(doc, 'p:sldSz');
  const slideCx = Number(attrOf(sizeNode, 'cx') || String(DEFAULT_SLIDE_CX));
  const slideCy = Number(attrOf(sizeNode, 'cy') || String(DEFAULT_SLIDE_CY));

  const presRels = parseRels(await readZipText(zip, 'ppt/_rels/presentation.xml.rels'));
  const slidePaths: string[] = [];
  for (const sldId of descendants(doc, 'p:sldId')) {
    const target = presRels.get(attrOf(sldId, 'r:id'));
    if (target) slidePaths.push(resolvePath('ppt', target));
  }
  if (!slidePaths.length) throw new Error('演示文稿里没有幻灯片');

  const slides: string[] = [];
  const warnings: string[] = [];
  const stats: RenderStats = { textShapes: 0, images: 0 };
  const unsupportedTotal = new Map<string, number>();

  for (let index = 0; index < slidePaths.length; index++) {
    onProgress({ phase: '还原幻灯片', current: index + 1, total: slidePaths.length });

    const path = slidePaths[index];
    const xml = await readZipText(zip, path);
    if (!xml) {
      warnings.push(`第 ${index + 1} 张幻灯片缺少数据部件，已跳过`);
      continue;
    }

    const slideDoc = parseXml(xml, `幻灯片 ${index + 1}`);
    const baseDir = dirOf(path);
    const rels = parseRels(await readZipText(zip, `${baseDir}/_rels/${path.split('/').pop()}.rels`));

    const background = await resolveBackground(zip, slideDoc, rels, baseDir);

    const ctx: SlideContext = {
      zip,
      baseDir,
      rels,
      slideCx,
      slideCy,
      cqwPerPt: 100 / (slideCx / EMU_PER_POINT),
      layoutSizes: await loadLayoutSizes(zip, rels, baseDir),
      mediaCache: new Map(),
      unsupported: new Map(),
      defaultColor: isDarkBackground(background) ? LIGHT_TEXT : DEFAULT_COLOR
    };

    // 按文档顺序渲染，保证叠放次序与幻灯片一致
    const shapes: string[] = [];
    for (const child of elementChildren(firstDescendant(slideDoc, 'p:spTree'))) {
      if (!SHAPE_TAGS.includes(localNameOf(child))) continue;
      shapes.push(await renderShape(child, ctx, IDENTITY, stats));
    }

    ctx.unsupported.forEach((count, key) => {
      unsupportedTotal.set(key, (unsupportedTotal.get(key) ?? 0) + count);
    });

    const content = shapes.filter(Boolean).join('');

    slides.push(
      `<div class="slide-wrap"><p class="slide-no">第 ${index + 1} 张 / 共 ${slidePaths.length} 张</p>` +
        `<section class="slide"${background ? ` style="${background}"` : ''}>${
          content || '<p class="empty-note">这张幻灯片没有可静态呈现的内容</p>'
        }</section></div>`
    );
  }

  if (!slides.length) throw new Error('没有解析出任何幻灯片');

  unsupportedTotal.forEach((count, key) => {
    warnings.push(`已忽略 ${count} 个${key}——静态 HTML 无法呈现，建议在原文件中查看`);
  });
  warnings.push(
    '母版 / 版式上的装饰图、动画与切换效果不会出现在 HTML 里；主题色（schemeClr）未做映射，未显式指定颜色的文字按背景深浅自动取深 / 浅色'
  );

  return {
    body: slides.join('\n'),
    extraCss: `.slide{aspect-ratio:${slideCx}/${slideCy}}`,
    warnings,
    slideCount: slides.length,
    textShapeCount: stats.textShapes,
    imageCount: stats.images
  };
}
