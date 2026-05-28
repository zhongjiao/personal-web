// 文件解析模块：把不同类型的文件统一解析为纯文本
// 支持：纯文本类（任意可读 mime）、.docx、.pdf
// .doc（旧二进制）需要后端 LibreOffice 转换，前端只给提示

import mammoth from 'mammoth';

// 仅在用到时再加载 pdfjs，减小首屏体积
let _pdfjsPromise = null;
async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      // 用同 worker 的 ESM 版本
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return _pdfjsPromise;
}

function getExt(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

const TEXT_EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown',
  py: 'python',
  java: 'java',
  go: 'go',
  sql: 'sql',
  xml: 'xml',
  yml: 'yaml', yaml: 'yaml',
  sh: 'shell', bash: 'shell',
  txt: 'plaintext', log: 'plaintext', csv: 'plaintext'
};

// 根据文件名推断 Monaco 语言
export function detectLanguage(filename = '') {
  const ext = getExt(filename);
  if (ext === 'docx' || ext === 'doc' || ext === 'pdf' || ext === 'rtf') return 'plaintext';
  return TEXT_EXT_LANG[ext] || 'plaintext';
}

// 通过内容启发式探测语言（在没有可靠扩展名时使用）
export function detectLanguageByContent(text = '') {
  const s = text.trimStart();
  if (!s) return 'plaintext';

  // JSON
  if ((s.startsWith('{') || s.startsWith('[')) && /[}\]]\s*$/.test(text.trimEnd())) {
    try { JSON.parse(text); return 'json'; } catch { /* not json */ }
  }
  // XML / HTML
  if (s.startsWith('<?xml')) return 'xml';
  if (/^<!doctype html/i.test(s) || /<html[\s>]/i.test(s)) return 'html';
  if (/^<[a-zA-Z][\s\S]*>/.test(s) && /<\/[a-zA-Z]+>\s*$/.test(text.trimEnd())) return 'xml';
  // Markdown
  if (/^#{1,6}\s+\S/m.test(text) || /^\s*[-*+]\s+\S/m.test(text) || /\]\([^)]+\)/.test(text)) {
    return 'markdown';
  }
  // YAML
  if (/^---\s*$/m.test(text) && /^\s*\w[\w-]*:\s/m.test(text)) return 'yaml';
  // Shell
  if (/^#!.*\b(ba)?sh\b/.test(s)) return 'shell';
  // Python
  if (/^#!.*python/.test(s) || /^\s*(def |import |from )\S+/m.test(text)) return 'python';
  // SQL
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(s)) return 'sql';
  // JS / TS（弱判断）
  if (/\b(import\s.+from\s|export\s+(default|const|function)|require\(['"])/.test(text)) {
    return /:\s*\w+(\[\])?\s*[=,)]/.test(text) ? 'typescript' : 'javascript';
  }

  return 'plaintext';
}

/**
 * 综合推断：优先扩展名，扩展名未识别则按内容启发
 */
export function detectLanguageSmart(filename, text) {
  const byName = detectLanguage(filename);
  if (byName !== 'plaintext') return byName;
  return detectLanguageByContent(text);
}

// 读取为 ArrayBuffer
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

// 读取为文本
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// ---- docx ----
async function parseDocx(file) {
  const arrayBuffer = await readAsArrayBuffer(file);
  // mammoth 在浏览器中可直接使用
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value || '';
}

// ---- pdf ----
async function parsePdf(file) {
  const pdfjs = await getPdfjs();
  const arrayBuffer = await readAsArrayBuffer(file);
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // 按 y 坐标聚合，尽可能还原段落换行
    let lastY = null;
    let buf = '';
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(buf);
        buf = '';
      }
      buf += item.str;
      lastY = y;
    }
    if (buf) lines.push(buf);
    lines.push(''); // 页间空行
  }
  return lines.join('\n');
}

/**
 * 解析任意文件 → { text, language, kind, warning? }
 * - kind: 'text' | 'docx' | 'pdf' | 'doc' | 'unsupported'
 */
export async function parseFile(file) {
  const ext = getExt(file.name);

  if (ext === 'docx') {
    const text = await parseDocx(file);
    return { text, language: 'plaintext', kind: 'docx' };
  }

  if (ext === 'pdf') {
    const text = await parsePdf(file);
    return { text, language: 'plaintext', kind: 'pdf' };
  }

  if (ext === 'doc') {
    // 浏览器无可靠纯前端解析方案，给出友好提示
    const msg =
      '[提示] .doc（Word 97-2003 旧二进制格式）暂不支持纯前端解析。\n' +
      '请将文件另存为 .docx 后再上传，或后续通过后端接口（LibreOffice/Antiword）转换。';
    return { text: msg, language: 'plaintext', kind: 'doc', warning: '请将 .doc 另存为 .docx 后再上传' };
  }

  // 默认按文本读取
  const text = await readAsText(file);
  return { text, language: detectLanguage(file.name), kind: 'text' };
}
