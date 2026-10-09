import type JSZip from 'jszip';

/**
 * zip 相关的小工具：xlsx / pptx 都是 OPC 容器（一堆 xml + 媒体文件），
 * 这里只做「解压 + 读文本/二进制 + 相对路径归一化」。
 */

export async function loadZip(data: ArrayBuffer): Promise<JSZip> {
  const { default: JSZipCtor } = await import('jszip');
  try {
    return await JSZipCtor.loadAsync(data);
  } catch {
    throw new Error('无法解压该文件：它可能不是标准的 OOXML（xlsx / pptx）文件');
  }
}

export async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(normalizePath(path));
  if (!entry) return null;
  return entry.async('string');
}

export async function readZipBytes(zip: JSZip, path: string): Promise<Uint8Array | null> {
  const entry = zip.file(normalizePath(path));
  if (!entry) return null;
  return new Uint8Array(await entry.async('arraybuffer'));
}

export function hasZipEntry(zip: JSZip, path: string): boolean {
  return zip.file(normalizePath(path)) !== null;
}

/** 去掉开头的 '/'，OPC 里的部件名不带前导斜杠 */
export function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

/**
 * 把 OPC 里的相对引用（`worksheets/sheet1.xml`、`../media/image1.png`）解析成 zip 内绝对路径。
 * @param baseDir 引用所在部件所在的目录，如 `xl` 或 `ppt/slides`
 */
export function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return normalizePath(target);

  const segments = baseDir.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

export function dirOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}
