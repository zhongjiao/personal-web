import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Layers,
  SlidersHorizontal,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@pmp/ui';
import {
  cloneLayer,
  createGroupLayer,
  createLayerMask,
  findLayer,
  findSlot,
  flatten,
  type EditorDocument,
  type GroupLayer,
  type LayerNode
} from '../lib/document';
import { ADJUSTMENT_LABELS } from '../lib/adjustments';
import { CHECKER_STYLE } from '../lib/checker';

interface Props {
  doc: EditorDocument;
  revision: number;
  onMutate: (fn: (doc: EditorDocument) => void) => void;
}

const ROW_BASE =
  'group flex items-center gap-2 rounded-md px-1.5 py-1 cursor-pointer select-none transition-colors';

function LayerThumb({ layer, revision }: { layer: LayerNode; revision: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (layer.kind !== 'raster' || !layer.image) return;
    const k = Math.min(canvas.width / layer.image.width, canvas.height / layer.image.height);
    const w = layer.image.width * k;
    const h = layer.image.height * k;
    ctx.drawImage(layer.image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }, [layer, revision]);

  return (
    <canvas
      ref={ref}
      width={36}
      height={36}
      className="h-7 w-7 shrink-0 rounded border border-[var(--color-border)]"
      style={CHECKER_STYLE}
    />
  );
}

export function LayersPanel({ doc, revision, onMutate }: Props) {
  const [renamingID, setRenamingID] = useState<string | null>(null);

  const selected = doc.activeLayerID ? findLayer(doc.layers, doc.activeLayerID) : null;

  const select = (id: string) => onMutate((d) => void (d.activeLayerID = id));

  const toggleVisible = (id: string) =>
    onMutate((d) => {
      const layer = findLayer(d.layers, id);
      if (layer) layer.visible = !layer.visible;
    });

  const toggleExpanded = (id: string) =>
    onMutate((d) => {
      const layer = findLayer(d.layers, id);
      if (layer?.kind === 'group') layer.expanded = !layer.expanded;
    });

  const rename = (id: string, name: string) => {
    setRenamingID(null);
    if (!name.trim()) return;
    onMutate((d) => {
      const layer = findLayer(d.layers, id);
      if (layer) layer.name = name.trim();
    });
  };

  const move = (id: string, delta: number) =>
    onMutate((d) => {
      const slot = findSlot(d.layers, id);
      if (!slot) return;
      const target = slot.index + delta;
      if (target < 0 || target >= slot.siblings.length) return;
      const [layer] = slot.siblings.splice(slot.index, 1);
      if (layer) slot.siblings.splice(target, 0, layer);
    });

  const duplicate = (id: string) =>
    onMutate((d) => {
      const slot = findSlot(d.layers, id);
      if (!slot) return;
      const source = slot.siblings[slot.index];
      if (!source) return;
      const copy = cloneLayer(source);
      slot.siblings.splice(slot.index + 1, 0, copy);
      d.activeLayerID = copy.id;
    });

  const remove = (id: string) =>
    onMutate((d) => {
      const slot = findSlot(d.layers, id);
      if (!slot) return;
      slot.siblings.splice(slot.index, 1);
      if (d.activeLayerID === id) {
        d.activeLayerID =
          slot.siblings[slot.index]?.id ??
          slot.siblings[slot.index - 1]?.id ??
          flatten(d.layers).at(-1)?.id ??
          null;
      }
    });

  const groupOne = (id: string) =>
    onMutate((d) => {
      const slot = findSlot(d.layers, id);
      if (!slot) return;
      const target = slot.siblings[slot.index];
      if (!target || target.kind === 'group') return;
      const group: GroupLayer = createGroupLayer('图层组');
      group.children = [target];
      slot.siblings[slot.index] = group;
      d.activeLayerID = group.id;
    });

  const ungroup = (id: string) =>
    onMutate((d) => {
      const slot = findSlot(d.layers, id);
      if (!slot) return;
      const group = slot.siblings[slot.index];
      if (!group || group.kind !== 'group') return;
      if (group.mask || group.opacity !== 1) {
        toast.warning('解组会丢弃该组的不透明度与蒙版');
      }
      slot.siblings.splice(slot.index, 1, ...group.children);
      d.activeLayerID = group.children.at(-1)?.id ?? d.activeLayerID;
    });

  const addMask = (id: string) =>
    onMutate((d) => {
      const layer = findLayer(d.layers, id);
      if (!layer || layer.mask) return;
      // 蒙版像素尺寸必须与图层图片一致；组蒙版覆盖整个画布
      const w = layer.kind === 'raster' ? layer.image?.width ?? d.width : d.width;
      const h = layer.kind === 'raster' ? layer.image?.height ?? d.height : d.height;
      layer.mask = createLayerMask(w, h);
      layer.maskEnabled = true;
    });

  const renderRows = (nodes: LayerNode[], depth: number): ReactNode[] =>
    [...nodes]
      .reverse()
      .flatMap((layer) => {
        const active = layer.id === doc.activeLayerID;
        return [
          <div
            key={layer.id}
            className={`${ROW_BASE} ${
              active
                ? 'bg-[var(--color-primary)]/12 ring-1 ring-[var(--color-primary)]/40'
                : 'hover:bg-[var(--color-accent)]'
            }`}
            style={{ marginLeft: depth * 12 }}
            onClick={() => select(layer.id)}
          >
            <button
              type="button"
              className="shrink-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              onClick={(e) => {
                e.stopPropagation();
                toggleVisible(layer.id);
              }}
              aria-label={layer.visible ? '隐藏图层' : '显示图层'}
            >
              {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>

            {layer.kind === 'group' ? (
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(layer.id);
                }}
                aria-label={layer.expanded ? '折叠组' : '展开组'}
              >
                {layer.expanded ? (
                  <FolderOpen className="h-3.5 w-3.5" />
                ) : (
                  <Folder className="h-3.5 w-3.5" />
                )}
              </button>
            ) : layer.kind === 'adjustment' ? (
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-primary)]"
                title="调整图层"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </div>
            ) : (
              <LayerThumb layer={layer} revision={revision} />
            )}

            <div className="min-w-0 flex-1">
              {renamingID === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name}
                  className="w-full rounded bg-[var(--color-background)] px-1 text-xs outline-none ring-1 ring-[var(--color-primary)]"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => rename(layer.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') rename(layer.id, e.currentTarget.value);
                    if (e.key === 'Escape') setRenamingID(null);
                  }}
                />
              ) : (
                <div
                  className="truncate text-xs"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingID(layer.id);
                  }}
                >
                  {layer.name}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted-foreground)]">
                <span>{Math.round(layer.opacity * 100)}%</span>
                {layer.kind === 'adjustment' && (
                  <span>· {ADJUSTMENT_LABELS[layer.adjustment.kind]}</span>
                )}
                {layer.blendMode !== 'Normal' && <span>· {layer.blendMode}</span>}
                {layer.mask && <span>· 蒙版</span>}
              </div>
            </div>
          </div>,
          ...(layer.kind === 'group' && layer.expanded
            ? renderRows(layer.children, depth + 1)
            : [])
        ];
      });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-border)]">
        <Layers className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
        <span className="text-xs font-medium">图层</span>
        <div className="flex-1" />
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          {flatten(doc.layers).length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {doc.layers.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-[var(--color-muted-foreground)]">
            暂无图层
          </div>
        ) : (
          renderRows(doc.layers, 0)
        )}
      </div>

      <Separator />

      <div className="flex shrink-0 items-center gap-0.5 px-1.5 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="上移一层"
              disabled={!selected}
              onClick={() => selected && move(selected.id, 1)}
            >
              <ArrowUp />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">上移一层</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="下移一层"
              disabled={!selected}
              onClick={() => selected && move(selected.id, -1)}
            >
              <ArrowDown />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">下移一层</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="为图层添加蒙版"
              disabled={!selected || selected.mask !== null}
              onClick={() => selected && addMask(selected.id)}
            >
              <CircleDashed />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">添加蒙版</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="放入新组"
              disabled={!selected || selected.kind === 'group'}
              onClick={() => selected && groupOne(selected.id)}
            >
              <FolderPlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">放入新组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="解组"
              disabled={selected?.kind !== 'group'}
              onClick={() => selected && ungroup(selected.id)}
            >
              <FolderMinus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">解组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="复制图层"
              disabled={!selected}
              onClick={() => selected && duplicate(selected.id)}
            >
              <Copy />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">复制图层</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="删除图层"
              disabled={!selected}
              onClick={() => selected && remove(selected.id)}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">删除图层</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
