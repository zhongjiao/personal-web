import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileOutput, Gauge, Settings2 } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardTitle,
  downloadText,
  formatBytes,
  Select,
  Separator,
  stripExtension,
  useCopy
} from '@pmp/ui';
import { DropZone } from './components/drop-zone';
import { PreviewPanel, type PreviewView } from './components/preview-panel';
import { ResultPanel } from './components/result-panel';
import { convertFile, detectKind } from './lib/convert';
import {
  DEFAULT_OPTIONS,
  type ConvertOptions,
  type ConvertProgress,
  type ConvertResult,
  type PdfMode
} from './lib/types';

const PDF_MODES: { value: PdfMode; label: string; hint: string }[] = [
  {
    value: 'positioned',
    label: '文本 + 定位 · 可选可搜索',
    hint: '按原始坐标输出真实文字，体积小、可选中可搜索；图片与矢量图形不保留，扫描页会自动改用图片'
  },
  {
    value: 'image',
    label: '图片 · 版式最忠实',
    hint: '逐页渲染成图片，视觉效果与原文件一致；体积较大，文字不可选中'
  },
  {
    value: 'text',
    label: '纯文本 · 只保留文字',
    hint: '只提取文字并按行重排，方便复制再加工；多栏、表格、图片与字体样式都会丢失'
  }
];

const SCALE_OPTIONS = [
  { value: '1', label: '1x · 轻量' },
  { value: '1.5', label: '1.5x · 推荐' },
  { value: '2', label: '2x · 清晰' },
  { value: '3', label: '3x · 打印级' }
];

const QUALITY_OPTIONS = [
  { value: '0.6', label: '低（体积小）' },
  { value: '0.85', label: '中（推荐）' },
  { value: '0.95', label: '高' }
];

const PAGE_LIMIT_OPTIONS = [
  { value: '20', label: '20 页' },
  { value: '50', label: '50 页' },
  { value: '100', label: '100 页' },
  { value: '0', label: '全部页' }
];

export default function FileToHtmlPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [progress, setProgress] = useState<ConvertProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [stale, setStale] = useState(false);
  const [view, setView] = useState<PreviewView>('preview');
  const [zoom, setZoom] = useState(1);
  const runIdRef = useRef(0);

  const notify = useCallback((message: string, level: 'success' | 'error') => {
    if (level === 'success') toast.success(message);
    else toast.error(message);
  }, []);
  const copy = useCopy(notify);

  const kind = file ? detectKind(file.name) : null;
  const isPdf = kind === 'pdf';

  const run = useCallback(async (target: File, currentOptions: ConvertOptions) => {
    // 递增 runId：快速换文件时，旧任务的进度与结果不再回写
    const runId = ++runIdRef.current;
    setBusy(true);
    setError(null);
    setStale(false);
    setProgress({ phase: '准备中' });

    try {
      const output = await convertFile(target, currentOptions, (next) => {
        if (runId === runIdRef.current) setProgress(next);
      });
      if (runId !== runIdRef.current) return;
      setResult(output);
      setView('preview');
      toast.success(`转换完成，HTML 约 ${formatBytes(output.bytes)}`);
    } catch (cause) {
      if (runId !== runIdRef.current) return;
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      toast.error('转换失败');
    } finally {
      if (runId === runIdRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, []);

  const handleSelect = (selected: File) => {
    setFile(selected);
    setResult(null);
    setError(null);
    void run(selected, options);
  };

  const handleClear = () => {
    runIdRef.current++;
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(null);
    setBusy(false);
    setStale(false);
  };

  const updatePdf = (patch: Partial<ConvertOptions['pdf']>) => {
    setOptions((prev) => ({ ...prev, pdf: { ...prev.pdf, ...patch } }));
    if (result) setStale(true);
  };

  const handleDownload = () => {
    if (!result) return;
    downloadText(`${stripExtension(result.title)}.html`, result.html, 'text/html;charset=utf-8');
    toast.success('HTML 已开始下载');
  };

  const handleOpen = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2">
        <FileOutput className="h-4 w-4 text-[var(--color-primary)]" />
        <span className="text-sm font-medium">文档转 HTML</span>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-xs text-[var(--color-muted-foreground)]">
          PDF / Word / Excel / PPT / CSV / 图片 → 单文件 HTML，可预览、可下载，全程本地完成
        </span>
        <div className="flex-1" />
        {result && (
          <Badge variant="success">
            <Gauge />
            {formatBytes(result.bytes)}
          </Badge>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-auto border-r border-[var(--color-border)] p-3">
          <DropZone file={file} busy={busy} onSelect={handleSelect} onClear={handleClear} />

          {isPdf && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                  <CardTitle className="text-sm">PDF 输出设置</CardTitle>
                </div>

                <div className="space-y-1">
                  <Select
                    value={options.pdf.mode}
                    onChange={(event) => updatePdf({ mode: event.target.value as PdfMode })}
                    className="h-8 w-full text-xs"
                    disabled={busy}
                    aria-label="PDF 输出方式"
                  >
                    {PDF_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[11px] leading-4 text-[var(--color-muted-foreground)]">
                    {PDF_MODES.find((mode) => mode.value === options.pdf.mode)?.hint}
                  </p>
                </div>

                {options.pdf.mode === 'image' && (
                  <>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-[var(--color-muted-foreground)]">
                        渲染倍率（越大越清晰、体积越大）
                      </span>
                      <Select
                        value={String(options.pdf.scale)}
                        onChange={(event) => updatePdf({ scale: Number(event.target.value) })}
                        className="h-8 w-full text-xs"
                        disabled={busy}
                      >
                        {SCALE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] text-[var(--color-muted-foreground)]">图片格式</span>
                      <Select
                        value={options.pdf.format}
                        onChange={(event) =>
                          updatePdf({ format: event.target.value as ConvertOptions['pdf']['format'] })
                        }
                        className="h-8 w-full text-xs"
                        disabled={busy}
                      >
                        <option value="jpeg">JPEG · 体积小</option>
                        <option value="png">PNG · 无损（体积大）</option>
                      </Select>
                    </label>

                    {options.pdf.format === 'jpeg' && (
                      <label className="block space-y-1">
                        <span className="text-[11px] text-[var(--color-muted-foreground)]">JPEG 质量</span>
                        <Select
                          value={String(options.pdf.quality)}
                          onChange={(event) => updatePdf({ quality: Number(event.target.value) })}
                          className="h-8 w-full text-xs"
                          disabled={busy}
                        >
                          {QUALITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                  </>
                )}

                <label className="block space-y-1">
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">最多处理页数</span>
                  <Select
                    value={String(options.pdf.maxPages)}
                    onChange={(event) => updatePdf({ maxPages: Number(event.target.value) })}
                    className="h-8 w-full text-xs"
                    disabled={busy}
                  >
                    {PAGE_LIMIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>

                {stale && (
                  <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                    参数已修改，点下方「用新参数重新转换」生效
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <ResultPanel
            result={result}
            busy={busy}
            stale={stale}
            onReconvert={() => file && void run(file, options)}
            onDownload={handleDownload}
            onCopy={() => result && void copy(result.html, 'HTML 已复制到剪贴板')}
            onOpen={handleOpen}
          />

          <p className="px-1 text-[11px] leading-5 text-[var(--color-muted-foreground)]">
            文件不会离开你的浏览器：解析用的是本地打包的 pdf.js / mammoth / jszip，没有上传接口。
            仅 <span className="font-mono">.doc</span> 旧格式例外，它需要本地服务（LibreOffice）先转成 docx。
          </p>
        </aside>

        <main className="min-w-0 flex-1">
          <PreviewPanel
            result={result}
            view={view}
            zoom={zoom}
            busy={busy}
            progress={progress}
            error={error}
            onViewChange={setView}
            onZoomChange={setZoom}
          />
        </main>
      </div>
    </div>
  );
}
