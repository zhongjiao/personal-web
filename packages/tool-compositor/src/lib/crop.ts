import {
  createCanvas,
  flatten,
  intersectRect,
  invalidate,
  maskFromGray,
  roundOutRect,
  type EditorDocument,
  type LayerMask,
  type Rect
} from './document';

/** 单边上限，与 `.comp` 规范一致 */
export const MAX_DOC_SIDE = 16384;

/**
 * 裁剪文档。
 *
 * 裁剪要同时搬动三类东西：
 * 1. **栅格图层的 `origin`** —— 直接平移 `-rect.x/-rect.y`；
 * 2. **组 / 调整图层的蒙版** —— 它们覆盖整张画布，尺寸等于文档尺寸，必须跟着裁；
 *    而**图层级蒙版**的尺寸等于图层图片尺寸，与画布无关，不能动。
 * 3. **选区** —— 也是文档尺寸。
 *
 * 裁剪区域会被夹在文档内（不允许裁出画布之外把画布撑大），这样上面第 2 条
 * 永远不会出现「旧蒙版盖不满新画布」的歧义。
 */
export function cropDocument(doc: EditorDocument, rect: Rect): void {
  const target = intersectRect(roundOutRect(rect), {
    x: 0,
    y: 0,
    w: doc.width,
    h: doc.height
  });
  if (!target || target.w < 1 || target.h < 1) {
    throw new Error('裁剪区域太小');
  }
  if (target.w > MAX_DOC_SIDE || target.h > MAX_DOC_SIDE) {
    throw new Error(`裁剪结果 ${target.w} × ${target.h} 超过单边上限 ${MAX_DOC_SIDE}`);
  }
  if (target.x === 0 && target.y === 0 && target.w === doc.width && target.h === doc.height) {
    return;
  }

  const oldW = doc.width;
  const oldH = doc.height;

  const cropMask = (mask: LayerMask): LayerMask => {
    // 只有「覆盖整张画布」的蒙版需要跟着裁
    if (mask.gray.width !== oldW || mask.gray.height !== oldH) return mask;
    const { canvas: gray, ctx } = createCanvas(target.w, target.h);
    if (!ctx) return mask;
    ctx.drawImage(mask.gray, -target.x, -target.y);
    // 新画布是刚建的、没有被任何快照引用，因此 shared = false
    return maskFromGray(gray, false);
  };

  for (const layer of flatten(doc.layers)) {
    if (layer.kind === 'raster') {
      const [ox, oy] = layer.transform.origin;
      layer.transform.origin = [ox - target.x, oy - target.y];
    }
    if (layer.mask) layer.mask = cropMask(layer.mask);
  }

  if (doc.selection) {
    const { canvas, ctx } = createCanvas(target.w, target.h);
    if (ctx) ctx.drawImage(doc.selection, -target.x, -target.y);
    doc.selection = canvas;
  }

  doc.width = target.w;
  doc.height = target.h;
  invalidate(doc);
}
