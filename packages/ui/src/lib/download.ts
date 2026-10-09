/** 在浏览器里把文本存成文件（Blob + 临时 <a>，不经过服务器） */
export function downloadText(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8'
): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 立刻 revoke 在部分浏览器会中断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 用前缀 + 时间戳拼一个默认文件名 */
export function timestampName(prefix: string, extension: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}.${extension}`;
}

/** 去掉扩展名，便于按原名派生出新文件名 */
export function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
