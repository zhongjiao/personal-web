import {
  createCanvas,
  ensureMaskAlpha,
  intersectRect,
  layerBounds,
  type AdjustmentLayer,
  type EditorDocument,
  type LayerNode,
  type RasterLayer,
  type Rect
} from './document';
import { NATIVE_BLEND, SEPARABLE_BLEND, blendInto, type CpuBlendMode } from './blend';
import { applyAdjustment } from './adjustments';
import { effectMargin, renderEffects } from './effects';

/**
 * 合成器：把图层树自下而上画到目标 2D 上下文。
 *
 * 每个图层先画进一块**按自身包围盒与重绘区域求交**后的离屏画布（应用变换 → 蒙版 → 效果），
 * 再按其不透明度与混合模式合成到父级。图层组同理：先把子树合成到一块离屏画布，
 * 整组再当作一个图层参与上层合成 —— 这样「组不透明度压暗组内所有内容」才成立。
 *
 * 调整图层没有像素：它读回当前已合成的内容、套用算子、再按蒙版与不透明度混回去。
 *
 * 合成是**逐像素独立**的（没有模糊 / 投影这类邻域算子作用在合成结果上），因此只重绘一个
 * 矩形区域得到的像素值与全量重绘完全一致 —— 这是涂抹蒙版时只重算笔刷那一小块的理论依据。
 * 图层效果虽然是邻域算子，但它作用在**单个图层内部**，跨 dirty 边界时靠 `effectMargin`
 * 把 sprite 多裁一圈来保证正确（见下面 drawLayers 的 margin 分支）。
 */

/** 该图层自身或其子树里是否有需要读回像素的节点（CPU 混合模式、调整图层） */
function subtreeNeedsReadback(layer: LayerNode): boolean {
  if (layer.kind === 'adjustment') return true;
  if (!(layer.blendMode in NATIVE_BLEND)) return true;
  if (layer.kind === 'group') return layer.children.some(subtreeNeedsReadback);
  return false;
}

/**
 * 文档里是否存在需要 CPU 读回像素的节点。
 * 供上层决定主画布是否用 `willReadFrequently` 创建（该选项只在首次 getContext 时生效）。
 */
export function documentNeedsReadback(doc: EditorDocument): boolean {
  return doc.layers.some(subtreeNeedsReadback);
}

/**
 * 把文档合成到 `ctx`（ctx 尺寸应与文档一致）。
 *
 * @param dirty 只重绘该区域（文档像素坐标）。传 `null` / 省略表示全量重绘。
 */
export function renderDocument(
  doc: EditorDocument,
  ctx: CanvasRenderingContext2D,
  dirty?: Rect | null
): void {
  const full: Rect = { x: 0, y: 0, w: doc.width, h: doc.height };
  const region = dirty ? intersectRect(dirty, full) : full;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (region) ctx.clearRect(region.x, region.y, region.w, region.h);
  ctx.restore();

  if (!region) return;
  drawLayers(doc, ctx, doc.layers, 0, 0, region);
}

/**
 * 下列 `expandRect` / `drawBody` / `applyMask` / `sampleAlpha` 被 Canvas2D 与 WebGL2 两条合成路径
 * **共用**：GPU 那条只接管最后一步「按不透明度与混合模式合到目标上」，逐图层的像素准备
 * （变换 → 蒙版 → 效果）仍然走这里。共用同一段代码是「两条路径可以逐像素对拍」的前提。
 */
export const expandRect = (r: Rect, margin: number): Rect => ({
  x: r.x - margin,
  y: r.y - margin,
  w: r.w + margin * 2,
  h: r.h + margin * 2
});

/**
 * @param offsetX / offsetY 该 ctx 已应用的平移量（把文档坐标映射到自身画布坐标）
 * @param clip 本次要重绘的区域（文档坐标）
 */
function drawLayers(
  doc: EditorDocument,
  ctx: CanvasRenderingContext2D,
  layers: LayerNode[],
  offsetX: number,
  offsetY: number,
  clip: Rect
): void {
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;

    if (layer.kind === 'adjustment') {
      applyAdjustmentLayer(doc, ctx, layer, clip, offsetX, offsetY);
      continue;
    }

    const raw = layerBounds(layer);
    if (!raw || raw.w <= 0 || raw.h <= 0) continue;

    const margin = effectMargin(layer.effects);
    const outBounds = intersectRect(margin > 0 ? expandRect(raw, margin) : raw, clip);
    if (!outBounds || outBounds.w <= 0 || outBounds.h <= 0) continue;

    const readback = subtreeNeedsReadback(layer);

    if (margin === 0) {
      // 无效果：本体与蒙版直接画在离屏画布上
      const { canvas: off, ctx: octx } = createCanvas(outBounds.w, outBounds.h, readback);
      octx.translate(-outBounds.x, -outBounds.y);
      drawBody(doc, octx, layer, outBounds);
      if (layer.mask && layer.maskEnabled) applyMask(doc, octx, layer);
      composite(ctx, off, outBounds, layer, offsetX, offsetY);
      continue;
    }

    // 有效果：本体单独画进 sprite，效果再围绕它铺开。
    // sprite 只需覆盖「与重绘区距离不超过 margin」的部分 —— 更远的像素其效果也够不到这里。
    const spriteBounds = intersectRect(raw, expandRect(clip, margin));
    if (!spriteBounds || spriteBounds.w <= 0 || spriteBounds.h <= 0) continue;

    const { canvas: sprite, ctx: sctx } = createCanvas(spriteBounds.w, spriteBounds.h, readback);
    sctx.translate(-spriteBounds.x, -spriteBounds.y);
    drawBody(doc, sctx, layer, spriteBounds);
    if (layer.mask && layer.maskEnabled) applyMask(doc, sctx, layer);

    const { canvas: off, ctx: octx } = createCanvas(outBounds.w, outBounds.h, readback);
    octx.translate(-outBounds.x, -outBounds.y);
    renderEffects(layer.effects, sprite, spriteBounds.x, spriteBounds.y, octx);
    composite(ctx, off, outBounds, layer, offsetX, offsetY);
  }
}

export function drawBody(
  doc: EditorDocument,
  ctx: CanvasRenderingContext2D,
  layer: RasterLayer | Extract<LayerNode, { kind: 'group' }>,
  region: Rect
): void {
  if (layer.kind === 'group') drawLayers(doc, ctx, layer.children, region.x, region.y, region);
  else drawRaster(ctx, layer);
}

function drawRaster(ctx: CanvasRenderingContext2D, layer: RasterLayer): void {
  if (!layer.image) return;
  const t = layer.transform;
  const [w, h] = t.size;
  const cx = t.origin[0] + w / 2;
  const cy = t.origin[1] + h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
  ctx.imageSmoothingEnabled = t.sampling !== 'Nearest';
  ctx.imageSmoothingQuality = t.sampling === 'Smooth' ? 'medium' : 'high';
  ctx.drawImage(layer.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function applyMask(
  doc: EditorDocument,
  ctx: CanvasRenderingContext2D,
  layer: LayerNode
): void {
  const mask = layer.mask ? ensureMaskAlpha(layer.mask) : null;
  if (!mask) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  if (layer.kind === 'group') {
    // 组蒙版覆盖文件夹自身的变换矩形（即创建时的画布尺寸）
    ctx.drawImage(mask, 0, 0, doc.width, doc.height);
  } else if (layer.kind === 'raster') {
    const t = layer.transform;
    const [w, h] = t.size;
    const cx = t.origin[0] + w / 2;
    const cy = t.origin[1] + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
    ctx.drawImage(mask, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

/**
 * 调整图层：读回当前已合成的内容 → 套用算子 → 用「蒙版覆盖率 × 选区覆盖率」调制源 alpha → 混回去。
 *
 * 蒙版覆盖整张画布，是局部调色的手段；选区则是一次性的作用范围限定。
 * 不透明度与混合模式交给 `composite` 统一处理。
 */
function applyAdjustmentLayer(
  doc: EditorDocument,
  ctx: CanvasRenderingContext2D,
  layer: AdjustmentLayer,
  region: Rect,
  offsetX: number,
  offsetY: number
): void {
  if (region.w <= 0 || region.h <= 0) return;
  const lx = region.x - offsetX;
  const ly = region.y - offsetY;

  const original = ctx.getImageData(lx, ly, region.w, region.h);
  const adjusted = new ImageData(new Uint8ClampedArray(original.data), region.w, region.h);
  applyAdjustment(adjusted, layer.adjustment);

  const maskData = layer.mask && layer.maskEnabled ? sampleAlpha(ensureMaskAlpha(layer.mask), region) : null;
  const selectionData = doc.selection ? sampleAlpha(doc.selection, region) : null;

  const od = original.data;
  const ad = adjusted.data;
  const count = region.w * region.h;
  for (let p = 0, i = 0; p < count; p += 1, i += 4) {
    let mix = 1;
    if (maskData) mix *= maskData[i + 3] / 255;
    if (selectionData) mix *= selectionData[i + 3] / 255;
    ad[i + 3] = od[i + 3] * mix;
  }

  const { canvas: temp, ctx: tctx } = createCanvas(region.w, region.h);
  tctx.putImageData(adjusted, 0, 0);
  composite(ctx, temp, region, layer, offsetX, offsetY);
}

/** 取一张 alpha 画布在 `region` 上的覆盖；画布比 region 小时，缺的部分按「完全覆盖」补 */
export function sampleAlpha(canvas: HTMLCanvasElement, region: Rect): Uint8ClampedArray | null {
  const actx = canvas.getContext('2d');
  if (!actx) return null;

  const fit = intersectRect(region, { x: 0, y: 0, w: canvas.width, h: canvas.height });
  if (!fit) return null;
  if (fit.x === region.x && fit.y === region.y && fit.w === region.w && fit.h === region.h) {
    return actx.getImageData(region.x, region.y, region.w, region.h).data;
  }

  const buf = new Uint8ClampedArray(region.w * region.h * 4);
  buf.fill(255);
  const sub = actx.getImageData(fit.x, fit.y, fit.w, fit.h).data;
  const dx = fit.x - region.x;
  const dy = fit.y - region.y;
  for (let y = 0; y < fit.h; y += 1) {
    const dstRow = ((y + dy) * region.w + dx) * 4;
    const srcRow = y * fit.w * 4;
    for (let x = 0; x < fit.w; x += 1) buf[dstRow + x * 4 + 3] = sub[srcRow + x * 4 + 3];
  }
  return buf;
}

function composite(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  bounds: Rect,
  layer: LayerNode,
  offsetX: number,
  offsetY: number
): void {
  const native = NATIVE_BLEND[layer.blendMode];
  if (native) {
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = native;
    ctx.drawImage(source, bounds.x, bounds.y);
    ctx.restore();
    return;
  }

  // CPU 回退：getImageData / putImageData 不受 ctx 变换影响，因此先归位到单位变换，
  // 并把文档坐标换算成该画布自己的坐标。
  const sctx = source.getContext('2d');
  if (!sctx) return;
  const blend = SEPARABLE_BLEND[layer.blendMode as CpuBlendMode];
  const lx = bounds.x - offsetX;
  const ly = bounds.y - offsetY;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dst = ctx.getImageData(lx, ly, bounds.w, bounds.h);
  const src = sctx.getImageData(0, 0, bounds.w, bounds.h);
  blendInto(dst, src, blend, layer.opacity);
  ctx.putImageData(dst, lx, ly);
  ctx.restore();
}
