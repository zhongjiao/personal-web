import { canvasOf, ctxOf } from './photoshop';

/**
 * 「AI 抠图」的前端调用层
 *
 * 只做传输：把画布导成 PNG 丢给本地抠图服务，拿回透明背景的 PNG。
 * - 服务端：`servers/cutout-api`（默认 http://localhost:3002，dev 下由 vite 的 `/api` 代理转发）
 * - 推理在本地服务的 ONNX 引擎里完成，**图片不会发往第三方**
 */

export interface CutoutResult {
  /** 透明背景的 PNG */
  blob: Blob;
  /** 服务端处理耗时（毫秒），取不到时为 null */
  elapsedMs: number | null;
}

/** 把画布导出成 PNG Blob */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('画布导出失败'));
    }, 'image/png');
  });
}

/**
 * 调本地抠图服务去掉背景。
 * @param source 待抠图的图片（通常是拼合后的文档或当前图层）
 */
export async function requestAiCutout(source: Blob): Promise<CutoutResult> {
  const form = new FormData();
  form.append('image', source, 'cutout.png');

  const resp = await fetch('/api/cutout', { method: 'POST', body: form });

  if (!resp.ok) {
    // 服务端失败时返回 JSON { success: false, message }
    const message = await resp
      .json()
      .then((json: { message?: string }) => json.message)
      .catch(() => '');
    throw new Error(message || `HTTP ${resp.status}: ${resp.statusText}`);
  }

  const elapsed = Number(resp.headers.get('X-Cutout-Ms'));
  return {
    blob: await resp.blob(),
    elapsedMs: Number.isFinite(elapsed) ? elapsed : null
  };
}

/** 把返回的 PNG 解码成可以直接交给图层使用的画布 */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = canvasOf(bitmap.width, bitmap.height);
  ctxOf(canvas).drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/**
 * 非透明像素占比（0 ~ 1）。
 *
 * 引擎对「画面里没有完整物体」的输入会安静地返回全透明，
 * 用它来判断「其实什么都没抠出来」，避免默默加一个空图层。
 */
export function alphaCoverage(canvas: HTMLCanvasElement): number {
  const { width, height } = canvas;
  if (!width || !height) return 0;
  const data = ctxOf(canvas).getImageData(0, 0, width, height).data;
  let hit = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 32) hit += 1;
  }
  return hit / (width * height);
}
