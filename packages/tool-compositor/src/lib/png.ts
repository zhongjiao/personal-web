import { bytesToBlob, crc32 } from './binary';
import { maskCoverage } from './document';

/**
 * 8-bit 灰度 PNG 编码。
 *
 * 为什么不用 `canvas.toBlob`：Canvas2D 只会产出 RGB/RGBA 的 PNG，
 * 而桌面版 Compositor 要求蒙版是 **8-bit 灰度**（color type 0），
 * 违反这条会整包静默拒收。所以这里手写 IHDR / IDAT / IEND。
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** `'deflate'` 在 Compression Streams 里就是 zlib 包装（PNG 的 IDAT 正需要它） */
async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = bytesToBlob(data).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 把一整个灰度平面编码成 PNG 字节 */
export async function encodeGrayPng(
  gray: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: 灰度
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  // 每行前置一个 filter 字节（0 = None）
  const stride = width + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    raw.set(gray.subarray(y * width, y * width + width), y * stride + 1);
  }

  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', await zlibDeflate(raw)),
    chunk('IEND', new Uint8Array(0))
  ];

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * 从 RGBA 像素抽出灰度平面。
 * 走 `maskCoverage` 与 `ensureMaskAlpha` 共用同一套换算，保证往返不漂移。
 */
export function rgbaToGray(rgba: Uint8ClampedArray, pixelCount: number): Uint8Array {
  const gray = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; p < pixelCount; i += 4, p += 1) {
    gray[p] = maskCoverage(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
  }
  return gray;
}
