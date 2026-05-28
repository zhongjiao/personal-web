import mammoth from 'mammoth';

export type FileKind = 'text' | 'docx' | 'pdf' | 'doc';

export interface ParsedFile {
  text: string;
  language: string;
  kind: FileKind;
  warning?: string;
}

let _pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs as unknown as typeof import('pdfjs-dist');
    })();
  }
  return _pdfjsPromise;
}

const TEXT_EXT_LANG: Record<string, string> = {
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

function getExt(name = ''): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function detectLanguage(filename = ''): string {
  const ext = getExt(filename);
  if (ext === 'docx' || ext === 'doc' || ext === 'pdf' || ext === 'rtf') return 'plaintext';
  return TEXT_EXT_LANG[ext] || 'plaintext';
}

export function detectLanguageByContent(text = ''): string {
  const s = text.trimStart();
  if (!s) return 'plaintext';
  if ((s.startsWith('{') || s.startsWith('[')) && /[}\]]\s*$/.test(text.trimEnd())) {
    try { JSON.parse(text); return 'json'; } catch { /* not json */ }
  }
  if (s.startsWith('<?xml')) return 'xml';
  if (/^<!doctype html/i.test(s) || /<html[\s>]/i.test(s)) return 'html';
  if (/^<[a-zA-Z][\s\S]*>/.test(s) && /<\/[a-zA-Z]+>\s*$/.test(text.trimEnd())) return 'xml';
  if (/^#{1,6}\s+\S/m.test(text) || /^\s*[-*+]\s+\S/m.test(text) || /\]\([^)]+\)/.test(text)) return 'markdown';
  if (/^---\s*$/m.test(text) && /^\s*\w[\w-]*:\s/m.test(text)) return 'yaml';
  if (/^#!.*\b(ba)?sh\b/.test(s)) return 'shell';
  if (/^#!.*python/.test(s) || /^\s*(def |import |from )\S+/m.test(text)) return 'python';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(s)) return 'sql';
  if (/\b(import\s.+from\s|export\s+(default|const|function)|require\(['"])/.test(text)) {
    return /:\s*\w+(\[\])?\s*[=,)]/.test(text) ? 'typescript' : 'javascript';
  }
  return 'plaintext';
}

export function detectLanguageSmart(filename: string, text: string): string {
  const byName = detectLanguage(filename);
  if (byName !== 'plaintext') return byName;
  return detectLanguageByContent(text);
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await readAsArrayBuffer(file);
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value || '';
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs = await getPdfjs();
  const arrayBuffer = await readAsArrayBuffer(file);
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let buf = '';
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(buf);
        buf = '';
      }
      buf += item.str;
      lastY = y;
    }
    if (buf) lines.push(buf);
    lines.push('');
  }
  return lines.join('\n');
}

export async function parseFile(file: File): Promise<ParsedFile> {
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
    const msg =
      '[提示] .doc（Word 97-2003 旧二进制格式）暂不支持纯前端解析。\n' +
      '请将文件另存为 .docx 后再上传，或后续通过后端接口转换。';
    return {
      text: msg,
      language: 'plaintext',
      kind: 'doc',
      warning: '请将 .doc 另存为 .docx 后再上传'
    };
  }
  const text = await readAsText(file);
  return { text, language: detectLanguage(file.name), kind: 'text' };
}
