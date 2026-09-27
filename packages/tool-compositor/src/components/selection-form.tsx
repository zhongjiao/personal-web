import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@pmp/ui';
import { contentAwareFillLayer } from '../lib/inpaint';
import {
  contractSelection,
  expandSelection,
  featherSelection,
  invertSelection,
  isEmptySelection,
  selectAll,
  selectionBounds,
  selectionToMaskGray,
  type Selection
} from '../lib/selection';
import {
  cloneCanvas,
  createCanvas,
  docToImageTransform,
  ensureMaskAlpha,
  findLayer,
  imageToDocTransform,
  maskFromGray,
  type EditorDocument,
  type LayerNode
} from '../lib/document';
import { CheckRow, Row, SectionTitle } from './form-controls';

/**
 * 选区操作面板。
 *
 * 选区是**文档级**状态，所以这块永远显示，与选中哪个图层无关。
 * 「→ 蒙版」「蒙版 →」是它与合成器内核的接合点：
 * 选区负责一次性圈范围，蒙版负责持久化的局部控制。
 */

interface Props {
  doc: EditorDocument;
  wandTolerance: number;
  wandContiguous: boolean;
  objectThreshold: number;
  activeLayerKind: LayerNode['kind'] | null;
  onWandToleranceChange: (value: number) => void;
  onWandContiguousChange: (value: boolean) => void;
  onObjectThresholdChange: (value: number) => void;
  onMutate: (fn: (doc: EditorDocument) => void) => void;
}

export function SelectionForm({
  doc,
  wandTolerance,
  wandContiguous,
  objectThreshold,
  activeLayerKind,
  onWandToleranceChange,
  onWandContiguousChange,
  onObjectThresholdChange,
  onMutate
}: Props) {
  const [radius, setRadius] = useState(20);
  const [fillProgress, setFillProgress] = useState<number | null>(null);
  const selection = doc.selection;
  const bounds = selectionBounds(selection);

  const applyToSelection = (fn: (current: Selection) => Selection) =>
    onMutate((d) => {
      if (!d.selection) return;
      const next = fn(d.selection);
      d.selection = isEmptySelection(next) ? null : next;
    });

  const activeLayer = (d: EditorDocument): LayerNode | null =>
    d.activeLayerID ? findLayer(d.layers, d.activeLayerID) : null;

  /**
   * 把选区变为当前图层的蒙版。
   *
   * 关键点：栅格图层的蒙版作用于**图层框**（不是整张画布），所以不能直接把选区缩放到
   * 图片尺寸 —— 那会把选区按整张画布的比例压进去，位置整个错掉。
   * 正确做法是给 ctx 套上「文档 → 图像」的变换，再原样画选区（选区在文档空间），
   * 画布边界自然把结果裁成图层框内的那一块。
   */
  const selectionToMask = () => {
    onMutate((d) => {
      if (!d.selection) return;
      const target = activeLayer(d);
      if (!target) return;

      const imageSized = target.kind === 'raster' && !!target.image;
      const w = imageSized && target.kind === 'raster' ? target.image?.width ?? d.width : d.width;
      const h = imageSized && target.kind === 'raster' ? target.image?.height ?? d.height : d.height;

      const scaled = createCanvas(w, h).canvas;
      const sctx = scaled.getContext('2d');
      if (!sctx) return;
      if (target.kind === 'raster') {
        docToImageTransform(sctx, target, w, h);
        sctx.drawImage(d.selection, 0, 0);
      } else {
        // 组与调整图层的蒙版覆盖整张画布，直接 1:1 铺满
        sctx.drawImage(d.selection, 0, 0, d.width, d.height);
      }
      target.mask = maskFromGray(selectionToMaskGray(scaled), false);
      target.maskEnabled = true;
    });
    toast.success('已用选区生成蒙版');
  };

  /** 把当前图层的蒙版载入为选区（蒙版跟着图层变换，所以要映射回文档空间） */
  const maskToSelection = () => {
    onMutate((d) => {
      const target = activeLayer(d);
      if (!target?.mask) return;
      const alpha = cloneCanvas(ensureMaskAlpha(target.mask));

      const docSized = createCanvas(d.width, d.height).canvas;
      const sctx = docSized.getContext('2d');
      if (!sctx) return;
      if (target.kind === 'raster') {
        imageToDocTransform(sctx, target, alpha.width, alpha.height);
        sctx.drawImage(alpha, 0, 0);
      } else {
        // 组与调整图层的蒙版本来就覆盖整张画布
        sctx.drawImage(alpha, 0, 0, d.width, d.height);
      }
      d.selection = docSized;
    });
    toast.success('已载入蒙版为选区');
  };

  /**
   * 内容识别填充：算法本身是异步的（内部会让出主线程），但**读像素发生在第一个 await 之前**，
   * 所以拿到的是点击那一刻的快照。算完再通过 `onMutate` 写回，这样才进得了撤销栈。
   */
  const runContentAwareFill = async () => {
    const target = activeLayer(doc);
    if (!target || target.kind !== 'raster' || !target.image || !doc.selection) return;
    setFillProgress(0);
    try {
      const out = await contentAwareFillLayer(target, doc.selection, {
        onProgress: (ratio) => setFillProgress(ratio)
      });
      if (!out) {
        toast.info('选区与图层没有交集');
        return;
      }
      if (out.result.filled === 0) {
        toast.info('选区把图层整片覆盖了，周围没有可参考的内容，未做填充');
        return;
      }
      onMutate((d) => {
        const layer = activeLayer(d);
        if (!layer || layer.kind !== 'raster') return;
        layer.image = out.canvas;
        // 破坏性像素操作让文字 / 形状元数据失效
        layer.text = null;
        layer.shape = null;
      });
      toast.success(
        out.result.patchMatched
          ? `已填充 ${out.result.filled.toLocaleString()} 个像素（扩散 + 块匹配）`
          : `已填充 ${out.result.filled.toLocaleString()} 个像素（可用的已知区域不足，只做了扩散）`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '内容识别填充失败');
    } finally {
      setFillProgress(null);
    }
  };

  /** 擦掉选中栅格图层在选区内的像素；破坏性操作会让文字 / 形状元数据失效 */
  const eraseContent = () => {
    onMutate((d) => {
      const target = activeLayer(d);
      if (!d.selection || !target || target.kind !== 'raster' || !target.image) return;
      const { canvas, ctx } = createCanvas(target.image.width, target.image.height);
      ctx.drawImage(target.image, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      docToImageTransform(ctx, target, canvas.width, canvas.height);
      ctx.drawImage(d.selection, 0, 0);
      target.image = canvas;
      target.text = null;
      target.shape = null;
    });
  };

  return (
    <>
      <SectionTitle>选区</SectionTitle>
      <Row label="状态">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          {bounds
            ? `${bounds.w} × ${bounds.h} @ ${bounds.x}, ${bounds.y}`
            : '无选区（作用于整张画布）'}
        </span>
      </Row>
      <Row label="">
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() =>
              onMutate((d) => {
                d.selection = selectAll(d.width, d.height);
              })
            }
          >
            全选
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!selection}
            onClick={() =>
              onMutate((d) => {
                d.selection = null;
              })
            }
          >
            取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() =>
              onMutate((d) => {
                d.selection = invertSelection(d.selection, d.width, d.height);
              })
            }
          >
            反相
          </Button>
        </div>
      </Row>

      <Row label="半径">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={radius}
            min={1}
            max={200}
            className="w-12 min-w-0 rounded border border-[var(--color-input)] bg-[var(--color-background)] px-1.5 py-0.5 text-xs"
            onChange={(e) => setRadius(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!selection}
            onClick={() => applyToSelection((current) => expandSelection(current, radius))}
          >
            扩展
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!selection}
            onClick={() => applyToSelection((current) => contractSelection(current, radius))}
          >
            收缩
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!selection}
            onClick={() => applyToSelection((current) => featherSelection(current, radius))}
          >
            羽化
          </Button>
        </div>
      </Row>

      <Row label="转成">
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!selection}
            title="用当前选区为选中图层生成蒙版"
            onClick={selectionToMask}
          >
            → 蒙版
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!doc.activeLayerID}
            title="把选中图层的蒙版载入为选区"
            onClick={maskToSelection}
          >
            蒙版 →
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            disabled={!selection || activeLayerKind !== 'raster'}
            title="擦除选中图层在选区内的像素"
            onClick={eraseContent}
          >
            删除内容
          </Button>
        </div>
      </Row>

      <Row label="修复">
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled={!selection || activeLayerKind !== 'raster' || fillProgress !== null}
          title="用周围内容推测并填掉选区内的像素"
          onClick={() => void runContentAwareFill()}
        >
          {fillProgress === null ? '内容识别填充' : `识别中 ${Math.round(fillProgress * 100)}%`}
        </Button>
      </Row>

      <Row label="边缘阈值">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={2}
            max={80}
            value={objectThreshold}
            className="h-1 min-w-0 flex-1 accent-[var(--color-primary)]"
            aria-label="对象选择边缘阈值"
            onChange={(e) => onObjectThresholdChange(Number(e.target.value))}
          />
          <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
            {objectThreshold}
          </span>
        </div>
      </Row>
      <div className="pl-[74px] pr-1 pb-1 text-[10px] leading-snug text-[var(--color-muted-foreground)]">
        对象选择用：越大越容易跨过边缘，越小越只认强轮廓。
      </div>

      <CheckRow label="魔棒连续" checked={wandContiguous} onChange={onWandContiguousChange} />
      <Row label="魔棒容差">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={120}
            value={wandTolerance}
            className="h-1 min-w-0 flex-1 accent-[var(--color-primary)]"
            onChange={(e) => onWandToleranceChange(Number(e.target.value))}
          />
          <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
            {wandTolerance}
          </span>
        </div>
      </Row>
      <Row label="">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          选框 / 套索 / 魔棒：Shift 加选，Alt 减选
        </span>
      </Row>
    </>
  );
}
