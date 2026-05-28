import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DiffEditor, type MonacoDiffEditor } from '@monaco-editor/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeftRight,
  Eraser,
  FileUp,
  Loader2,
  Palette,
  RotateCcw,
  Share2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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

const VIEW_MODES: { value: ViewMode; label: string; desc: string }[] = [
  { value: 'text', label: '文本', desc: '纯文本对比（适合代码/普通文本）' },
  { value: 'markdown', label: 'Markdown', desc: '保留标题/列表等结构化格式（推荐用于 docx）' },
  { value: 'rich', label: '富文本', desc: '并排渲染并字级标注（最贴近 Word 视觉）' }
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

  // ---- 当前用于 Monaco 显示的内容（根据 viewMode 切换） ----
  const { editorOriginal, editorModified } = useMemo(() => {
    if (viewMode === 'markdown' && (originalMarkdown || modifiedMarkdown)) {
      return { editorOriginal: originalMarkdown || original, editorModified: modifiedMarkdown || modified };
    }
    return { editorOriginal: original, editorModified: modified };
  }, [viewMode, original, modified, originalMarkdown, modifiedMarkdown]);

  // ---- 主动同步内容到 Monaco model ----
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

  // 是否可用富文本/Markdown 模式（至少一边是 docx）
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
      const tag = parsed.kind === 'docx' ? '[DOCX]' : parsed.kind === 'pdf' ? '[PDF]' : parsed.kind === 'doc' ? '[DOC]' : '';
      if (parsed.warning) {
        toast.warning(`${file.name}：${parsed.warning}`);
      } else {
        const extra = parsed.html ? '（含格式 HTML / Markdown）' : '';
        toast.success(`已加载 ${tag} ${file.name} ${extra}`, {
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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Toolbar 1: 文件选择 */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-card)] px-5 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-muted)]">原始：</span>
          <Button
            variant="outline"
            size="sm"
            disabled={parsing}
            onClick={() => originalInputRef.current?.click()}
          >
            <FileUp className="h-3.5 w-3.5" />
            选择文件
          </Button>
          <input
            ref={originalInputRef}
            type="file"
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(e) => handlePick(e, 'original')}
          />
          {originalName && (
            <span className="text-xs text-[var(--color-muted)] max-w-[200px] truncate">{originalName}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-muted)]">修改：</span>
          <Button
            variant="outline"
            size="sm"
            disabled={parsing}
            onClick={() => modifiedInputRef.current?.click()}
          >
            <FileUp className="h-3.5 w-3.5" />
            选择文件
          </Button>
          <input
            ref={modifiedInputRef}
            type="file"
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(e) => handlePick(e, 'modified')}
          />
          {modifiedName && (
            <span className="text-xs text-[var(--color-muted)] max-w-[200px] truncate">{modifiedName}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={swap} title="交换左右">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            交换
          </Button>
          <Button variant="outline" size="sm" onClick={clear}>
            <Eraser className="h-3.5 w-3.5" />
            清空
          </Button>
          <Button
            size="sm"
            onClick={() => pushMutation.mutate()}
            disabled={pushMutation.isPending}
          >
            {pushMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            推送到 API
          </Button>
        </div>
      </div>

      {/* Toolbar 2: 视图模式 + 语言 + 主题 */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-accent)] px-5 py-2 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-[var(--color-card)] rounded-md p-0.5 border border-[var(--color-border)]">
          {VIEW_MODES.map((m) => {
            const disabled = (m.value === 'rich' || m.value === 'markdown') && !hasRichContent;
            return (
              <button
                key={m.value}
                disabled={disabled}
                onClick={() => setViewMode(m.value)}
                title={disabled ? '需选择 docx 文件' : m.desc}
                className={cn(
                  'px-3 py-1 text-xs rounded transition-colors',
                  viewMode === m.value
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-fg)] hover:bg-[var(--color-accent)]',
                  disabled && 'opacity-40 cursor-not-allowed'
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {viewMode !== 'rich' && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-muted)]">语言：</span>
              <Select
                value={langMode}
                onChange={(e) => setLangMode(e.target.value)}
                className="h-8"
                disabled={viewMode === 'markdown'}
                title={viewMode === 'markdown' ? 'Markdown 模式固定使用 markdown 语言' : '默认自动'}
              >
                <option value="auto">
                  自动{langMode === 'auto' ? `（${effectiveLanguage}）` : ''}
                </option>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
              {langMode !== 'auto' && viewMode !== 'markdown' && (
                <Button variant="ghost" size="sm" onClick={() => setLangMode('auto')}>
                  <RotateCcw className="h-3 w-3" />
                  自动
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Palette className="h-3.5 w-3.5 text-[var(--color-muted)]" />
              <span className="text-xs text-[var(--color-muted)]">主题：</span>
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
          <span className="ml-auto text-xs text-[var(--color-muted)]">
            富文本模式：左侧红色为删除，右侧绿色为新增
          </span>
        )}
      </div>

      {/* Editor / Rich View */}
      <div className={cn(
        'flex-1 min-h-[400px] relative',
        viewMode === 'rich' ? 'bg-white' : 'bg-[#1e1e1e]'
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
              <div className="flex items-center gap-2 text-slate-400 p-6">
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
              wordWrap: 'on'
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
      <div className={cn(
        'text-xs px-5 py-1.5 flex gap-6 border-t',
        viewMode === 'rich'
          ? 'bg-slate-50 text-slate-600 border-slate-200'
          : 'bg-slate-900 text-slate-400 border-slate-700'
      )}>
        <span>左：{originalName || '未选择'} · {original.length} 字符</span>
        <span>右：{modifiedName || '未选择'} · {modified.length} 字符</span>
        <span className="ml-auto">
          {viewMode === 'rich' ? '富文本' : viewMode === 'markdown' ? 'Markdown' : `语言：${effectiveLanguage}`}
        </span>
      </div>
    </div>
  );
}
