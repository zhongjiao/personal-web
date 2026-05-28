import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DiffEditor, type MonacoDiffEditor } from '@monaco-editor/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeftRight,
  Code2,
  Eraser,
  FileText,
  FileUp,
  Hash,
  Loader2,
  Palette,
  RotateCcw,
  Share2,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { RichDiffView } from '@/components/rich-diff-view';
import { parseFile, detectLanguageSmart } from '@/lib/file-parser';
import { pullDiff, pushDiff } from '@/lib/api';
import { useDiffStore, type MonacoTheme, type ViewMode } from '@/store/diff-store';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  'plaintext', 'javascript', 'typescript', 'json', 'html', 'css',
  'markdown', 'python', 'java', 'go', 'sql', 'xml', 'yaml', 'shell'
];

const FILE_ACCEPT = [
  '.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yml', '.yaml',
  '.py', '.java', '.go', '.sql', '.sh', '.csv', '.log',
  '.doc', '.docx', '.pdf'
].join(',');

const VIEW_MODES: { value: ViewMode; label: string; icon: typeof Code2; desc: string }[] = [
  { value: 'text', label: '文本', icon: Code2, desc: '纯文本对比（适合代码/普通文本）' },
  { value: 'markdown', label: 'Markdown', icon: Hash, desc: '保留标题/列表等结构（推荐用于 docx）' },
  { value: 'rich', label: '富文本', icon: FileText, desc: '并排渲染并字级标注（最贴近 Word 视觉）' }
];

const MONACO_THEMES: { value: MonacoTheme; label: string }[] = [
  { value: 'vs-dark', label: '深色 (vs-dark)' },
  { value: 'vs', label: '浅色 (vs)' },
  { value: 'hc-black', label: '高对比黑 (hc-black)' },
  { value: 'hc-light', label: '高对比白 (hc-light)' }
];

export default function DiffToolPage() {
  const [searchParams] = useSearchParams();
  const apiId = searchParams.get('id');

  const {
    original, modified, originalHtml, modifiedHtml, originalMarkdown, modifiedMarkdown,
    originalName, modifiedName, originalKind, modifiedKind,
    langMode, viewMode, monacoTheme,
    setSide, setLangMode, setViewMode, setMonacoTheme, swap, clear, loadFromApi
  } = useDiffStore();

  const [parsing, setParsing] = useState(false);
  const originalInputRef = useRef<HTMLInputElement>(null);
  const modifiedInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MonacoDiffEditor | null>(null);

  // ---- API 拉取 ----
  useQuery({
    queryKey: ['diff', apiId],
    queryFn: async () => {
      const data = await pullDiff(apiId!);
      loadFromApi(data);
      toast.success(`已从 API 加载数据 (id=${apiId})`);
      return data;
    },
    enabled: !!apiId
  });

  // ---- 推送 ----
  const pushMutation = useMutation({
    mutationFn: async () => {
      const ed = editorRef.current;
      const cur = ed
        ? {
            original: ed.getOriginalEditor().getValue(),
            modified: ed.getModifiedEditor().getValue()
          }
        : { original, modified };
      return pushDiff({ ...cur, language: effectiveLanguage });
    },
    onSuccess: (id) => {
      const url = `${window.location.origin}/tools/diff?id=${id}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      toast.success('已推送，分享链接已复制', { description: url });
    },
    onError: (err: Error) => toast.error('推送失败', { description: err.message })
  });

  // ---- 自动语言识别 ----
  const effectiveLanguage = useMemo(() => {
    if (viewMode === 'markdown') return 'markdown';
    if (langMode !== 'auto') return langMode;
    const isDoc = (k: string | null) => k === 'docx' || k === 'pdf' || k === 'doc';
    if (isDoc(originalKind) || isDoc(modifiedKind)) return 'plaintext';
    const l1 = detectLanguageSmart(originalName, original);
    const l2 = detectLanguageSmart(modifiedName, modified);
    if (l1 !== 'plaintext') return l1;
    if (l2 !== 'plaintext') return l2;
    return 'plaintext';
  }, [viewMode, langMode, originalKind, modifiedKind, originalName, modifiedName, original, modified]);

  const { editorOriginal, editorModified } = useMemo(() => {
    if (viewMode === 'markdown' && (originalMarkdown || modifiedMarkdown)) {
      return { editorOriginal: originalMarkdown || original, editorModified: modifiedMarkdown || modified };
    }
    return { editorOriginal: original, editorModified: modified };
  }, [viewMode, original, modified, originalMarkdown, modifiedMarkdown]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const oModel = ed.getOriginalEditor().getModel();
    const mModel = ed.getModifiedEditor().getModel();
    if (oModel && oModel.getValue() !== editorOriginal) oModel.setValue(editorOriginal);
    if (mModel && mModel.getValue() !== editorModified) mModel.setValue(editorModified);
    requestAnimationFrame(() => {
      try { ed.layout(); } catch { /* noop */ }
    });
  }, [editorOriginal, editorModified, viewMode]);

  const hasRichContent = !!(originalHtml || modifiedHtml);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>, side: 'original' | 'modified') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    const t = toast.loading(`正在解析 ${file.name} ...`);
    try {
      const parsed = await parseFile(file);
      setSide(side, {
        text: parsed.text,
        html: parsed.html,
        markdown: parsed.markdown,
        name: file.name,
        kind: parsed.kind
      });
      toast.dismiss(t);
      const tag = parsed.kind === 'docx' ? 'DOCX' : parsed.kind === 'pdf' ? 'PDF' : parsed.kind === 'doc' ? 'DOC' : '';
      if (parsed.warning) {
        toast.warning(`${file.name}：${parsed.warning}`);
      } else {
        const extra = parsed.html ? '（含格式 HTML / Markdown）' : '';
        toast.success(`已加载 ${tag ? `[${tag}] ` : ''}${file.name} ${extra}`, {
          description: `${parsed.text.length} 字符`
        });
      }
    } catch (err) {
      toast.dismiss(t);
      toast.error('解析失败', { description: (err as Error).message });
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  const FilePicker = ({
    side,
    label,
    name,
    inputRef
  }: {
    side: 'original' | 'modified';
    label: string;
    name: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="font-normal">
        {label}
      </Badge>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={parsing}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp />
            选择文件
          </Button>
        </TooltipTrigger>
        <TooltipContent>支持 txt / md / 代码 / docx / pdf / doc</TooltipContent>
      </Tooltip>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(e) => handlePick(e, side)}
      />
      {name && (
        <span className="text-xs text-[var(--color-muted-foreground)] max-w-[200px] truncate">
          {name}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Toolbar 1: 文件选择 + 操作 */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-card)] px-5 py-3 flex flex-wrap items-center gap-3">
        <FilePicker side="original" label="原始" name={originalName} inputRef={originalInputRef} />
        <Separator orientation="vertical" className="h-6" />
        <FilePicker side="modified" label="修改" name={modifiedName} inputRef={modifiedInputRef} />

        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={swap}>
                <ArrowLeftRight />
                交换
              </Button>
            </TooltipTrigger>
            <TooltipContent>交换左右内容</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={clear}>
                <Eraser />
                清空
              </Button>
            </TooltipTrigger>
            <TooltipContent>清空当前所有内容</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={() => pushMutation.mutate()}
                disabled={pushMutation.isPending}
              >
                {pushMutation.isPending ? <Loader2 className="animate-spin" /> : <Share2 />}
                推送到 API
              </Button>
            </TooltipTrigger>
            <TooltipContent>生成可分享链接</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Toolbar 2: 视图模式 + 语言 + 主题 */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-background)] px-5 py-2.5 flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          size="sm"
          value={viewMode}
          onValueChange={(v) => v && setViewMode(v as ViewMode)}
        >
          {VIEW_MODES.map((m) => {
            const disabled = (m.value === 'rich' || m.value === 'markdown') && !hasRichContent;
            const Icon = m.icon;
            return (
              <Tooltip key={m.value}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={m.value} disabled={disabled} aria-label={m.label}>
                    <Icon />
                    <span>{m.label}</span>
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{disabled ? '需选择 docx 文件' : m.desc}</TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>

        {viewMode !== 'rich' && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
              <span className="text-xs text-[var(--color-muted-foreground)]">语言</span>
              <Select
                value={langMode}
                onChange={(e) => setLangMode(e.target.value)}
                className="h-8"
                disabled={viewMode === 'markdown'}
              >
                <option value="auto">
                  自动{langMode === 'auto' ? `（${effectiveLanguage}）` : ''}
                </option>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
              {langMode !== 'auto' && viewMode !== 'markdown' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={() => setLangMode('auto')}>
                      <RotateCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>恢复自动识别</TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Palette className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
              <span className="text-xs text-[var(--color-muted-foreground)]">编辑器主题</span>
              <Select
                value={monacoTheme}
                onChange={(e) => setMonacoTheme(e.target.value as MonacoTheme)}
                className="h-8"
              >
                {MONACO_THEMES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>
          </>
        )}

        {viewMode === 'rich' && (
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="destructive">删除</Badge>
            <Badge variant="success">新增</Badge>
            <span className="text-xs text-[var(--color-muted-foreground)]">字级标注</span>
          </div>
        )}
      </div>

      {/* Editor / Rich View */}
      <div className={cn(
        'flex-1 min-h-[400px] relative',
        viewMode === 'rich' ? 'bg-[var(--color-card)]' : ''
      )}>
        {viewMode === 'rich' ? (
          <RichDiffView originalHtml={originalHtml} modifiedHtml={modifiedHtml} />
        ) : (
          <DiffEditor
            height="100%"
            width="100%"
            language={effectiveLanguage}
            original={editorOriginal}
            modified={editorModified}
            theme={monacoTheme}
            loading={
              <div className="flex items-center gap-2 text-[var(--color-muted-foreground)] p-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                编辑器加载中…
              </div>
            }
            options={{
              renderSideBySide: true,
              originalEditable: true,
              readOnly: false,
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12 }
            }}
            onMount={(ed) => {
              editorRef.current = ed;
              requestAnimationFrame(() => {
                try { ed.layout(); } catch { /* noop */ }
              });
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-card)] text-xs px-5 py-1.5 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--color-muted-foreground)]">左：</span>
          <span className="font-medium truncate max-w-[180px]">{originalName || '未选择'}</span>
          <Badge variant="outline" className="font-normal">{original.length} 字符</Badge>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--color-muted-foreground)]">右：</span>
          <span className="font-medium truncate max-w-[180px]">{modifiedName || '未选择'}</span>
          <Badge variant="outline" className="font-normal">{modified.length} 字符</Badge>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[var(--color-muted-foreground)]">视图：</span>
          <Badge variant="secondary">
            {viewMode === 'rich' ? '富文本' : viewMode === 'markdown' ? 'Markdown' : effectiveLanguage}
          </Badge>
        </div>
      </div>
    </div>
  );
}
