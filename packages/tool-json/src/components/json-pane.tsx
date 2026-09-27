import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDownAZ,
  Braces,
  CircleCheck,
  Columns2,
  Copy,
  Download,
  Eraser,
  FileUp,
  ListTree,
  Minimize2,
  Quote,
  Sparkles,
  TextQuote,
  TriangleAlert,
  WandSparkles
} from 'lucide-react';
import { Badge, Button, cn, Select, Separator, ToggleGroup, ToggleGroupItem } from '@pmp/ui';
import { CodeEditor } from './code-editor';
import { JsonTreeView } from './json-tree-view';
import {
  computeStats,
  formatBytes,
  formatJson,
  minifyJson,
  parseJson,
  sortKeysDeep
} from '../lib/json-utils';
import { decodeEscapes, encodeAsJsonString, hasEscapes } from '../lib/escape';
import { buildTree } from '../lib/json-tree';
import { SAMPLE_JSON } from '../lib/samples';
import { downloadText, timestampName } from '../lib/download';
import { useCopy } from '../lib/use-copy';
import type { MonacoTheme } from '../lib/use-monaco-theme';

type JsonView = 'split' | 'code' | 'tree';

const INDENT_OPTIONS = [
  { value: '2', label: '缩进：2 空格' },
  { value: '4', label: '缩进：4 空格' },
  { value: 'tab', label: '缩进：Tab' }
];

export function JsonPane({ theme }: { theme: MonacoTheme }) {
  const [text, setText] = useState(SAMPLE_JSON);
  const [view, setView] = useState<JsonView>('split');
  const [loose, setLoose] = useState(false);
  const [indent, setIndent] = useState('2');
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = useCopy();

  const trimmed = text.trim();
  const parsed = useMemo(() => (trimmed ? parseJson(text, loose) : null), [text, loose, trimmed]);
  const stats = useMemo(() => (parsed?.ok ? computeStats(parsed.value, text) : null), [parsed, text]);
  const tree = useMemo(() => (parsed?.ok ? buildTree(parsed.value) : null), [parsed]);

  const indentValue = indent === 'tab' ? '\t' : Number(indent);

  /** 需要「解析成功」才能做的操作统一走这里，顺带给出失败原因 */
  const withValue = (action: (value: unknown) => void) => {
    if (!parsed) {
      toast.error('还没有内容，先粘贴或导入 JSON');
      return;
    }
    if (!parsed.ok) {
      toast.error(parsed.error?.message ?? 'JSON 解析失败');
      return;
    }
    action(parsed.value);
  };

  const handleFormat = () =>
    withValue((value) => {
      setText(formatJson(value, indentValue));
      toast.success(`已格式化（${indent === 'tab' ? 'Tab' : `${indent} 空格`}缩进）`);
    });

  const handleMinify = () =>
    withValue((value) => {
      setText(minifyJson(value));
      toast.success('已压缩为单行');
    });

  const handleSortKeys = () =>
    withValue((value) => {
      setText(formatJson(sortKeysDeep(value), indentValue));
      toast.success('已按 key 递归排序');
    });

  const handleEscape = () => {
    setText(encodeAsJsonString(text));
    toast.success('已转义为 JSON 字符串');
  };

  const handleDecode = () => {
    if (!hasEscapes(text)) {
      toast.info('没检测到转义序列');
      return;
    }
    setText(decodeEscapes(text));
    toast.success('已去除转义');
  };

  const handleClear = () => setText('');

  const handleSample = () => {
    setText(SAMPLE_JSON);
    toast.success('已载入示例');
  };

  const handleDownload = () => {
    if (!trimmed) {
      toast.error('没有可导出的内容');
      return;
    }
    downloadText(timestampName('data', 'json'), text, 'application/json;charset=utf-8');
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      const result = parseJson(content, loose);
      if (result.ok) toast.success(`已导入 ${file.name}`);
      else toast.warning(`已导入 ${file.name}，但存在语法错误`);
    } catch {
      toast.error('文件读取失败');
    }
  };

  const indentSelect = (
    <Select
      value={indent}
      onChange={(event) => setIndent(event.target.value)}
      className="h-8 w-36 text-xs"
      aria-label="格式化缩进"
    >
      {INDENT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as JsonView)}
        >
          <ToggleGroupItem value="code" title="只看编辑器">
            <Braces />
            代码
          </ToggleGroupItem>
          <ToggleGroupItem value="split" title="左编辑器 / 右折叠树">
            <Columns2 />
            并排
          </ToggleGroupItem>
          <ToggleGroupItem value="tree" title="只看折叠树">
            <ListTree />
            树形
          </ToggleGroupItem>
        </ToggleGroup>

        <Separator orientation="vertical" className="h-5" />

        <Button size="sm" variant="default" onClick={handleFormat}>
          <WandSparkles />
          格式化
        </Button>
        <Button size="sm" variant="outline" onClick={handleMinify}>
          <Minimize2 />
          压缩
        </Button>
        <Button size="sm" variant="outline" onClick={handleSortKeys}>
          <ArrowDownAZ />
          排序键
        </Button>
        {indentSelect}

        <Separator orientation="vertical" className="h-5" />

        <Button size="sm" variant={loose ? 'secondary' : 'outline'} onClick={() => setLoose((v) => !v)}>
          {loose ? '宽松模式：开' : '宽松模式：关'}
        </Button>
        <Button size="sm" variant="outline" onClick={handleEscape} title="整段文本转义成 JSON 字符串">
          <Quote />
          转义
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

        <Separator orientation="vertical" className="h-5" />

        <Button size="sm" variant="outline" onClick={handleSample}>
          <Sparkles />
          示例
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp />
          导入
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(text, '已复制 JSON')}>
          <Copy />
          复制
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download />
          导出
        </Button>
        <Button size="sm" variant="ghost" onClick={handleClear}>
          <Eraser />
          清空
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.jsonc,.txt,.geojson,application/json,text/plain"
          className="hidden"
          onChange={(event) => {
            void handleImport(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      {/* 解析失败提示 */}
      {parsed && !parsed.ok && (
        <div className="flex items-start gap-2 border-b border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-destructive)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              JSON 解析失败
              {parsed.error && parsed.error.line > 0
                ? `（第 ${parsed.error.line} 行，第 ${parsed.error.column} 列）`
                : ''}
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--color-muted-foreground)]">
              {parsed.error?.message}
            </p>
          </div>
          {!loose && (
            <Button size="sm" variant="outline" onClick={() => setLoose(true)}>
              按宽松模式重试
            </Button>
          )}
        </div>
      )}

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        {view !== 'tree' && (
          <div
            className={cn(
              'min-w-0 flex-1',
              view === 'split' && 'border-r border-[var(--color-border)]'
            )}
          >
            <CodeEditor value={text} language="json" theme={theme} onChange={setText} />
          </div>
        )}

        {view !== 'code' && (
          <div className="min-w-0 flex-1 bg-[var(--color-card)]">
            {tree ? (
              <JsonTreeView tree={tree} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[var(--color-muted-foreground)]">
                {trimmed ? '修好语法错误后即可查看折叠树' : '左侧粘贴 / 导入 JSON，这里会显示可折叠的树形结构'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
        {!trimmed ? (
          <Badge variant="outline">等待输入</Badge>
        ) : parsed?.ok ? (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CircleCheck className="h-3.5 w-3.5" />
            有效 JSON
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[var(--color-destructive)]">
            <TriangleAlert className="h-3.5 w-3.5" />
            语法错误
          </span>
        )}

        {stats && (
          <span>
            节点 {stats.nodes} · 深度 {stats.depth} · 对象 {stats.objects} · 数组 {stats.arrays} ·{' '}
            {formatBytes(stats.bytes)} · {stats.lines} 行
          </span>
        )}
        {tree && <span>树节点 {tree.nodeCount}{tree.truncated ? '（已截断）' : ''}</span>}
        {loose && <Badge variant="warning">宽松模式：忽略注释与尾随逗号</Badge>}
      </div>
    </div>
  );
}
