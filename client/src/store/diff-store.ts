import { create } from 'zustand';
import type { FileKind } from '@/lib/file-parser';

interface DiffState {
  original: string;
  modified: string;
  originalName: string;
  modifiedName: string;
  originalKind: FileKind | null;
  modifiedKind: FileKind | null;
  /** 'auto' 或具体语言 */
  langMode: string;
  setSide: (side: 'original' | 'modified', text: string, name: string, kind: FileKind) => void;
  setText: (side: 'original' | 'modified', text: string) => void;
  setLangMode: (m: string) => void;
  swap: () => void;
  clear: () => void;
  loadFromApi: (data: { original: string; modified: string; language?: string }) => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  original: '// 选择左/右两个文件，自动识别语言并对比差异\n// 支持 文本/代码/DOCX/PDF\n',
  modified: '// 修改后内容（右侧）\n',
  originalName: '',
  modifiedName: '',
  originalKind: null,
  modifiedKind: null,
  langMode: 'auto',
  setSide: (side, text, name, kind) =>
    set(
      side === 'original'
        ? { original: text, originalName: name, originalKind: kind }
        : { modified: text, modifiedName: name, modifiedKind: kind }
    ),
  setText: (side, text) =>
    set(side === 'original' ? { original: text } : { modified: text }),
  setLangMode: (m) => set({ langMode: m }),
  swap: () =>
    set((s) => ({
      original: s.modified,
      modified: s.original,
      originalName: s.modifiedName,
      modifiedName: s.originalName,
      originalKind: s.modifiedKind,
      modifiedKind: s.originalKind
    })),
  clear: () =>
    set({
      original: '',
      modified: '',
      originalName: '',
      modifiedName: '',
      originalKind: null,
      modifiedKind: null,
      langMode: 'auto'
    }),
  loadFromApi: (data) =>
    set({
      original: data.original || '',
      modified: data.modified || '',
      originalName: '[API] original',
      modifiedName: '[API] modified',
      langMode: data.language || 'auto',
      originalKind: 'text',
      modifiedKind: 'text'
    })
}));
