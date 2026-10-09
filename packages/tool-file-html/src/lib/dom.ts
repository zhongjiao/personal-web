/**
 * 一小组 DOM / XML / 二进制工具。
 *
 * 这里刻意只用原生 `DOMParser` + `getElementsByTagName`（不用 querySelector）：
 *  1. 浏览器里零依赖；
 *  2. 也能在 Node 里用 @xmldom/xmldom 顶替 DOMParser 跑单测（本项目就是这么验证 xlsx/pptx 解析的）。
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

export function parseXml(text: string, label = 'XML'): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${label} 解析失败（文件可能已损坏）`);
  }
  return doc;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** 名字匹配：兼容 `a:t` 这类带前缀的限定名，也兼容只用 localName 查询 */
function matches(node: Element, name: string): boolean {
  if (node.nodeName === name) return true;
  return !name.includes(':') && node.localName === name;
}

export function elementChildren(node: Element | Document | null, name?: string): Element[] {
  if (!node) return [];
  const result: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!isElement(child)) continue;
    if (!name || matches(child, name)) result.push(child);
  }
  return result;
}

export function firstElement(node: Element | Document | null, name: string): Element | null {
  return elementChildren(node, name)[0] ?? null;
}

export function descendants(node: Element | Document | null, name: string): Element[] {
  if (!node) return [];
  return Array.from(node.getElementsByTagName(name));
}

export function firstDescendant(node: Element | Document | null, name: string): Element | null {
  return descendants(node, name)[0] ?? null;
}

export function attrOf(node: Element | null, name: string): string {
  return node?.getAttribute(name) ?? '';
}

export function textOf(node: Element | null): string {
  return node?.textContent ?? '';
}

/** 收集某个元素下所有指定名字的子节点的文本（如 `<si><t>a</t><t>b</t></si>`） */
export function joinedText(node: Element | null, name: string): string {
  return descendants(node, name)
    .map((item) => item.textContent ?? '')
    .join('');
}

const BASE64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK);
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
  }
  return btoa(binary);
}

export function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon'
};

export function mimeFromPath(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

export function utf8Size(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
