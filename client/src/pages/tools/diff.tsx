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
  RotateCcw,
  Share2,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { parseFile, detectLanguageSmart } from '@/lib/file-parser';
import { pullDiff, pushDiff } from '@/lib/api';
import { useDiffStore } from '@/store/diff-store';

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

export default function DiffToolPage() {
  const [searchParams] = useSearchParams();
  const apiId = searchParams.get('id');

  const {
    original, modified, originalName, modifiedName,
    originalKind, modifiedKind, langMode,
    setSide, setLangMode, swap, clear, loadFromApi
  } = useDiffStore();

  const [parsing, setParsing] = useState(false);
  const originalInputRef = useRef<HTMLInputElement>(null);
  const modifiedInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<MonacoDiffEditor | null>(null);

  // ---- 通过 ?id= 拉取（TanStack Query）----
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

  // ---- 推送 API ----
  const pushMutation = useMutation({
    mutationFn: async () => {
      // 从编辑器读取最新值（用户可能直接编辑了 Monaco）
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
    if (langMode !== 'auto') return langMode;
    const isDoc = (k: string | null) => k === 'docx' || k === 'pdf' || k === 'doc';
    if (isDoc(originalKind) || isDoc(modifiedKind)) return 'plaintext';
    const l1 = detectLanguageSmart(originalName, original);
    const l2 = detectLanguageSmart(modifiedName, modified);
    if (l1 !== 'plaintext') return l1;
    if (l2 !== 'plaintext') return l2;
    return 'plaintext';
  }, [langMode, originalKind, modifiedKind, originalName, modifiedName, original, modified]);

  // ---- 主动同步内容到 Monaco model 并 layout（修复看不到内容的问题）----
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const oModel = ed.getOriginalEditor().getModel();
    const mModel = ed.getModifiedEditor().getModel();
    if (oModel && oModel.getValue() !== original) oModel.setValue(original);
    if (mModel && mModel.getValue() !== modified) mModel.setValue(modified);
    requestAnimationFrame(() => {
      try { ed.layout(); } catch { /* noop */ }
    });
  }, [original, modified]);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>, side: 'original' | 'modified') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    const t = toast.loading(`正在解析 ${file.name} ...`);
    try {
      const { text, kind, warning } = await parseFile(file);
      setSide(side, text, file.name, kind);
      toast.dismiss(t);
      const tag = kind === 'docx' ? '[DOCX]' : kind === 'pdf' ? '[PDF]' : kind === 'doc' ? '[DOC]' : '';
      if (warning) {
        toast.warning(`${file.name}：${warning}`);
      } else {
        toast.success(`已加载 ${tag} ${file.name}`, {
          description: kind === 'text' ? `${text.length} 字符` : `已转纯文本，${text.length} 字符`
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
      {/* Toolbar */}
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

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-muted)]">语言：</span>
          <Select
            value={langMode}
            onChange={(e) => setLangMode(e.target.value)}
            title="默认自动识别。手动选择后将不再自动切换"
          >
            <option value="auto">
              <Sparkles className="inline h-3 w-3" />
              自动{langMode === 'auto' ? `（${effectiveLanguage}）` : ''}
            </option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
          {langMode !== 'auto' && (
            <Button variant="ghost" size="sm" onClick={() => setLangMode('auto')}>
              <RotateCcw className="h-3 w-3" />
              自动
            </Button>
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

      {/* Editor */}
      <div className="flex-1 min-h-[400px] bg-[#1e1e1e] relative">
        <DiffEditor
          height="100%"
          width="100%"
          language={effectiveLanguage}
          original={original}
          modified={modified}
          theme="vs-dark"
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
      </div>

      {/* Status bar */}
      <div className="bg-slate-900 text-slate-400 text-xs px-5 py-1.5 flex gap-6 border-t border-slate-700">
        <span>左：{originalName || '未选择'} · {original.length} 字符</span>
        <span>右：{modifiedName || '未选择'} · {modified.length} 字符</span>
        <span className="ml-auto">语言：{effectiveLanguage}</span>
      </div>
    </div>
  );
}
