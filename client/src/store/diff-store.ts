import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileKind } from '@/lib/file-parser';

export type ViewMode = 'text' | 'markdown' | 'rich';
export type MonacoTheme = 'vs-dark' | 'vs' | 'hc-black' | 'hc-light';

interface DiffState {
  /** 纯文本 */
  original: string;
  modified: string;
  /** docx 提取的 HTML（保留格式） */
  originalHtml: string;
  modifiedHtml: string;
  /** docx 转 Markdown */
  originalMarkdown: string;
  modifiedMarkdown: string;

  originalName: string;
  modifiedName: string;
  originalKind: FileKind | null;
  modifiedKind: FileKind | null;

  langMode: string; // 'auto' 或具体语言
  viewMode: ViewMode; // 文本 / Markdown / 富文本
  monacoTheme: MonacoTheme;
  /** 只读模式：true 时编辑器禁止编辑 + 关闭语法检测 */
  readOnly: boolean;

  setSide: (
    side: 'original' | 'modified',
    payload: { text: string; html?: string; markdown?: string; name: string; kind: FileKind }
  ) => void;
  setText: (side: 'original' | 'modified', text: string) => void;
  setLangMode: (m: string) => void;
  setViewMode: (m: ViewMode) => void;
  setMonacoTheme: (t: MonacoTheme) => void;
  setReadOnly: (v: boolean) => void;
  swap: () => void;
  clear: () => void;
  loadFromApi: (data: { original: string; modified: string; language?: string }) => void;
}

const initial = {
  original: '// 选择左/右两个文件，自动识别语言并对比差异\n// 支持 文本/代码/DOCX（含格式）/PDF\n',
  modified: '// 修改后内容（右侧）\n',
  originalHtml: '',
  modifiedHtml: '',
  originalMarkdown: '',
  modifiedMarkdown: '',
  originalName: '',
  modifiedName: '',
  originalKind: null as FileKind | null,
  modifiedKind: null as FileKind | null,
  langMode: 'auto'
};

export const useDiffStore = create<DiffState>()(
  persist(
    (set) => ({
      ...initial,
      viewMode: 'text',
      monacoTheme: 'vs-dark',
      readOnly: true,

      setSide: (side, p) =>
        set(
          side === 'original'
            ? {
                original: p.text,
                originalHtml: p.html || '',
                originalMarkdown: p.markdown || '',
                originalName: p.name,
                originalKind: p.kind
              }
            : {
                modified: p.text,
                modifiedHtml: p.html || '',
                modifiedMarkdown: p.markdown || '',
                modifiedName: p.name,
                modifiedKind: p.kind
              }
        ),
      setText: (side, text) =>
        set(side === 'original' ? { original: text } : { modified: text }),
      setLangMode: (m) => set({ langMode: m }),
      setViewMode: (m) => set({ viewMode: m }),
      setMonacoTheme: (t) => set({ monacoTheme: t }),
      setReadOnly: (v) => set({ readOnly: v }),
      swap: () =>
        set((s) => ({
          original: s.modified,
          modified: s.original,
          originalHtml: s.modifiedHtml,
          modifiedHtml: s.originalHtml,
          originalMarkdown: s.modifiedMarkdown,
          modifiedMarkdown: s.originalMarkdown,
          originalName: s.modifiedName,
          modifiedName: s.originalName,
          originalKind: s.modifiedKind,
          modifiedKind: s.originalKind
        })),
      clear: () => set({ ...initial, original: '', modified: '' }),
      loadFromApi: (data) =>
        set({
          original: data.original || '',
          modified: data.modified || '',
          originalHtml: '',
          modifiedHtml: '',
          originalMarkdown: '',
          modifiedMarkdown: '',
          originalName: '[API] original',
          modifiedName: '[API] modified',
          langMode: data.language || 'auto',
          originalKind: 'text',
          modifiedKind: 'text'
        })
    }),
    {
      name: 'pmp-diff-prefs',
      // 只持久化用户偏好，不持久化具体内容
      partialize: (s) => ({ viewMode: s.viewMode, monacoTheme: s.monacoTheme, readOnly: s.readOnly })
    }
  )
);
