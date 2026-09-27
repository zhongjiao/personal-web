import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Braces,
  Columns2,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FileUp,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  TextQuote,
  Trash2
} from 'lucide-react';
import { Badge, Button, cn, Select, Separator, ToggleGroup, ToggleGroupItem } from '@pmp/ui';
import { CodeEditor } from './code-editor';
import {
  PREVIEW_MESSAGE_SOURCE,
  buildPreviewDocument,
  extractTitle,
  formatHtml,
  htmlStats,
  type PreviewLogLevel,
  type PreviewLogMessage
} from '../lib/html-doc';
import { decodeEscapes, hasEscapes } from '../lib/escape';
import { SAMPLE_HTML } from '../lib/samples';
import { downloadText, timestampName } from '../lib/download';
import { useCopy } from '../lib/use-copy';
import { formatBytes } from '../lib/json-utils';
import type { MonacoTheme } from '../lib/use-monaco-theme';

type HtmlView = 'split' | 'code' | 'preview';

interface LogEntry {
  id: number;
  level: PreviewLogLevel;
  text: string;
  time: string;
}

const WIDTH_OPTIONS = [
  { value: '0', label: '宽度：自适应' },
  { value: '375', label: '宽度：375 · 手机' },
  { value: '768', label: '宽度：768 · 平板' },
  { value: '1024', label: '宽度：1024' },
  { value: '1440', label: '宽度：1440' }
];

const LOG_STYLES: Record<PreviewLogLevel, string> = {
  log: 'text-[var(--color-foreground)]',
  debug: 'text-[var(--color-muted-foreground)]',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-[var(--color-destructive)]'
};

/** 沙箱一律不带 allow-same-origin：预览页因此拿不到本应用的 cookie / localStorage */
const SANDBOX_BASE = 'allow-forms allow-modals allow-popups allow-downloads';

export function HtmlPane({ theme }: { theme: MonacoTheme }) {
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [view, setView] = useState<HtmlView>('split');
  const [allowScripts, setAllowScripts] = useState(true);
  const [live, setLive] = useState(true);
  const [width, setWidth] = useState('0');
  const [committed, setCommitted] = useState(SAMPLE_HTML);
  const [nonce, setNonce] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = useCopy();

  // 实时模式下用 deferred value 平滑输入：连打时不会每个字符都重建一次 iframe
  const deferred = useDeferredValue(html);
  const source = live ? deferred : committed;

  const doc = useMemo(() => buildPreviewDocument(source, { allowScripts }), [source, allowScripts]);
  const stats = useMemo(() => htmlStats(html), [html]);
  const title = useMemo(() => extractTitle(html), [html]);

  const hasContent = html.trim().length > 0;
  const sandbox = allowScripts ? `${SANDBOX_BASE} allow-scripts` : SANDBOX_BASE;

  // 接收预览页回传的 console / 报错
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as PreviewLogMessage | undefined;
      if (!data || data.source !== PREVIEW_MESSAGE_SOURCE || data.type !== 'console') return;
      const entry: LogEntry = {
        id: ++logIdRef.current,
        level: data.level,
        text: data.args.join(' '),
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
      };
      setLogs((prev) => [...prev.slice(-199), entry]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const refresh = () => {
    setCommitted(html);
    setLogs([]);
    setNonce((n) => n + 1);
  };

  const handleFormat = () => {
    if (!hasContent) {
      toast.error('没有可格式化的内容');
      return;
    }
    setHtml(formatHtml(html));
    toast.success('已按标签缩进美化');
  };

  const handleDecode = () => {
    if (!hasEscapes(html)) {
      toast.info('没检测到转义序列');
      return;
    }
    setHtml(decodeEscapes(html));
    toast.success('已去除转义');
  };

  const handleDownload = () => {
    if (!hasContent) {
      toast.error('没有可导出的内容');
      return;
    }
    downloadText(timestampName('preview', 'html'), html, 'text/html;charset=utf-8');
  };

  const handleOpenExternal = () => {
    if (!hasContent) {
      toast.error('没有可预览的内容');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([buildPreviewDocument(html, { allowScripts })], { type: 'text/html' })
    );
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setHtml(content);
      setCommitted(content);
      setLogs([]);
      toast.success(`已导入 ${file.name}`);
    } catch {
      toast.error('文件读取失败');
    }
  };

  const handleClear = () => {
    setHtml('');
    setCommitted('');
    setLogs([]);
  };

  const handleSample = () => {
    setHtml(SAMPLE_HTML);
    setCommitted(SAMPLE_HTML);
    setLogs([]);
    toast.success('已载入示例');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as HtmlView)}
        >
          <ToggleGroupItem value="split" title="左源码 / 右预览">
            <Columns2 />
            分栏
          </ToggleGroupItem>
          <ToggleGroupItem value="code" title="只看源码">
            <Braces />
            源码
          </ToggleGroupItem>
          <ToggleGroupItem value="preview" title="只看预览">
            <Monitor />
            预览
          </ToggleGroupItem>
        </ToggleGroup>

        <Separator orientation="vertical" className="h-5" />

        <Button
          size="sm"
          variant={live ? 'secondary' : 'outline'}
          onClick={() => setLive((v) => !v)}
          title={live ? '输入时自动刷新预览' : '只在点「刷新」时更新预览'}
        >
          {live ? '实时预览：开' : '实时预览：关'}
        </Button>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw />
          刷新
        </Button>

        <Separator orientation="vertical" className="h-5" />

        <Button size="sm" variant="default" onClick={handleFormat}>
          格式化
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDecode}
          title={'还原 \\n \\t \\" \\uXXXX 等转义'}
        >
          <TextQuote />
          去转义
        </Button>
        <Button size="sm" variant="outline" onClick={handleSample}>
          <Sparkles />
          示例
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp />
          导入
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(html, '已复制 HTML')}>
          <Copy />
          复制
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download />
          导出
        </Button>
        <Button size="sm" variant="outline" onClick={handleOpenExternal}>
          <ExternalLink />
          新窗口
        </Button>
        <Button size="sm" variant="ghost" onClick={handleClear}>
          <Eraser />
          清空
        </Button>

        <Separator orientation="vertical" className="h-5" />

        <Button
          size="sm"
          variant={allowScripts ? 'secondary' : 'outline'}
          onClick={() => setAllowScripts((v) => !v)}
          title="关闭后 iframe sandbox 不再授予 allow-scripts"
        >
          <ShieldCheck />
          {allowScripts ? '允许脚本' : '已禁脚本'}
        </Button>
        <Select
          value={width}
          onChange={(event) => setWidth(event.target.value)}
          className="h-8 w-44 text-xs"
          aria-label="预览宽度"
        >
          {WIDTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,.txt,text/html,text/plain"
          className="hidden"
          onChange={(event) => {
            void handleImport(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <div
            className={cn(
              'min-w-0 flex-1',
              view === 'split' && 'border-r border-[var(--color-border)]'
            )}
          >
            <CodeEditor value={html} language="html" theme={theme} onChange={setHtml} />
          </div>
        )}

        {view !== 'code' && (
          <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-muted)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
              <Monitor className="h-3.5 w-3.5" />
              <span className="max-w-[40%] truncate">
                {title ?? (hasContent ? '未命名预览' : '等待输入')}
              </span>
              {hasContent && !title && <Badge variant="outline">HTML 片段</Badge>}
              {!allowScripts && <Badge variant="warning">脚本已禁用</Badge>}
              {!live && <Badge variant="outline">手动刷新</Badge>}
              <div className="flex-1" />
              <span>
                {stats.tags} 个标签 · {formatBytes(stats.bytes)} · {stats.lines} 行
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {hasContent ? (
                <div
                  className="mx-auto h-full"
                  style={{ width: width === '0' ? '100%' : `${width}px`, maxWidth: '100%' }}
                >
                  <iframe
                    key={`${nonce}-${allowScripts ? 'js' : 'nojs'}`}
                    title="HTML 预览"
                    className="h-full w-full rounded-lg border border-[var(--color-border)] bg-white shadow-sm"
                    sandbox={sandbox}
                    srcDoc={doc}
                  />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    粘贴 HTML 字符串（完整文档或片段都行），这里会实时渲染
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSample}>
                      <Sparkles />
                      载入示例
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                      <FileUp />
                      导入文件
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 控制台：预览页的 console 与运行时错误 */}
            <div className="flex h-40 shrink-0 flex-col border-t border-[var(--color-border)] bg-[var(--color-card)]">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <Terminal className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                <span className="text-xs font-medium">控制台</span>
                <Badge variant="secondary">{logs.length}</Badge>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setLogs([])} disabled={!logs.length}>
                  <Trash2 />
                  清空
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono text-[11px] leading-5">
                {logs.length === 0 ? (
                  <p className="text-[var(--color-muted-foreground)]">
                    {allowScripts
                      ? '暂无输出：预览页里的 console.log 与运行时错误会实时出现在这里'
                      : '脚本已禁用，控制台不会有输出'}
                  </p>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className="flex gap-2">
                      <span className="shrink-0 text-[var(--color-muted-foreground)]">
                        {entry.time}
                      </span>
                      <span className={cn('shrink-0 uppercase', LOG_STYLES[entry.level])}>
                        {entry.level}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 whitespace-pre-wrap break-all',
                          LOG_STYLES[entry.level]
                        )}
                      >
                        {entry.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
