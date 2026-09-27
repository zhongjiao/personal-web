import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type RefObject
} from 'react';
import {
  Circle,
  Crop,
  Download,
  FileArchive,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Lasso,
  Layers,
  Focus,
  Loader2,
  Maximize,
  Move,
  PenTool,
  Paintbrush,
  Plus,
  Redo2,
  Shapes,
  SlidersHorizontal,
  Square,
  Type,
  Undo2,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Select, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@pmp/ui';
import { ADJUSTMENT_LABELS, SUPPORTED_KINDS, type AdjustmentKind } from './lib/adjustments';
import {
  SHAPE_LABELS,
  createShapeLayer,
  createTextLayer,
  type ShapeKind
} from './lib/text-shape';
import {
  createAdjustmentLayer,
  createDocument,
  createGroupLayer,
  createRasterLayer,
  createSolidLayer,
  fileToCanvas,
  findLayer,
  fitWithin,
  flatten,
  invalidate,
  type EditorDocument,
  type GroupLayer,
  type LayerNode,
  type Rect
} from './lib/document';
import { cropDocument } from './lib/crop';
import type { FrameInfo } from './components/canvas-stage';
import {
  beginTransaction,
  canRedo,
  canUndo,
  commit,
  createHistory,
  endTransaction,
  redo,
  resetHistory,
  undo
} from './lib/history';
import { buildCompZip, importCompZip, loadCompPackage } from './lib/comp-io';
import { DEFAULT_BRUSH, type BrushSettings } from './lib/paint';
import { COMP_FORMAT, COMP_VERSION } from './lib/comp-format';
import { CanvasStage, type ToolId } from './components/canvas-stage';
import { Dropdown, DropdownItem } from './components/dropdown';
import { LayersPanel } from './components/layers-panel';
import { PropertiesPanel } from './components/properties-panel';

/**
 * 合成器（里程碑 2：文档模型 + 合成器渲染）。
 *
 * 已可用：多图层与图层组、24 种混合模式与图层效果（默认走 WebGL2 着色器，可一键切回 Canvas2D 对拍）、
 * 图层蒙版、全套选区工具（选框 / 套索 / 多边形套索 / 魔棒 / 对象选择）、裁剪与变换手柄、
 * 内容识别填充、调整图层、文字 / 形状图层、非破坏性变换、撤销 / 重做、`.comp` 读写。
 */

const TOOLS: { id: ToolId; icon: LucideIcon; label: string }[] = [
  { id: 'move', icon: Move, label: '移动 / 变换（拖动移动，拖手柄缩放，旋转手柄转，Shift 等比，Alt 以中心）' },
  { id: 'maskBrush', icon: Paintbrush, label: '蒙版画笔（涂黑隐藏 / 涂白显示）' },
  { id: 'marqueeRect', icon: Square, label: '矩形选框（Shift 加选 / Alt 减选）' },
  { id: 'marqueeEllipse', icon: Circle, label: '椭圆选框（Shift 加选 / Alt 减选）' },
  { id: 'lasso', icon: Lasso, label: '自由套索（按住拖出闭合路径）' },
  { id: 'polygonLasso', icon: PenTool, label: '多边形套索（逐点点击，Enter 闭合 / Backspace 删点 / Esc 取消）' },
  { id: 'wand', icon: Wand2, label: '魔棒（按颜色取选区）' },
  { id: 'object', icon: Focus, label: '对象选择（按边缘整块取对象）' },
  { id: 'crop', icon: Crop, label: '裁剪（拖出范围，Enter 应用 / Esc 重置）' }
];

const TOOL_HINTS: Record<ToolId, string> = {
  move: '移动 / 变换：拖动移动，拖控制点缩放，拖圆点旋转（Shift 等比，Alt 以中心）',
  maskBrush: '蒙版画笔：在画布上涂抹（涂黑隐藏 / 涂白显示）',
  marqueeRect: '矩形选框：拖出范围（Shift 加选 / Alt 减选）',
  marqueeEllipse: '椭圆选框：拖出范围（Shift 加选 / Alt 减选）',
  lasso: '自由套索：按住拖出闭合路径',
  polygonLasso: '多边形套索：逐点点击，点回起点 / 双击 / Enter 闭合，Backspace 删点，Esc 取消',
  wand: '魔棒：按颜色取选区',
  object: '对象选择：点一下，沿可见边缘把整块对象长出来（阈值在右侧「边缘阈值」）',
  crop: '裁剪：拖出保留范围，Enter 应用 / Esc 重置'
};

const SHAPE_MENU: { kind: ShapeKind }[] = [
  { kind: 'rect' },
  { kind: 'roundedRect' },
  { kind: 'ellipse' },
  { kind: 'line' }
];

const PRESETS = [
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '1080 × 1080', width: 1080, height: 1080 },
  { label: '1080 × 1920', width: 1080, height: 1920 },
  { label: '2480 × 3508（A4 · 300dpi）', width: 2480, height: 3508 }
];

const PALETTE = ['#4f6df5', '#e8574a', '#f2b03d', '#2fa36b', '#8b5cf6', '#0ea5e9'];

const ROADMAP = [
  { done: true, text: '工具包骨架与 .comp 数据契约' },
  { done: true, text: '文档模型 + 合成器（图层组 / 24 种混合模式 / 蒙版）' },
  { done: true, text: '撤销 / 重做（脏矩形 + 写时复制）' },
  { done: true, text: '.comp 读写（zip 与目录，与桌面版互通）' },
  { done: true, text: '调整图层（6 种）与图层效果（6 种）' },
  { done: true, text: '选区（选框 / 套索 / 魔棒）与文字 / 形状图层' },
  { done: true, text: '裁剪、变换手柄（缩放 / 旋转）、内容识别填充' },
  { done: true, text: 'WebGL2 合成器（24 种混合模式 + 5 种图层效果在着色器里算，可切回 Canvas2D 对拍）' },
  { done: true, text: '多边形套索、对象选择（边缘感知生长）' }
];

/** 非文本录入的 input 类型 —— 它们拿到焦点时不应屏蔽 Ctrl+Z */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'color',
  'file',
  'image'
]);

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}

/** 活跃图层是组时，新图层直接放进去 */
function activeGroupOf(doc: EditorDocument): GroupLayer | null {
  if (!doc.activeLayerID) return null;
  const layer = findLayer(doc.layers, doc.activeLayerID);
  return layer && layer.kind === 'group' ? layer : null;
}

export default function CompositorPage() {
  const docRef = useRef<EditorDocument | null>(null);
  const stageRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef<HTMLInputElement | null>(null);
  const colorSeqRef = useRef(0);
  const historyRef = useRef(createHistory());

  const [revision, bump] = useReducer((count: number) => count + 1, 0);
  const [zoom, setZoom] = useState(1);
  const [fitRequest, setFitRequest] = useState(0);
  const [tool, setTool] = useState<ToolId>('move');
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [presetIndex, setPresetIndex] = useState('0');
  /** 读写 `.comp` 期间的进度文案；非空即视为忙碌 */
  const [busy, setBusy] = useState<string | null>(null);
  const [wandTolerance, setWandTolerance] = useState(24);
  const [wandContiguous, setWandContiguous] = useState(true);
  /** 对象选择的边缘阈值（1–100） */
  const [objectThreshold, setObjectThreshold] = useState(18);
  /** 合成后端：默认走 WebGL2（24 种混合模式全部在着色器里算） */
  const [gpuEnabled, setGpuEnabled] = useState(true);
  /** 能力探测只做一次；没有 WebGL2 时开关无意义，直接显示为不可用 */
  const [gpuAvailable] = useState(() => {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  });
  /** 上一帧实际重绘的区域与后端；数值不变时返回旧对象，避免多触发一次渲染 */
  const [frame, setFrame] = useState<FrameInfo>({ width: 0, height: 0, full: true, gpu: true });
  /** 偏好 GPU 但上一帧实际走了 Canvas2D —— 说明 GL 初始化或运行失败，明说出来别让人误以为在用 GPU */
  const gpuFellBack = gpuEnabled && gpuAvailable && !frame.gpu;
  const reportFrame = useCallback((info: FrameInfo) => {
    setFrame((prev) =>
      prev.width === info.width &&
      prev.height === info.height &&
      prev.full === info.full &&
      prev.gpu === info.gpu
        ? prev
        : info
    );
  }, []);

  const doc = docRef.current;

  /** 全量失效的改动（增删图层、改混合模式、变换…） */
  const mutate = useCallback((fn: (doc: EditorDocument) => void) => {
    const current = docRef.current;
    if (!current) return;
    fn(current);
    invalidate(current);
    commit(historyRef.current, current);
    bump();
  }, []);

  /** 带回脏矩形的改动：返回矩形则只重绘该区域，返回 null 则退化为全量 */
  const change = useCallback((fn: (doc: EditorDocument) => Rect | null) => {
    const current = docRef.current;
    if (!current) return;
    const rect = fn(current);
    invalidate(current, rect);
    commit(historyRef.current, current);
    bump();
  }, []);

  /** 一次拖拽 = 一步撤销：拖拽期间合并所有改动 */
  const beginStroke = useCallback(() => beginTransaction(historyRef.current), []);
  const endStroke = useCallback(() => {
    endTransaction(historyRef.current, docRef.current);
    bump();
  }, []);

  const stepHistory = useCallback((direction: 'undo' | 'redo') => {
    const current = docRef.current;
    if (!current) return;
    const moved = direction === 'undo' ? undo(historyRef.current, current) : redo(historyRef.current, current);
    if (moved) bump();
  }, []);

  const doUndo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const doRedo = useCallback(() => stepHistory('redo'), [stepHistory]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // 只在真正「文本录入」时让路；复选框 / 滑块 / 下拉框拿到焦点时快捷键仍应生效
      if (isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doUndo, doRedo]);

  const hasDoc = doc !== null;
  const undoAvailable = hasDoc && canUndo(historyRef.current);
  const redoAvailable = hasDoc && canRedo(historyRef.current);

  /** 换上一份新文档：重置历史、回到移动工具、重新适应窗口 */
  const adoptDocument = (next: EditorDocument) => {
    docRef.current = next;
    resetHistory(historyRef.current, next);
    setTool('move');
    bump();
    setFitRequest((n) => n + 1);
  };

  const newDocument = (width: number, height: number) => {
    adoptDocument(createDocument(width, height));
  };

  const addLayerInto = (target: EditorDocument, layer: LayerNode) => {
    const parent = activeGroupOf(target);
    (parent ? parent.children : target.layers).push(layer);
    target.activeLayerID = layer.id;
  };

  const addSolidLayer = () =>
    mutate((d) => {
      const index = colorSeqRef.current;
      colorSeqRef.current += 1;
      const w = Math.round(d.width * 0.46);
      const h = Math.round(d.height * 0.46);
      const layer = createSolidLayer(
        `纯色层 ${index + 1}`,
        w,
        h,
        PALETTE[index % PALETTE.length]
      );
      layer.transform.origin = [
        Math.round((d.width - w) / 2),
        Math.round((d.height - h) / 2)
      ];
      addLayerInto(d, layer);
    });

  const addGroup = () =>
    mutate((d) => {
      addLayerInto(d, createGroupLayer());
    });

  const addAdjustment = (kind: AdjustmentKind) =>
    mutate((d) => {
      addLayerInto(d, createAdjustmentLayer(kind));
    });

  const addTextLayer = () =>
    mutate((d) => {
      addLayerInto(d, createTextLayer([d.width / 2, d.height / 2]));
    });

  const addShapeLayer = (kind: ShapeKind) =>
    mutate((d) => {
      const w = Math.round(d.width * 0.4);
      const h = Math.round(d.height * 0.4);
      addLayerInto(d, createShapeLayer(kind, w, h, [d.width / 2, d.height / 2]));
    });

  /** 应用裁剪：改画布尺寸、平移图层、裁剪画布级蒙版与选区，然后回到移动工具并重新适应窗口 */
  const applyCrop = useCallback(
    (rect: Rect) => {
      const current = docRef.current;
      if (!current) return;
      try {
        mutate((d) => cropDocument(d, rect));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '裁剪失败');
        return;
      }
      setTool('move');
      setFitRequest((n) => n + 1);
      toast.success(`已裁剪为 ${current.width} × ${current.height}`);
    },
    [mutate]
  );

  const importImage = async (file: File) => {
    const current = docRef.current;
    if (!current) return;
    try {
      const image = await fileToCanvas(file);
      const [w, h] = fitWithin(image.width, image.height, current.width, current.height);
      mutate((d) => {
        const layer = createRasterLayer({
          name: file.name.replace(/\.[^.]+$/, ''),
          image,
          origin: [Math.round((d.width - w) / 2), Math.round((d.height - h) / 2)],
          size: [w, h]
        });
        addLayerInto(d, layer);
      });
    } catch {
      toast.error('无法读取该图片');
    }
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportPng = () => {
    const canvas = stageRef.current;
    if (!canvas) return;
    const stem = docRef.current?.name.replace(/\.comp$/, '') ?? 'compositor';
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error('导出 PNG 失败');
        return;
      }
      download(blob, `${stem}.png`);
    }, 'image/png');
  };

  /** 导出 `.comp`：zip 顶层是 `<项目名>.comp/`，解压后即桌面版能直接打开的文件夹 */
  const exportComp = async () => {
    const current = docRef.current;
    if (!current || busy) return;
    setBusy('正在打包 .comp…');
    try {
      const blob = await buildCompZip(current, {
        onProgress: (text) => setBusy(`正在打包 .comp：${text}`)
      });
      const stem = current.name.replace(/\.comp$/i, '') || 'project';
      download(blob, `${stem}.comp.zip`);
      toast.success(`已导出 ${stem}.comp.zip，解压即得到 .comp 文件夹`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出 .comp 失败');
    } finally {
      setBusy(null);
    }
  };

  const reportImport = (result: Awaited<ReturnType<typeof loadCompPackage>>) => {
    adoptDocument(result.doc);
    toast.success(
      `已导入 ${result.doc.width} × ${result.doc.height}，共 ${flatten(result.doc.layers).length} 个图层节点`
    );
    result.warnings.forEach((text) => toast.warning(text));
  };

  const openCompZip = async (file: File) => {
    if (busy) return;
    setBusy('正在读取 .comp…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stem = file.name.replace(/\.(zip|comp)$/i, '') || '导入的.comp';
      reportImport(await importCompZip(bytes, stem));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入 .comp 失败');
    } finally {
      setBusy(null);
    }
  };

  const openCompFolder = async (list: FileList) => {
    if (busy) return;
    setBusy('正在读取 .comp 文件夹…');
    try {
      const files = new Map<string, Uint8Array>();
      for (const file of Array.from(list)) {
        files.set(file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer()));
      }
      const firstKey = files.keys().next().value ?? '';
      reportImport(await loadCompPackage(files, firstKey.split('/')[0] || '导入的.comp'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入 .comp 文件夹失败');
    } finally {
      setBusy(null);
    }
  };

  /* ────────────────────────────── 空状态 ────────────────────────────── */

  if (!doc) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <Header
          doc={null}
          zoom={zoom}
          busy={busy}
          onZoom={setZoom}
          onImportImage={() => fileRef.current?.click()}
          onOpenZip={() => zipRef.current?.click()}
          onOpenFolder={() => dirRef.current?.click()}
          onExportPng={exportPng}
          onExportComp={() => void exportComp()}
        />
        <div className="flex-1 min-w-0 overflow-auto flex items-center justify-center p-8">
          <div className="w-full max-w-md rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-8 text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 text-[var(--color-primary)] flex items-center justify-center ring-1 ring-[var(--color-primary)]/20">
              <Layers className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold mb-1">新建一个画布开始合成</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              原生格式是 <code className="text-xs">.comp</code> 文件夹包
              （<code className="text-xs">manifest.json</code> +{' '}
              <code className="text-xs">images/</code>），与桌面版 Compositor 项目互通。
            </p>

            <div className="mt-5 flex items-center justify-center gap-2">
              <Select
                className="h-8 max-w-[190px] text-xs"
                value={presetIndex}
                onChange={(e) => setPresetIndex(e.target.value)}
              >
                {PRESETS.map((preset, index) => (
                  <option key={preset.label} value={String(index)}>
                    {preset.label}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                onClick={() => {
                  const preset = PRESETS[Number(presetIndex)] ?? PRESETS[0];
                  newDocument(preset.width, preset.height);
                }}
              >
                <Plus />
                新建
              </Button>
            </div>

            <ul className="mt-6 space-y-1.5 text-left text-xs text-[var(--color-muted-foreground)]">
              {ROADMAP.map((item) => (
                <li key={item.text} className="flex items-start gap-2">
                  <span
                    className={
                      item.done
                        ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]'
                        : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-border)]'
                    }
                  />
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <HiddenInputs
          imageRef={fileRef}
          zipRef={zipRef}
          dirRef={dirRef}
          onImage={(file) => void importImage(file)}
          onZip={(file) => void openCompZip(file)}
          onFolder={(list) => void openCompFolder(list)}
        />
      </div>
    );
  }

  /* ────────────────────────────── 编辑态 ────────────────────────────── */

  const activeLayer = doc.activeLayerID ? findLayer(doc.layers, doc.activeLayerID) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header
        doc={doc}
        zoom={zoom}
        busy={busy}
        onFit={() => setFitRequest((n) => n + 1)}
        onZoom={setZoom}
        onImportImage={() => fileRef.current?.click()}
        onOpenZip={() => zipRef.current?.click()}
        onOpenFolder={() => dirRef.current?.click()}
        onExportPng={exportPng}
        onExportComp={() => void exportComp()}
        onAddLayer={addSolidLayer}
        onAddGroup={addGroup}
        onAddAdjustment={addAdjustment}
        onAddTextLayer={addTextLayer}
        onAddShapeLayer={addShapeLayer}
        onUndo={doUndo}
        onRedo={doRedo}
        canUndo={undoAvailable}
        canRedo={redoAvailable}
      />

      <div className="flex-1 min-h-0 flex">
        {/* 工具栏 */}
        <div className="w-14 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-card)] flex flex-col items-center gap-1 py-3">
          {TOOLS.map(({ id, icon: Icon, label }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant={tool === id ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-label={label}
                  className={`h-10 w-10 [&_svg]:size-4 ${
                    tool === id ? 'ring-1 ring-[var(--color-primary)]' : ''
                  }`}
                  onClick={() => setTool(id)}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}

        </div>

        <CanvasStage
          doc={doc}
          revision={revision}
          zoom={zoom}
          tool={tool}
          brush={brush}
          wandTolerance={wandTolerance}
          wandContiguous={wandContiguous}
          objectThreshold={objectThreshold}
          canvasRef={stageRef}
          onChange={change}
          onStrokeStart={beginStroke}
          onStrokeEnd={endStroke}
          onApplyCrop={applyCrop}
          gpuEnabled={gpuEnabled && gpuAvailable}
          onFrame={reportFrame}
          fitRequest={fitRequest}
          onZoomChange={setZoom}
        />

        {/* 右面板 */}
        <div className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-card)] flex flex-col">
          <div className="h-1/2 min-h-0 flex flex-col border-b border-[var(--color-border)]">
            <LayersPanel doc={doc} revision={revision} onMutate={mutate} />
          </div>
          <div className="h-1/2 min-h-0 flex flex-col">
            <PropertiesPanel
              doc={doc}
              layer={activeLayer}
              tool={tool}
              brush={brush}
              wandTolerance={wandTolerance}
              wandContiguous={wandContiguous}
              onToolChange={setTool}
              onBrushChange={setBrush}
              onWandToleranceChange={setWandTolerance}
              onWandContiguousChange={setWandContiguous}
              objectThreshold={objectThreshold}
              onObjectThresholdChange={setObjectThreshold}
              onMutate={mutate}
            />
          </div>
        </div>
      </div>

      {/* 状态条 */}
      <div className="h-8 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-card)] flex items-center gap-3 px-4 text-xs text-[var(--color-muted-foreground)]">
        <span>{Math.round(zoom * 100)}%</span>
        <Separator orientation="vertical" className="h-3" />
        <span>{flatten(doc.layers).length} 个图层</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="truncate">{TOOL_HINTS[tool]}</span>
        <div className="flex-1" />
        <span
          className="tabular-nums"
          title="上一帧**实际**用的合成后端与重绘区域（与左侧偏好可能不同：GPU 初始化失败会自动退回 Canvas2D）"
        >
          {frame.gpu ? 'GPU' : 'Canvas2D'} 合成 · {frame.full ? '全量' : '局部'}{' '}
          {frame.width}×{frame.height}
        </span>
        <Separator orientation="vertical" className="h-3" />
        <button
          type="button"
          disabled={!gpuAvailable}
          onClick={() => setGpuEnabled((on) => !on)}
          title={
            gpuAvailable
              ? '切换合成后端：GPU 走 WebGL2 着色器，CPU 走 Canvas2D（结果应逐像素一致）'
              : '当前环境没有 WebGL2，只能走 Canvas2D'
          }
          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] tabular-nums transition-colors enabled:hover:bg-[var(--color-accent)] disabled:opacity-50"
        >
          合成：{!gpuAvailable ? '无 WebGL2' : gpuEnabled ? 'GPU' : 'Canvas2D'}
          {gpuFellBack ? '（已回退）' : ''}
        </button>
        <Separator orientation="vertical" className="h-3" />
        <span>
          {COMP_FORMAT} v{COMP_VERSION}
        </span>
      </div>

      <HiddenInputs
        imageRef={fileRef}
        zipRef={zipRef}
        dirRef={dirRef}
        onImage={(file) => void importImage(file)}
        onZip={(file) => void openCompZip(file)}
        onFolder={(list) => void openCompFolder(list)}
      />
    </div>
  );
}

/* ────────────────────────────── 工具头 ────────────────────────────── */

function Header({
  doc,
  zoom,
  busy,
  onFit,
  onZoom,
  onImportImage,
  onOpenZip,
  onOpenFolder,
  onExportPng,
  onExportComp,
  onAddLayer,
  onAddGroup,
  onAddAdjustment,
  onAddTextLayer,
  onAddShapeLayer,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: {
  doc: EditorDocument | null;
  zoom: number;
  busy: string | null;
  onFit?: () => void;
  onZoom: (zoom: number) => void;
  onImportImage: () => void;
  onOpenZip: () => void;
  onOpenFolder: () => void;
  onExportPng: () => void;
  onExportComp: () => void;
  onAddLayer?: () => void;
  onAddGroup?: () => void;
  onAddAdjustment?: (kind: AdjustmentKind) => void;
  onAddTextLayer?: () => void;
  onAddShapeLayer?: (kind: ShapeKind) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-card)] flex items-center gap-3 px-4">
      <Layers className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
      <span className="shrink-0 text-sm font-medium">{doc ? doc.name : '未打开文档'}</span>
      {doc && <Badge variant="outline">未保存</Badge>}
      <Separator orientation="vertical" className="h-4" />
      <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
        {doc ? `${doc.width} × ${doc.height} px` : '画布 —'}
      </span>

      <Separator orientation="vertical" className="h-4" />

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 [&_svg]:size-3.5"
          aria-label="撤销"
          title="撤销（Ctrl+Z）"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 [&_svg]:size-3.5"
          aria-label="重做"
          title="重做（Ctrl+Shift+Z）"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 />
        </Button>
      </div>

      <div className="flex-1" />

      {busy && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {busy}
        </span>
      )}

      {doc && (
        <>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="缩小"
              onClick={() => onZoom(Math.max(0.05, Math.round(zoom * 80) / 100))}
            >
              <ZoomOut />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 [&_svg]:size-3.5"
              aria-label="放大"
              onClick={() => onZoom(Math.min(16, Math.round(zoom * 125) / 100))}
            >
              <ZoomIn />
            </Button>
            <Button variant="outline" size="sm" className="h-7" onClick={onFit}>
              <Maximize />
              适应窗口
            </Button>
          </div>
          <Separator orientation="vertical" className="h-4" />
        </>
      )}

      {onAddLayer && onAddGroup && onAddAdjustment && (
        <Dropdown label="新建" icon={<Plus />} disabled={!!busy}>
          {(close) => (
            <>
              <DropdownItem
                icon={<Plus />}
                label="纯色层"
                onClick={() => {
                  close();
                  onAddLayer();
                }}
              />
              <DropdownItem
                icon={<FolderPlus />}
                label="图层组"
                onClick={() => {
                  close();
                  onAddGroup();
                }}
              />
              <div className="my-1 h-px bg-[var(--color-border)]" />
              <div className="px-2 py-1 text-[10px] text-[var(--color-muted-foreground)]">
                文字 / 形状
              </div>
              <DropdownItem
                icon={<Type />}
                label="文字图层"
                onClick={() => {
                  close();
                  onAddTextLayer?.();
                }}
              />
              {SHAPE_MENU.map(({ kind }) => (
                <DropdownItem
                  key={kind}
                  icon={<Shapes />}
                  label={`形状 · ${SHAPE_LABELS[kind]}`}
                  onClick={() => {
                    close();
                    onAddShapeLayer?.(kind);
                  }}
                />
              ))}
              <div className="my-1 h-px bg-[var(--color-border)]" />
              <div className="px-2 py-1 text-[10px] text-[var(--color-muted-foreground)]">
                调整图层
              </div>
              {SUPPORTED_KINDS.map((kind) => (
                <DropdownItem
                  key={kind}
                  icon={<SlidersHorizontal />}
                  label={ADJUSTMENT_LABELS[kind]}
                  onClick={() => {
                    close();
                    onAddAdjustment(kind);
                  }}
                />
              ))}
            </>
          )}
        </Dropdown>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={onImportImage}
        disabled={!doc || !!busy}
      >
        <ImageIcon />
        导入图片
      </Button>

      <Dropdown label="打开 .comp" icon={<Upload />} disabled={!!busy}>
        {(close) => (
          <>
            <DropdownItem
              icon={<FileArchive />}
              label="选择 .comp 压缩包"
              hint=".zip"
              onClick={() => {
                close();
                onOpenZip();
              }}
            />
            <DropdownItem
              icon={<FolderOpen />}
              label="选择 .comp 文件夹"
              hint="目录"
              onClick={() => {
                close();
                onOpenFolder();
              }}
            />
          </>
        )}
      </Dropdown>

      <Dropdown label="导出" icon={<Download />} disabled={!doc || !!busy}>
        {(close) => (
          <>
            <DropdownItem
              icon={<ImageIcon />}
              label="PNG 图片"
              onClick={() => {
                close();
                onExportPng();
              }}
            />
            <DropdownItem
              icon={<FileArchive />}
              label=".comp 项目"
              hint=".zip"
              onClick={() => {
                close();
                onExportComp();
              }}
            />
          </>
        )}
      </Dropdown>
    </div>
  );
}

/* ────────────────────────────── 隐藏的文件输入 ────────────────────────────── */

function HiddenInputs({
  imageRef,
  zipRef,
  dirRef,
  onImage,
  onZip,
  onFolder
}: {
  imageRef: RefObject<HTMLInputElement | null>;
  zipRef: RefObject<HTMLInputElement | null>;
  dirRef: RefObject<HTMLInputElement | null>;
  onImage: (file: File) => void;
  onZip: (file: File) => void;
  onFolder: (files: FileList) => void;
}) {
  // React 的类型里没有 webkitdirectory，只能在挂载时直接设属性
  const attachDir = useCallback(
    (node: HTMLInputElement | null) => {
      dirRef.current = node;
      node?.setAttribute('webkitdirectory', '');
      node?.setAttribute('directory', '');
    },
    [dirRef]
  );

  return (
    <>
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImage(file);
          e.target.value = '';
        }}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,.comp,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onZip(file);
          e.target.value = '';
        }}
      />
      <input
        ref={attachDir}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFolder(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
