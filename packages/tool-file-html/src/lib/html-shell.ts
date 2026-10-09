import { escapeHtml } from './dom';
import type { ShellLayout } from './types';

/**
 * 把各转换器产出的 body 包成**单文件、零外部依赖**的 HTML：
 * 样式全部内联在 <style>，图片全部是 data URI，打开即用（离线也能看）。
 */

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";
const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f4f5f7;color:#1f2933;font:14px/1.65 ${FONT_STACK}}
.docbar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;padding:10px 20px;background:#fff;border-bottom:1px solid #e3e6eb;font-size:12px;color:#7b8794}
.docbar strong{color:#1f2933;font-size:13px;font-weight:600}
.page{padding:24px 16px 56px}
.page--plain{padding:24px 16px 56px}
.doc{max-width:860px;margin:0 auto;background:#fff;border:1px solid #e3e6eb;border-radius:12px;padding:36px 44px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.doc--wide{max-width:1400px;padding:22px 24px}
.doc>*:first-child{margin-top:0}
.doc h1,.doc h2,.doc h3,.doc h4,.doc h5,.doc h6{line-height:1.3;margin:1.5em 0 .6em;font-weight:600}
.doc h1{font-size:1.7em}
.doc h2{font-size:1.4em}
.doc h3{font-size:1.2em}
.doc h4{font-size:1.05em}
.doc p{margin:.6em 0}
.doc ul,.doc ol{margin:.6em 0;padding-left:1.6em}
.doc li{margin:.2em 0}
.doc img{max-width:100%;height:auto}
.doc a{color:#4f46e5}
.doc hr{border:0;border-top:1px solid #e3e6eb;margin:1.6em 0}
.doc table{border-collapse:collapse;width:100%;margin:1em 0;font-size:13px}
.doc th,.doc td{border:1px solid #dfe3e8;padding:6px 10px;text-align:left;vertical-align:top}
.doc th{background:#f7f8fa;font-weight:600}
.doc blockquote{margin:1em 0;padding:.5em 1em;border-left:3px solid #c7cbd1;background:#f8f9fa;color:#52606d}
.doc pre{background:#f6f7f9;border:1px solid #e3e6eb;border-radius:8px;padding:12px 14px;overflow:auto;font-family:${MONO_STACK};font-size:12.5px;line-height:1.6}
.doc code{background:#f0f1f3;border-radius:4px;padding:1px 5px;font-family:${MONO_STACK};font-size:.92em}
.doc pre code{background:none;padding:0}
.figure{margin:0;text-align:center}
.figure img{max-width:100%;height:auto;border:1px solid #e3e6eb;border-radius:8px;background:#fff}
.figure figcaption{margin-top:10px;font-size:12px;color:#7b8794}
/* PDF：逐页图片 / 逐页文本层 */
figure{margin:0}
.pdf-page,.pdf-page--text{max-width:960px;margin:0 auto 18px;background:#fff;border:1px solid #e3e6eb;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.pdf-page img{display:block;width:100%;height:auto}
.pdf-page>.pn,.pdf-page--text>.pn{padding:6px 12px;font-size:11px;color:#7b8794;border-top:1px solid #eef0f3;background:#fcfcfd}
.pdf-page--failed{padding:28px;color:#b42318;font-size:13px}
/* 文本层：整页按百分比定位，字号用 cqw，随容器等比缩放 */
.pdf-layer{position:relative;width:100%;background:#fff;overflow:hidden;container-type:inline-size}
.pdf-layer>.t{position:absolute;white-space:pre;line-height:1;transform-origin:0 0;color:#111827}
/* PDF 纯文本模式 */
.pdf-text-wrap{max-width:960px;margin:0 auto 16px}
.pdf-text-wrap>.pn{padding:0 2px 6px;font-size:12px;color:#7b8794}
.pdf-text{margin:0;padding:20px 24px;background:#fff;border:1px solid #e3e6eb;border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7}
/* Excel：工作表页签 + 网格 */
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tabs>input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.tabs>label{padding:5px 14px;border:1px solid #e3e6eb;border-radius:999px;background:#fff;cursor:pointer;font-size:13px;user-select:none;color:#52606d}
.tabs>label:hover{border-color:#c7cbd1}
.tabs>input:checked+label{background:#4f46e5;border-color:#4f46e5;color:#fff}
.tabs>.panels{flex-basis:100%;width:100%;margin-top:10px}
.tabs>.panels>.panel{display:none}
.sheet-wrap{overflow:auto;border:1px solid #e3e6eb;border-radius:8px;background:#fff}
table.sheet{border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;width:max-content;min-width:100%}
table.sheet td{border:1px solid #e6e9ed;padding:3px 8px;white-space:pre-wrap;vertical-align:top;max-width:420px;line-height:1.5}
table.sheet td.num{text-align:right}
table.sheet td.bold{font-weight:600}
table.sheet td.fx{color:#7b8794;font-style:italic}
table.sheet td.empty{background:#fbfbfc}
.sheet-note{margin:0 0 8px;font-size:12px;color:#7b8794}
/* PPT：按百分比绝对定位的幻灯片 */
.deck{display:flex;flex-direction:column;gap:26px;align-items:center}
.slide-wrap{width:100%;max-width:1000px}
.slide-no{margin:0 0 6px 2px;font-size:12px;color:#7b8794}
.slide{position:relative;width:100%;aspect-ratio:16/9;background:#fff;border:1px solid #e3e6eb;border-radius:10px;overflow:hidden;container-type:inline-size;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.slide>.shape{position:absolute;overflow:hidden}
.slide>.shape>.tb{display:flex;flex-direction:column;width:100%;height:100%}
.slide>.shape>.tb>p{margin:0}
.slide>.shape img{width:100%;height:100%;object-fit:contain}
.slide>.shape table{border-collapse:collapse;width:100%;height:100%;font-size:1em}
.slide>.shape td{border:1px solid #d5d9e0;padding:.15em .35em;vertical-align:top;white-space:pre-wrap}
.plain-text{margin:0;white-space:pre-wrap;word-break:break-word;font-family:${MONO_STACK};font-size:13px;line-height:1.7}
.empty-note{padding:40px;text-align:center;color:#7b8794;font-size:13px}
@media (max-width:720px){
  .page{padding:14px 10px 40px}
  .doc{padding:20px 18px;border-radius:10px}
  .doc--wide{padding:14px}
}
@media print{
  body{background:#fff}
  .docbar{display:none}
  .page{padding:0}
  .doc,.doc--wide{max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}
  .pdf-page,.pdf-page--text,.pdf-text-wrap,.slide{break-inside:avoid;page-break-inside:avoid;border:0}
  .pdf-layer>.t{color:#000}
  .tabs>.panels>.panel{display:block!important;margin-bottom:18px}
  .tabs>label,.tabs>input{display:none}
}
`.trim();

const LAYOUT_WRAPPERS: Record<ShellLayout, (body: string) => string> = {
  doc: (body) => `<article class="doc">${body}</article>`,
  wide: (body) => `<article class="doc doc--wide">${body}</article>`,
  deck: (body) => `<div class="deck">${body}</div>`,
  plain: (body) => body
};

export interface HtmlDocumentOptions {
  /** 原文件名，作为页面标题 */
  title: string;
  /** 文档正文（各转换器产出，已是 HTML 片段） */
  body: string;
  layout?: ShellLayout;
  /** 追加 CSS（如幻灯片比例、工作表页签规则） */
  extraCss?: string;
  /** 顶部信息条上的说明，如「PDF · 12 页」 */
  meta?: string;
}

export function buildHtmlDocument({
  title,
  body,
  layout = 'doc',
  extraCss = '',
  meta
}: HtmlDocumentOptions): string {
  const safeTitle = escapeHtml(title);
  const bar = `<header class="docbar"><strong>${safeTitle}</strong>${
    meta ? `<span>${escapeHtml(meta)}</span>` : ''
  }<span>由「文档转 HTML」本地生成，内容自包含</span></header>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
${BASE_CSS}
</style>${extraCss ? `\n<style>\n${extraCss}\n</style>` : ''}
</head>
<body>
${bar}
<main class="page page--${layout}">
${LAYOUT_WRAPPERS[layout](body)}
</main>
</body>
</html>
`;
}
