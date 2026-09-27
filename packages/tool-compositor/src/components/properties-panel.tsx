import { FlipHorizontal, FlipVertical, Paintbrush, SlidersHorizontal } from 'lucide-react';
import { Button, Select, Separator } from '@pmp/ui';
import { COMP_BLEND_MODES, type CompBlendMode } from '../lib/comp-format';
import { BLEND_MODE_LABELS, isNativeBlend } from '../lib/blend';
import { ADJUSTMENT_LABELS } from '../lib/adjustments';
import { emptyEffects } from '../lib/effects';
import { invertMask, type BrushSettings } from '../lib/paint';
import { createLayerMask, type EditorDocument, type LayerNode } from '../lib/document';
import { rerenderLayerContent } from '../lib/text-shape';
import { NumInput, Row, SectionTitle, SliderRow } from './form-controls';
import { AdjustmentForm } from './adjustment-form';
import { EffectsForm } from './effects-form';
import { SelectionForm } from './selection-form';
import { ShapeForm, TextForm } from './content-form';
import type { ToolId } from './canvas-stage';

interface Props {
  doc: EditorDocument;
  layer: LayerNode | null;
  tool: ToolId;
  brush: BrushSettings;
  wandTolerance: number;
  wandContiguous: boolean;
  objectThreshold: number;
  onToolChange: (tool: ToolId) => void;
  onBrushChange: (brush: BrushSettings) => void;
  onWandToleranceChange: (value: number) => void;
  onWandContiguousChange: (value: boolean) => void;
  onObjectThresholdChange: (value: number) => void;
  onMutate: (fn: (doc: EditorDocument) => void) => void;
}

export function PropertiesPanel({
  doc,
  layer,
  tool,
  brush,
  wandTolerance,
  wandContiguous,
  objectThreshold,
  onToolChange,
  onBrushChange,
  onWandToleranceChange,
  onWandContiguousChange,
  onObjectThresholdChange,
  onMutate
}: Props) {
  const selectionSection = (
    <SelectionForm
      doc={doc}
      wandTolerance={wandTolerance}
      wandContiguous={wandContiguous}
      objectThreshold={objectThreshold}
      activeLayerKind={layer?.kind ?? null}
      onWandToleranceChange={onWandToleranceChange}
      onWandContiguousChange={onWandContiguousChange}
      onObjectThresholdChange={onObjectThresholdChange}
      onMutate={onMutate}
    />
  );

  if (!layer) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-border)]">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <span className="text-xs font-medium">属性</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {selectionSection}
          <SectionTitle>图层</SectionTitle>
          <Row label="">
            <span className="text-[10px] text-[var(--color-muted-foreground)]">
              选中图层后显示变换、混合、内容、效果与蒙版
            </span>
          </Row>
        </div>
      </div>
    );
  }

  const isGroup = layer.kind === 'group';
  const isAdjustment = layer.kind === 'adjustment';
  const patch = (fn: (target: LayerNode) => void) =>
    onMutate(() => {
      fn(layer);
    });
  /** 改文字 / 形状元数据后要重新渲染 PNG */
  const patchContent = (fn: (target: Extract<LayerNode, { kind: 'raster' }>) => void) =>
    onMutate(() => {
      if (layer.kind !== 'raster') return;
      fn(layer);
      rerenderLayerContent(layer);
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-border)]">
        <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
        <span className="text-xs font-medium">属性</span>
        <div className="flex-1" />
        <span className="truncate text-[10px] text-[var(--color-muted-foreground)]">
          {layer.name}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {selectionSection}

        <SectionTitle>图层</SectionTitle>
        <Row label="混合">
          <Select
            className="h-7 w-full text-xs"
            value={layer.blendMode}
            disabled={isGroup}
            title={
              isGroup
                ? '图层组是直通（pass-through）的，在 .comp 里固定为 Normal'
                : isNativeBlend(layer.blendMode)
                  ? '由 Canvas2D 原生合成'
                  : '浏览器无原生实现，走 CPU 逐像素回退'
            }
            onChange={(e) =>
              patch((target) => {
                target.blendMode = e.target.value as CompBlendMode;
              })
            }
          >
            {COMP_BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {BLEND_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Row>

        <SliderRow
          label="不透明度"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          display={`${Math.round(layer.opacity * 100)}%`}
          onChange={(value) =>
            patch((target) => {
              target.opacity = value / 100;
            })
          }
        />

        {layer.kind === 'raster' && (layer.text || layer.shape) && (
          <>
            <SectionTitle>{layer.text ? '文字' : '形状'}</SectionTitle>
            {layer.text ? (
              <TextForm
                text={layer.text}
                patch={(fn) =>
                  patchContent((target) => {
                    if (target.text) fn(target.text);
                  })
                }
              />
            ) : layer.shape ? (
              <ShapeForm
                shape={layer.shape}
                patch={(fn) =>
                  patchContent((target) => {
                    if (target.shape) fn(target.shape);
                  })
                }
              />
            ) : null}
          </>
        )}

        {isAdjustment && (
          <>
            <SectionTitle>调整 · {ADJUSTMENT_LABELS[layer.adjustment.kind]}</SectionTitle>
            <Row label="作用">
              <span className="text-[10px] text-[var(--color-muted-foreground)]">
                作用于其下方已合成的内容
              </span>
            </Row>
            <AdjustmentForm
              adjustment={layer.adjustment}
              patch={(fn) =>
                patch((target) => {
                  if (target.kind === 'adjustment') fn(target.adjustment);
                })
              }
            />
          </>
        )}

        {layer.kind === 'raster' && (
          <>
            <Separator className="my-1" />
            <Row label="位置">
              <div className="flex gap-1">
                <NumInput
                  value={layer.transform.origin[0]}
                  onCommit={(v) =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.origin = [v, target.transform.origin[1]];
                    })
                  }
                />
                <NumInput
                  value={layer.transform.origin[1]}
                  onCommit={(v) =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.origin = [target.transform.origin[0], v];
                    })
                  }
                />
              </div>
            </Row>

            <Row label="尺寸">
              <div className="flex gap-1">
                <NumInput
                  value={layer.transform.size[0]}
                  onCommit={(v) =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.size = [Math.max(1, v), target.transform.size[1]];
                    })
                  }
                />
                <NumInput
                  value={layer.transform.size[1]}
                  onCommit={(v) =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.size = [target.transform.size[0], Math.max(1, v)];
                    })
                  }
                />
              </div>
            </Row>

            <Row label="旋转">
              <div className="flex items-center gap-1">
                <NumInput
                  value={layer.transform.rotation}
                  onCommit={(v) =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.rotation = v;
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 [&_svg]:size-3"
                  title="水平翻转"
                  onClick={() =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.flipX = !target.transform.flipX;
                    })
                  }
                >
                  <FlipHorizontal />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 [&_svg]:size-3"
                  title="垂直翻转"
                  onClick={() =>
                    patch((target) => {
                      if (target.kind !== 'raster') return;
                      target.transform.flipY = !target.transform.flipY;
                    })
                  }
                >
                  <FlipVertical />
                </Button>
              </div>
            </Row>
          </>
        )}

        {!isAdjustment && (
          <>
            <SectionTitle>效果</SectionTitle>
            <EffectsForm
              effects={layer.effects ?? emptyEffects()}
              patch={(fn) =>
                patch((target) => {
                  if (target.kind === 'adjustment') return;
                  if (!target.effects) target.effects = emptyEffects();
                  fn(target.effects);
                })
              }
            />
          </>
        )}

        <SectionTitle>蒙版</SectionTitle>
        <Row label="蒙版">
          {layer.mask ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant={layer.maskEnabled ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() =>
                  patch((target) => {
                    target.maskEnabled = !target.maskEnabled;
                  })
                }
              >
                {layer.maskEnabled ? '已启用' : '已停用'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() =>
                  patch((target) => {
                    if (!target.mask) return;
                    invertMask(target.mask);
                  })
                }
              >
                反相
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() =>
                  patch((target) => {
                    target.mask = null;
                  })
                }
              >
                删除
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() =>
                patch((target) => {
                  // 蒙版像素尺寸必须与图层图片一致；组与调整图层的蒙版覆盖整张画布
                  const w = target.kind === 'raster' ? target.image?.width ?? doc.width : doc.width;
                  const h =
                    target.kind === 'raster' ? target.image?.height ?? doc.height : doc.height;
                  target.mask = createLayerMask(w, h);
                  target.maskEnabled = true;
                })
              }
            >
              添加蒙版
            </Button>
          )}
        </Row>
        {isAdjustment && !layer.mask && (
          <Row label="">
            <span className="text-[10px] text-[var(--color-muted-foreground)]">
              加蒙版后涂抹，可以只调局部
            </span>
          </Row>
        )}

        {layer.mask && (
          <>
            <Row label="涂抹">
              <div className="flex items-center gap-2">
                <Button
                  variant={tool === 'maskBrush' ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onToolChange(tool === 'maskBrush' ? 'move' : 'maskBrush')}
                >
                  <Paintbrush />
                  {tool === 'maskBrush' ? '涂抹中' : '开笔'}
                </Button>
                <div className="flex gap-1">
                  {(['black', 'white'] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      title={color === 'black' ? '涂黑：隐藏' : '涂白：显示'}
                      className={`h-6 w-6 rounded border ${
                        brush.color === color
                          ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                          : 'border-[var(--color-border)]'
                      }`}
                      style={{ background: color === 'black' ? '#000' : '#fff' }}
                      onClick={() => onBrushChange({ ...brush, color })}
                    />
                  ))}
                </div>
              </div>
            </Row>

            <SliderRow
              label="笔刷"
              min={1}
              max={400}
              value={brush.size}
              display={`${brush.size}`}
              onChange={(value) => onBrushChange({ ...brush, size: value })}
            />

            <SliderRow
              label="硬度"
              min={0}
              max={100}
              value={Math.round(brush.hardness * 100)}
              display={`${Math.round(brush.hardness * 100)}%`}
              onChange={(value) => onBrushChange({ ...brush, hardness: value / 100 })}
            />
          </>
        )}
      </div>
    </div>
  );
}
