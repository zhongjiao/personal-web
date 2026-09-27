/** CRC-32（IEEE 802.3），ZIP 条目与 PNG 数据块共用同一张查表 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 把字节包成 Blob。
 *
 * 新版的 typed array 类型是 `Uint8Array<ArrayBufferLike>`，而 `BlobPart` 只接受
 * `ArrayBufferView<ArrayBuffer>`；这里在唯一一处收敛掉这个不兼容，避免到处做断言。
 */
export function bytesToBlob(bytes: Uint8Array, type?: string): Blob {
  return new Blob([bytes as ArrayBufferView<ArrayBuffer>], type ? { type } : undefined);
}
