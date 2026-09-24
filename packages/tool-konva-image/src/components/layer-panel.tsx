import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignCenterHorizontal,
  AlignCenterVertical,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Frame,
  GripVertical,
  Group as GroupIcon,
  ImagePlus,
  ImageUp,
  Layers,
  Lock,
  Maximize2,
  Paintbrush,
  Sparkles,
  Square,
  Sticker,
  Trash2,
  Type,
  Ungroup,
  Unlock
} from 'lucide-react';
import { RangeRow } from '@pmp/image-kit';
import { cn } from '@pmp/ui';
import {
  BASE_LAYER_ID,
  BLEND_MODES,
  flattenTree,
  isGroup,
  isMark,
  isPhoto,
  MARK_MODE_LABEL,
  type AlignMode,
  type BlendMode,
  type CanvasLayer,
  type LayerBase,
  type ZOrderOp
} from '../lib/layer-model';
import type { Mark } from '@pmp/image-kit';

const MARK_ICON: Record<Mark['mode'], typeof Paintbrush> = {
  brush: Paintbrush,
  eraser: Eraser,
  mosaic: Frame,
  rect: Square,
  shape: Sparkles,
  text: Type,
  sticker: Sticker,
  photo: ImagePlus
};

export interface LayerPanelProps {
  layers: CanvasLayer[];
  selectedIds: number[];
  /** 底图信息（作为最底层展示） */
  base: { src: string | null; w: number; h: number };
  onSelect: (id: number, opts?: { additive?: boolean }) => void;
  onSelectMany: (ids: number[]) => void;
  /** 拖拽落位：把 id 移到 parentId（null = 顶层）的第 index 位（0 = 最底） */
  onMove: (id: number, parentId: number | null, index: number) => void;
  onRename: (id: number, name: string) => void;
  onPatch: (ids: number[], patch: Partial<LayerBase>) => void;
  onToggleCollapse: (id: number) => void;
  onZOrder: (ids: number[], op: ZOrderOp) => void;
  onDuplicate: (ids: number[]) => void;
  onRemove: (ids: number[]) => void;
  onGroup: (ids: number[]) => void;
  onUngroup: (ids: number[]) => void;
  onAlign: (ids: number[], mode: AlignMode) => void;
  onDistribute: (ids: number[], axis: 'x' | 'y') => void;
  onCenterCanvas: (ids: number[], axis: 'x' | 'y') => void;
  onFit: (ids: number[]) => void;
  /** 底图操作：用文件替换 / 转为可编辑图层 / 把选中图片图层设为底图 */
  onReplaceBase: () => void;
  onBaseToLayer: () => void;
  onPromoteToBase: () => void;
  /** 当前选中的图片图层数量 */
  selectedPhotoCount: number;
}

/** 紧凑的方形图标按钮 */
function IconButton({
  icon: Icon,
  title,
  disabled,
  active,
  onClick
}: {
  icon: typeof Paintbrush;
  title: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 min-w-0 flex-1 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-violet-300 bg-violet-100 text-violet-600'
          : 'border-violet-100 bg-white text-violet-500 hover:border-violet-300 hover:bg-violet-50'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

type DropTarget = { row: number; where: 'above' | 'below' | 'inside' };

export function LayerPanel(props: LayerPanelProps) {
  const {
    layers,
    selectedIds,
    base,
    onSelect,
    onSelectMany,
    onMove,
    onRename,
    onPatch,
    onToggleCollapse,
    onZOrder,
    onDuplicate,
    onRemove,
    onGroup,
    onUngroup,
    onAlign,
    onDistribute,
    onCenterCanvas,
    onFit,
    onReplaceBase,
    onBaseToLayer,
    onPromoteToBase,
    selectedPhotoCount
  } = props;

  /** 面板用的扁平树（自上而下，含缩进层级） */
  const rows = useMemo(() => flattenTree(layers), [layers]);
  const selected = useMemo(() => selectedIds.filter((id) => id !== BASE_LAYER_ID), [selectedIds]);
  const hasSelection = selected.length > 0;
  const canGroup = selected.length > 0;
  const canUngroup = selected.some((id) => {
    const row = rows.find((r) => r.layer.id === id);
    return !!row && isGroup(row.layer);
  });
  const allVisible =
    hasSelection && selected.every((id) => rows.find((r) => r.layer.id === id)?.layer.visible !== false);
  const allLocked =
    hasSelection && selected.every((id) => rows.find((r) => r.layer.id === id)?.layer.locked === true);

  const listRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const dragRef = useRef<{
    id: number;
    rects: { top: number; bottom: number }[];
    target?: DropTarget;
  } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  /** 画布上选中后，面板自动滚动到对应行 */
  useEffect(() => {
    const first = selected[0];
    if (first === undefined) return;
    listRef.current?.querySelector(`[data-layer-row="${first}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const handleRowSelect = (index: number, id: number, evt: React.MouseEvent) => {
    if (evt.shiftKey && anchorRef.current !== null) {
      const from = Math.min(anchorRef.current, index);
      const to = Math.max(anchorRef.current, index);
      onSelectMany(rows.slice(from, to + 1).map((r) => r.layer.id));
      return;
    }
    anchorRef.current = index;
    onSelect(id, { additive: evt.metaKey || evt.ctrlKey });
  };

  /** 指针拖拽排序：支持同层重排与拖入组 */
  const startDrag = (id: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-layer-row]') ?? []);
    dragRef.current = {
      id,
      rects: els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      })
    };
    setDragId(id);
    setDropTarget({ row: rows.findIndex((r) => r.layer.id === id), where: 'inside' });
  };

  useEffect(() => {
    if (dragId === null) return;
    const onMoveFn = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const idx = d.rects.findIndex((r) => e.clientY >= r.top && e.clientY <= r.bottom);
      if (idx < 0) {
        // 落在列表之外：按第一行之上 / 最后一行之下处理
        const first = d.rects[0];
        const target: DropTarget = first && e.clientY < first.top ? { row: 0, where: 'above' } : { row: rows.length - 1, where: 'below' };
        d.target = target;
        setDropTarget(target);
        return;
      }
      const r = d.rects[idx];
      const ratio = (e.clientY - r.top) / Math.max(1, r.bottom - r.top);
      const row = rows[idx];
      const target: DropTarget =
        row && isGroup(row.layer) && ratio > 0.3 && ratio < 0.7
          ? { row: idx, where: 'inside' }
          : { row: idx, where: ratio < 0.5 ? 'above' : 'below' };
      d.target = target;
      setDropTarget(target);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragId(null);
      setDropTarget(null);
      if (!d || !d.target) return;
      const source = rows.find((r) => r.layer.id === d.id);
      const targetRow = rows[d.target.row];
      if (!source || !targetRow) return;
      if (d.target.where === 'inside' && isGroup(targetRow.layer)) {
        onMove(d.id, targetRow.layer.id, targetRow.layer.children.length);
        return;
      }
      const parentId = targetRow.parentId;
      let index = d.target.where === 'above' ? targetRow.index + 1 : targetRow.index;
      if (source.parentId === parentId && source.index < index) index -= 1;
      if (source.parentId === parentId && source.index === index) return;
      onMove(d.id, parentId, index);
    };
    window.addEventListener('pointermove', onMoveFn);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMoveFn);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragId, rows, onMove]);

  const commitRename = () => {
    if (editingId === null) return;
    const next = draftName.trim();
    if (next) onRename(editingId, next);
    setEditingId(null);
  };

  const firstSelected = selected[0] !== undefined ? rows.find((r) => r.layer.id === selected[0])?.layer : undefined;

  return (
    <div className="flex flex-col gap-2">
      {/* 图层操作条 */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-violet-100 bg-violet-50/40 p-2">
        {/* 层级 */}
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronsUp} title="置于顶层" disabled={!hasSelection} onClick={() => onZOrder(selected, 'front')} />
          <IconButton icon={ChevronUp} title="上移一层" disabled={!hasSelection} onClick={() => onZOrder(selected, 'forward')} />
          <IconButton icon={ChevronDown} title="下移一层" disabled={!hasSelection} onClick={() => onZOrder(selected, 'backward')} />
          <IconButton icon={ChevronsDown} title="置于底层" disabled={!hasSelection} onClick={() => onZOrder(selected, 'back')} />
          <IconButton icon={Copy} title="复制图层（⌘/Ctrl + D）" disabled={!hasSelection} onClick={() => onDuplicate(selected)} />
          <IconButton icon={Trash2} title="删除图层（Delete）" disabled={!hasSelection} onClick={() => onRemove(selected)} />
        </div>
        {/* 编组 */}
        <div className="flex items-center gap-1">
          <IconButton icon={GroupIcon} title="编组（⌘/Ctrl + G）" disabled={!canGroup} onClick={() => onGroup(selected)} />
          <IconButton icon={Ungroup} title="解组（⌘/Ctrl + ⇧ + G）" disabled={!canUngroup} onClick={() => onUngroup(selected)} />
          <IconButton
            icon={allVisible ? EyeOff : Eye}
            title={allVisible ? '隐藏选中图层' : '显示选中图层'}
            disabled={!hasSelection}
            onClick={() => onPatch(selected, { visible: !allVisible })}
          />
          <IconButton
            icon={Lock}
            active={allLocked}
            title={allLocked ? '解锁选中图层' : '锁定选中图层'}
            disabled={!hasSelection}
            onClick={() => onPatch(selected, { locked: !allLocked })}
          />
        </div>
        {/* 对齐（多个元素时相对选区，单个元素时相对画布） */}
        <div className="flex items-center gap-1">
          <IconButton icon={AlignHorizontalJustifyStart} title="左对齐" disabled={!hasSelection} onClick={() => onAlign(selected, 'left')} />
          <IconButton icon={AlignHorizontalJustifyCenter} title="水平居中对齐" disabled={!hasSelection} onClick={() => onAlign(selected, 'centerX')} />
          <IconButton icon={AlignHorizontalJustifyEnd} title="右对齐" disabled={!hasSelection} onClick={() => onAlign(selected, 'right')} />
          <IconButton icon={AlignVerticalJustifyStart} title="顶对齐" disabled={!hasSelection} onClick={() => onAlign(selected, 'top')} />
          <IconButton icon={AlignVerticalJustifyCenter} title="垂直居中对齐" disabled={!hasSelection} onClick={() => onAlign(selected, 'centerY')} />
          <IconButton icon={AlignVerticalJustifyEnd} title="底对齐" disabled={!hasSelection} onClick={() => onAlign(selected, 'bottom')} />
        </div>
        {/* 分布 / 画布居中 / 适应画布 */}
        <div className="flex items-center gap-1">
          <IconButton
            icon={AlignHorizontalDistributeCenter}
            title="水平等距分布（≥3 个）"
            disabled={selected.length < 3}
            onClick={() => onDistribute(selected, 'x')}
          />
          <IconButton
            icon={AlignVerticalDistributeCenter}
            title="垂直等距分布（≥3 个）"
            disabled={selected.length < 3}
            onClick={() => onDistribute(selected, 'y')}
          />
          <IconButton icon={AlignCenterHorizontal} title="在画布中水平居中" disabled={!hasSelection} onClick={() => onCenterCanvas(selected, 'x')} />
          <IconButton icon={AlignCenterVertical} title="在画布中垂直居中" disabled={!hasSelection} onClick={() => onCenterCanvas(selected, 'y')} />
          <IconButton icon={Maximize2} title="适应画布（等比缩放铺满 80%）" disabled={!hasSelection} onClick={() => onFit(selected)} />
        </div>
        {/* 混合模式 + 不透明度 */}
        {firstSelected && (
          <>
            <label className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="shrink-0 text-violet-500">混合</span>
              <select
                value={firstSelected.blend}
                onChange={(e) => onPatch(selected, { blend: e.target.value as BlendMode })}
                className="min-w-0 flex-1 rounded-lg border border-violet-100 bg-white px-1.5 py-1 text-[11px] text-zinc-600 outline-none transition-colors focus:border-violet-300"
              >
                {BLEND_MODES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <RangeRow
              label="图层不透明度"
              value={Math.round(firstSelected.opacity * 100)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => onPatch(selected, { opacity: v / 100 })}
              onReset={() => onPatch(selected, { opacity: 1 })}
            />
          </>
        )}
      </div>

      {/* 图层树（自上而下 = 从上层到下层） */}
      <div ref={listRef} className="max-h-80 overflow-y-auto overscroll-contain rounded-xl border border-violet-100 p-1">
        {rows.length === 0 && (
          <p className="px-1 py-1.5 text-[11px] text-zinc-400">
            还没有图层：导入图片、或用一个绘制工具在画布上操作，都会生成独立图层。
          </p>
        )}
        {rows.map((row, index) => {
          const layer = row.layer;
          const active = selectedIds.includes(layer.id);
          const group = isGroup(layer);
          const Icon = isGroup(layer) ? GroupIcon : isPhoto(layer) ? ImagePlus : MARK_ICON[layer.mark.mode];
          const showAbove = dropTarget?.row === index && dropTarget.where === 'above';
          const showBelow = dropTarget?.row === index && dropTarget.where === 'below';
          const inside = dropTarget?.row === index && dropTarget.where === 'inside';
          return (
            <div key={layer.id}>
              {showAbove && <div className="my-0.5 ml-4 h-0.5 rounded-full bg-violet-400" />}
              <div
                data-layer-row={layer.id}
                onDoubleClick={() => {
                  setEditingId(layer.id);
                  setDraftName(layer.name);
                }}
                style={{ paddingLeft: 2 + row.depth * 12 }}
                className={cn(
                  'group flex items-center gap-1 rounded-lg border px-1 py-1 transition-colors',
                  active
                    ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200'
                    : 'border-transparent hover:border-violet-200 hover:bg-violet-50/60',
                  inside && 'border-violet-400 bg-violet-100/70',
                  dragId === layer.id && 'opacity-60'
                )}
              >
                <span
                  title="拖动调整层级（拖到组中间可放入该组）"
                  onPointerDown={startDrag(layer.id)}
                  className="flex h-5 w-3 shrink-0 cursor-grab touch-none items-center justify-center text-violet-200 hover:text-violet-500 group-hover:text-violet-400"
                >
                  <GripVertical className="h-3 w-3" />
                </span>

                {group ? (
                  <button
                    type="button"
                    title={layer.collapsed ? '展开组' : '折叠组'}
                    onClick={() => onToggleCollapse(layer.id)}
                    className="flex h-4 w-3 shrink-0 items-center justify-center text-violet-400"
                  >
                    {layer.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                ) : (
                  <span className="w-3 shrink-0" />
                )}

                <button
                  type="button"
                  onClick={(e) => handleRowSelect(index, layer.id, e)}
                  title={`${layer.name}｜点击选中，Shift 连选，⌘/Ctrl 多选`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {isPhoto(layer) ? (
                    <img
                      src={layer.src}
                      alt={layer.name}
                      className="h-6 w-6 shrink-0 rounded border border-violet-100 object-cover"
                    />
                  ) : (
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded border',
                        group
                          ? 'border-violet-200 bg-violet-100 text-violet-500'
                          : 'border-violet-100 bg-violet-50 text-violet-500'
                      )}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                  )}
                  {editingId === layer.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-violet-300 px-1 text-[11px] text-zinc-700 outline-none"
                    />
                  ) : (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn(
                          'truncate text-[11px] font-medium',
                          layer.visible ? 'text-zinc-600' : 'text-zinc-300 line-through',
                          group && 'text-violet-600'
                        )}
                      >
                        {layer.name}
                      </span>
                      <span className="truncate text-[9px] text-zinc-400">
                        {group
                          ? `${layer.children.length} 个子图层`
                          : isMark(layer)
                            ? MARK_MODE_LABEL[layer.mark.mode]
                            : '图片'}
                        {layer.blend !== 'normal' && ' · 混合'}
                      </span>
                    </span>
                  )}
                </button>

                {layer.opacity < 1 && layer.visible && (
                  <span className="shrink-0 font-mono text-[9px] text-violet-400">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                )}
                <button
                  type="button"
                  title={layer.visible ? '隐藏' : '显示'}
                  onClick={() => onPatch([layer.id], { visible: !layer.visible })}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-violet-400 transition-colors hover:bg-violet-100"
                >
                  {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  title={layer.locked ? '解锁' : '锁定（画布上不可选中/拖动）'}
                  onClick={() => onPatch([layer.id], { locked: !layer.locked })}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-violet-400 transition-colors hover:bg-violet-100"
                >
                  {layer.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
              </div>
              {showBelow && <div className="my-0.5 ml-4 h-0.5 rounded-full bg-violet-400" />}
            </div>
          );
        })}

        {/* 底图：永远在最底层 */}
        <div
          data-layer-row={BASE_LAYER_ID}
          className={cn(
            'mt-0.5 flex items-center gap-1 rounded-lg border px-1 py-1 transition-colors',
            selectedIds.includes(BASE_LAYER_ID)
              ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200'
              : 'border-transparent hover:border-violet-200 hover:bg-violet-50/60'
          )}
        >
          <span className="flex h-5 w-3 shrink-0 items-center justify-center text-violet-200">
            <Lock className="h-3 w-3" />
          </span>
          <button
            type="button"
            onClick={() => onSelect(BASE_LAYER_ID)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title="选中底图"
          >
            {base.src ? (
              <img src={base.src} alt="底图" className="h-6 w-6 shrink-0 rounded border border-violet-100 object-cover" />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-violet-100 bg-violet-50 text-violet-500">
                <ImagePlus className="h-3 w-3" />
              </span>
            )}
            <span className="truncate text-[11px] text-zinc-600">
              底图{base.src ? ` · ${base.w} × ${base.h}` : ''}
            </span>
          </button>
          {/* 底图操作：设为底图（把选中图片图层提升）/ 替换底图 / 转为图层 */}
          <button
            type="button"
            title={
              selectedPhotoCount === 1
                ? '把选中的图片图层设为底图'
                : '先在图层里选中一个图片图层，再点这里设为底图'
            }
            disabled={selectedPhotoCount !== 1}
            onClick={onPromoteToBase}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-violet-400 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUpToLine className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="用文件替换底图（保留画布上的图层）"
            onClick={onReplaceBase}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-violet-400 transition-colors hover:bg-violet-100"
          >
            <ImageUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="底图转为可编辑图层（画布尺寸不变）"
            disabled={!base.src}
            onClick={onBaseToLayer}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-violet-400 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Layers className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="px-1 text-[10px] leading-relaxed text-zinc-400">
        {rows.length + (base.src ? 1 : 0)} 个图层 · 拖动左侧手柄调整层级（拖到组中间可放入该组），双击名称重命名，
        Shift 连选、⌘/Ctrl 多选；多选后可整体拖动 / 缩放 / 旋转 / 对齐 / 分布，⌘/Ctrl + G 编组。
      </p>
    </div>
  );
}
