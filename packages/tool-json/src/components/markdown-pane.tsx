import { useMemo, useRef, useState } from 'react';
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
  Sparkles,
  TextQuote,
  WrapText
} from 'lucide-react';
import {
  Badge,
  Button,
  cn,
  downloadText,
  Separator,
  stripExtension,
  ToggleGroup,
  ToggleGroupItem
} from '@pmp/ui';
import { CodeEditor } from './code-editor';
import { decodeEscapes, hasEscapes } from '../lib/escape';
import { renderMarkdown } from '../lib/markdown';
import { buildMarkdownDocument } from '../lib/markdown-doc';
import { SAMPLE_MARKDOWN } from '../lib/samples';
import { useCopy } from '../lib/use-copy';
import { useFileDrop } from '../lib/use-file-drop';
import type { MonacoTheme } from '../lib/use-monaco-theme';

type MarkdownView = 'split' | 'code' | 'preview';

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx', 'txt'];
const MARKDOWN_ACCEPT = MARKDOWN_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export function MarkdownPane({ theme }: { theme: MonacoTheme }) {
  const [source, setSource] = useState(SAMPLE_MARKDOWN);
  const [view, setView] = useState<MarkdownView>('split');
  const [breaks, setBreaks] = useState(false);
  const [fileName, setFileName] = useState('markdown');
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = useCopy();

  const dark = theme === 'vs-dark';
  const rendered = useMemo(() => renderMarkdown(source, { breaks }), [source, breaks]);
  const doc = useMemo(
    () =>
      buildMarkdownDocument({
        title: rendered.headings[0]?.text ?? 'Markdown 预览',
        body: rendered.html,
        dark
      }),
    [rendered, dark]
  );

  const hasContent = source.trim().length > 0;
  const { stats } = rendered;

  const handleDecode = () => {
    if (!hasEscapes(source)) {
      toast.info('没检测到转义序列');
      return;
    }
    setSource(decodeEscapes(source));
    toast.success('已去除转义');
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      setSource(await file.text());
      setFileName(stripExtension(file.name) || 'markdown');
      toast.success(`已导入 ${file.name}`);
    } catch {
      toast.error('文件读取失败');
    }
  };

  // 把 .md 文件直接拖进面板即可导入（编辑器 / 预览区域都行）
  const drop = useFileDrop({
    extensions: MARKDOWN_EXTENSIONS,
    onFile: (file) => void handleImport(file),
    onReject: (file) =>
      toast.error(`只支持 ${MARKDOWN_EXTENSIONS.map((ext) => `.${ext}`).join(' / ')}：${file.name}`)
  });

  const handleDownload = () => {
    if (!hasContent) {
      toast.error('没有可导出的内容');
      return;
    }
    downloadText(`${fileName}.html`, doc, 'text/html;charset=utf-8');
    toast.success('HTML 已开始下载');
  };

  const handleOpen = () => {
    if (!hasContent) {
      toast.error('没有可预览的内容');
      return;
    }
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...drop.handlers}>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as MarkdownView)}
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
          variant={breaks ? 'secondary' : 'outline'}
          onClick={() => setBreaks((value) => !value)}
          title="关闭时是 README 风格（单个换行视为空格），开启后单个换行也会断开"
        >
          <WrapText />
          {breaks ? '软换行 → <br>' : '软换行：关'}
        </Button>

        <Separator orientation="vertical" className="h-5" />

        <Button size="sm" variant="outline" onClick={handleDecode} title={'还原 \\n \\t \\" \\uXXXX 等转义'}>
          <TextQuote />
          去转义
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSource(SAMPLE_MARKDOWN);
            setFileName('markdown');
            toast.success('已载入示例');
          }}
        >
          <Sparkles />
          示例
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp />
          导入
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(source, 'Markdown 已复制')}>
          <Copy />
          复制 MD
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(doc, 'HTML 已复制')}>
          <Copy />
          复制 HTML
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download />
          导出 HTML
        </Button>
        <Button size="sm" variant="outline" onClick={handleOpen}>
          <ExternalLink />
          新窗口
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSource('');
            setFileName('markdown');
          }}
        >
          <Eraser />
          清空
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept={`${MARKDOWN_ACCEPT},text/markdown,text/plain`}
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
            <CodeEditor value={source} language="markdown" theme={theme} onChange={setSource} />
          </div>
        )}

        {view !== 'code' && (
          <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-muted)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
              <Monitor className="h-3.5 w-3.5" />
              <span className="max-w-[36%] truncate">
                {rendered.headings[0]?.text ?? (hasContent ? '未命名文档' : '等待输入')}
              </span>
              <Badge variant="outline">脚本不执行</Badge>
              <div className="flex-1" />
              <span>
                {stats.chars.toLocaleString('zh-CN')} 字符 · {stats.words.toLocaleString('zh-CN')} 词 ·{' '}
                {stats.lines} 行 · 标题 {stats.headings} · 代码块 {stats.codeBlocks} · 表格{' '}
                {stats.tables} · 任务 {stats.tasks}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {hasContent ? (
                <iframe
                  title="Markdown 预览"
                  // 空 sandbox：Markdown 里可能混入原始 HTML，禁掉脚本最稳
                  sandbox=""
                  srcDoc={doc}
                  className="mx-auto block h-full min-h-full w-full rounded-lg border border-[var(--color-border)] shadow-sm"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    把 <span className="font-mono">.md</span> 文件拖进面板，或点「导入文件」；
                    <br />
                    渲染支持 CommonMark + GFM 表格 / 任务列表 / 删除线
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSource(SAMPLE_MARKDOWN);
                        setFileName('markdown');
                      }}
                    >
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
          </div>
        )}
      </div>

      {/* 拖入遮罩：盖住编辑器与预览，保证 drop 落在这里而不是 Monaco / iframe */}
      {drop.active && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-background)]/85 backdrop-blur-[2px]">
          <div className="rounded-xl border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-card)] px-10 py-8 text-center shadow-lg">
            <FileUp className="mx-auto h-6 w-6 text-[var(--color-primary)]" />
            <p className="mt-2 text-sm font-medium">松开以导入 Markdown</p>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              支持 {MARKDOWN_EXTENSIONS.map((ext) => `.${ext}`).join(' / ')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
