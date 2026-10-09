import { useMemo } from 'react';
import { Eye, FileCode2, LoaderCircle, ScrollText, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge, Button, cn, formatBytes, Select, ToggleGroup, ToggleGroupItem } from '@pmp/ui';
import { SUPPORT_GROUPS } from '../lib/convert';
import type { ConvertProgress, ConvertResult } from '../lib/types';

export type PreviewView = 'preview' | 'source';

const ZOOM_OPTIONS = [
  { value: '0.5', label: '50%' },
  { value: '0.75', label: '75%' },
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' }
];

/** 源码视图最多渲染这么多字符，避免超大 HTML 把页面拖死 */
const SOURCE_LIMIT = 400_000;

interface PreviewPanelProps {
  result: ConvertResult | null;
  view: PreviewView;
  zoom: number;
  busy: boolean;
  progress: ConvertProgress | null;
  error: string | null;
  onViewChange: (view: PreviewView) => void;
  onZoomChange: (zoom: number) => void;
}

export function PreviewPanel({
  result,
  view,
  zoom,
  busy,
  progress,
  error,
  onViewChange,
  onZoomChange
}: PreviewPanelProps) {
  const source = useMemo(() => {
    if (!result) return '';
    return result.html.length > SOURCE_LIMIT ? result.html.slice(0, SOURCE_LIMIT) : result.html;
  }, [result]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && onViewChange(value as PreviewView)}
        >
          <ToggleGroupItem value="preview">
            <Eye />
            预览
          </ToggleGroupItem>
          <ToggleGroupItem value="source">
            <FileCode2 />
            HTML 源码
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="flex-1" />

        {result && view === 'preview' && (
          <>
            <Badge variant="outline">{formatBytes(result.bytes)}</Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onZoomChange(Math.max(0.5, Number((zoom - 0.25).toFixed(2))))}
              title="缩小"
            >
              <ZoomOut />
            </Button>
            <Select
              value={String(zoom)}
              onChange={(event) => onZoomChange(Number(event.target.value))}
              className="h-8 w-24 text-xs"
              aria-label="缩放"
            >
              {ZOOM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onZoomChange(Math.min(2, Number((zoom + 0.25).toFixed(2))))}
              title="放大"
            >
              <ZoomIn />
            </Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-muted)]">
        {busy && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
            <p className="text-sm">{progress?.phase ?? '正在转换…'}</p>
            {progress?.current !== undefined && progress.total ? (
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">
                {progress.current} / {progress.total}
              </p>
            ) : null}
          </div>
        )}

        {!busy && error && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md text-center">
              <p className="text-sm font-medium text-[var(--color-destructive)]">转换失败</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-muted-foreground)]">{error}</p>
            </div>
          </div>
        )}

        {!busy && !error && !result && (
          <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-8">
            <div className="text-center">
              <p className="text-sm font-medium">把 PDF / Word / Excel / PPT 等文件转成单文件 HTML</p>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                拖到左侧的虚线框，或点「选择文件」。解析与渲染都在浏览器本地完成，文件不会上传。
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SUPPORT_GROUPS.map((group) => (
                <div
                  key={group.label}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold">{group.label}</span>
                    <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                      {group.formats}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-[var(--color-muted-foreground)]">
                    {group.note}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!busy && !error && result && view === 'preview' && (
          <iframe
            title="HTML 预览"
            // 空 sandbox：生成的文档是纯静态的，禁用脚本 / 表单 / 弹窗最省心
            sandbox=""
            srcDoc={result.html}
            className="mx-auto block h-full min-h-full w-full border-0 bg-white"
            style={{ zoom }}
          />
        )}

        {!busy && !error && result && view === 'source' && (
          <div className="p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--color-muted-foreground)]">
              <ScrollText className="h-3.5 w-3.5" />
              <span>
                共 {result.html.length.toLocaleString('zh-CN')} 字符
                {result.html.length > SOURCE_LIMIT ? `（仅显示前 ${SOURCE_LIMIT.toLocaleString('zh-CN')} 个）` : ''}
              </span>
            </div>
            <pre
              className={cn(
                'overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3',
                'font-mono text-[11px] leading-5'
              )}
            >
              {source}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
