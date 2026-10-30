import { escapeHtml } from './escape';

/**
 * 把 Markdown 渲染结果包成**单文件、零依赖**的 HTML：
 * 样式内联、无脚本，下载后离线打开即可阅读；深浅配色靠 `<html class="dark">` 切换
 *（预览里跟随应用主题，导出的文件则固定为导出时的配色，同时打印样式会自动转成黑字白底）。
 */

const GITHUB_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --md-fg:#1f2328;--md-bg:#fff;--md-muted:#59636e;--md-border:#d1d9e0;
  --md-accent:#0969da;--md-code-bg:#f6f8fa;--md-code-border:#e6e9ee;--md-zebra:#f8f9fb;
}
.dark{
  --md-fg:#e6edf3;--md-bg:#0d1117;--md-muted:#9198a1;--md-border:#3d444d;
  --md-accent:#4493f8;--md-code-bg:#151b23;--md-code-border:#2a3138;--md-zebra:#11161d;
}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--md-bg);color:var(--md-fg);
  font:16px/1.72 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;
  -webkit-font-smoothing:antialiased;word-wrap:break-word;
}
.md-body{max-width:860px;margin:0 auto;padding:40px 28px 72px}
.md-body>*:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:1.6em 0 .6em;line-height:1.3;font-weight:600}
h1{font-size:1.9em;padding-bottom:.3em;border-bottom:1px solid var(--md-border)}
h2{font-size:1.45em;padding-bottom:.3em;border-bottom:1px solid var(--md-border)}
h3{font-size:1.2em}
h4{font-size:1.05em}
h5{font-size:1em}
h6{font-size:.9em;color:var(--md-muted)}
p{margin:0 0 1em}
a{color:var(--md-accent);text-decoration:none}
a:hover{text-decoration:underline}
strong{font-weight:600}
del{color:var(--md-muted)}
ul,ol{margin:0 0 1em;padding-left:2em}
li+li{margin-top:.3em}
li>ul,li>ol{margin:.3em 0 0}
li.task{list-style:none}
li.task>input[type=checkbox],li.task>p>input[type=checkbox]{margin:0 .45em 0 -1.35em;vertical-align:middle}
blockquote{margin:0 0 1em;padding:.2em 1em;border-left:.25em solid var(--md-border);color:var(--md-muted)}
blockquote>:last-child{margin-bottom:0}
hr{height:.15em;margin:2em 0;border:0;background:var(--md-border)}
code{background:var(--md-code-bg);padding:.16em .42em;border-radius:6px;font-size:.88em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
pre.md-code{position:relative;margin:0 0 1em;padding:14px 16px;background:var(--md-code-bg);
  border:1px solid var(--md-code-border);border-radius:8px;overflow:auto}
pre.md-code code{background:none;padding:0;font-size:13px;line-height:1.65}
pre.md-code[data-lang]::before{content:attr(data-lang);position:absolute;top:0;right:0;padding:2px 8px;
  font-size:11px;line-height:1.6;color:var(--md-muted);background:var(--md-bg);
  border-left:1px solid var(--md-code-border);border-bottom:1px solid var(--md-code-border);
  border-radius:0 8px 0 6px}
.md-table{margin:0 0 1em;overflow:auto}
table{border-collapse:collapse;width:max-content;max-width:100%}
th,td{border:1px solid var(--md-border);padding:6px 13px;vertical-align:top}
th{background:var(--md-code-bg);font-weight:600}
tbody tr:nth-child(2n){background:var(--md-zebra)}
img{max-width:100%;height:auto}
kbd{display:inline-block;padding:3px 5px;font-size:.8em;line-height:1;border:1px solid var(--md-border);
  border-bottom-width:2px;border-radius:6px;background:var(--md-code-bg);vertical-align:middle}
.md-empty{padding:60px 20px;text-align:center;color:var(--md-muted);font-size:14px}
@media (max-width:720px){
  body{font-size:15px}
  .md-body{padding:20px 16px 48px}
}
@media print{
  body{background:#fff;color:#000}
  .md-body{max-width:none;padding:0}
  pre.md-code[data-lang]::before{display:none}
  pre.md-code,.md-table,blockquote{break-inside:avoid}
}
`.trim();

export interface MarkdownDocOptions {
  title: string;
  /** `renderMarkdown().html` 的结果 */
  body: string;
  /** 深色配色（跟随应用主题） */
  dark?: boolean;
}

export function buildMarkdownDocument({ title, body, dark = false }: MarkdownDocOptions): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="zh-CN"${dark ? ' class="dark"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
${GITHUB_CSS}
</style>
</head>
<body>
<article class="md-body">
${body || '<p class="md-empty">（这份 Markdown 还没有内容）</p>'}
</article>
</body>
</html>
`;
}
