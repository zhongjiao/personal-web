import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Keyboard, RotateCcw, Search, X } from 'lucide-react';
import {
  comboFromEvent,
  conflictOf,
  defaultShortcutMap,
  describeConflicts,
  findConflicts,
  formatCombo,
  SHORTCUT_DEFS,
  SHORTCUT_GROUP_ORDER,
  type ShortcutMap
} from '../lib/image-shortcuts';
import { cn } from '@pmp/ui';

interface ShortcutSettingsDialogProps {
  open: boolean;
  value: ShortcutMap;
  onClose: () => void;
  onSave: (map: ShortcutMap) => void;
}

export function ShortcutSettingsDialog({ open, value, onClose, onSave }: ShortcutSettingsDialogProps) {
  const [draft, setDraft] = useState<ShortcutMap>(value);
  const [recording, setRecording] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 打开时同步外部值
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setRecording(null);
    setError(null);
    setQuery('');
  }, [open, value]);

  // 打开时锁定背后页面滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const conflicts = useMemo(() => findConflicts(draft), [draft]);

  const bind = useCallback((id: string, combo: string | null) => {
    setDraft((d) => ({ ...d, [id]: combo }));
    setError(null);
  }, []);

  // 录制键位（capture 阶段，优先于页面快捷键）
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        bind(recording, null);
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      bind(recording, combo);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, bind]);

  // Esc 关闭
  useEffect(() => {
    if (!open || recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, recording, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_DEFS;
    return SHORTCUT_DEFS.filter(
      (d) =>
        d.label.toLowerCase().includes(q) || formatCombo(draft[d.id] ?? null).toLowerCase().includes(q)
    );
  }, [query, draft]);

  if (!open) return null;

  const conflictText = describeConflicts(conflicts);

  const handleSave = () => {
    if (conflictText) {
      setError(conflictText);
      return;
    }
    onSave(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-zinc-900/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-[0_24px_60px_-20px_rgba(124,58,237,0.5)]">
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3 border-b border-violet-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 text-white shadow-md shadow-violet-200">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight text-zinc-900">快捷键设置</h3>
              <p className="text-xs text-violet-500">
                点击右侧键位后按下新的组合键即可修改，已自动保存到本地
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 bg-violet-50/60 text-violet-500 transition-colors hover:border-violet-300 hover:bg-violet-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 工具条 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-violet-100 bg-violet-50/40 px-5 py-3">
          <label className="flex min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-violet-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索功能或键位…"
              className="min-w-0 flex-1 bg-transparent text-xs text-zinc-700 outline-none placeholder:text-zinc-400"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setDraft(defaultShortcutMap());
              setRecording(null);
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-medium text-violet-500 transition-colors hover:border-violet-300 hover:bg-violet-100"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </button>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {SHORTCUT_GROUP_ORDER.map((group) => {
            const items = filtered.filter((d) => d.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-4 last:mb-0">
                <p className="mb-2 text-[11px] font-semibold text-violet-500">{group}</p>
                <div className="flex flex-col gap-1.5">
                  {items.map((def) => {
                    const combo = draft[def.id] ?? null;
                    const conflictWith = conflictOf(draft, def.id, conflicts);
                    const isRecording = recording === def.id;
                    return (
                      <div
                        key={def.id}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2 transition-colors',
                          conflictWith
                            ? 'border-rose-200 bg-rose-50/40'
                            : 'border-violet-100 hover:border-violet-200'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs text-zinc-700">{def.label}</p>
                          {def.hint && <p className="truncate text-[10px] text-zinc-400">{def.hint}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {conflictWith && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-rose-500">
                              <AlertTriangle className="h-3 w-3" />
                              与「{conflictWith[0] && defLabel(conflictWith[0])}」重复
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setRecording(isRecording ? null : def.id)}
                            className={cn(
                              'min-w-[104px] rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all',
                              isRecording
                                ? 'animate-pulse border-violet-400 bg-violet-500 text-white'
                                : combo
                                  ? 'border-violet-200 bg-violet-50/60 font-mono text-violet-600 hover:border-violet-300 hover:bg-violet-100'
                                  : 'border-dashed border-violet-200 bg-white text-zinc-400 hover:border-violet-300'
                            )}
                          >
                            {isRecording ? '按下组合键…' : formatCombo(combo)}
                          </button>
                          {combo && !isRecording && (
                            <button
                              type="button"
                              onClick={() => bind(def.id, null)}
                              title="清除该键位"
                              className="flex h-6 w-6 items-center justify-center rounded-md border border-violet-100 text-violet-400 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-500"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-xs text-zinc-400">没有匹配的功能</p>
          )}
        </div>

        {/* 底部 */}
        <div className="border-t border-violet-100 bg-violet-50/40 px-5 py-3">
          {error || conflictText ? (
            <p className="mb-2 flex items-start gap-1.5 text-[11px] text-rose-500">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{error ?? conflictText}</span>
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-zinc-400">
              提示：同一个键位只能绑定一个功能；录制时按 Delete 清除、按 Esc 取消录制。
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-500 transition-colors hover:border-violet-300 hover:bg-violet-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl border border-violet-600 bg-violet-500 px-4 py-2 text-xs font-medium text-white shadow-sm shadow-violet-200 transition-colors hover:border-violet-500 hover:bg-violet-600"
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function defLabel(id: string): string {
  return SHORTCUT_DEFS.find((d) => d.id === id)?.label ?? id;
}
