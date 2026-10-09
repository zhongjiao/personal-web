import { useRef, useState } from 'react';
import { FileUp, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Badge, Button, cn, formatBytes } from '@pmp/ui';
import { ACCEPT_ATTRIBUTE, detectKind } from '../lib/convert';
import { KIND_LABELS } from '../lib/types';

interface DropZoneProps {
  file: File | null;
  busy: boolean;
  onSelect: (file: File) => void;
  onClear: () => void;
}

export function DropZone({ file, busy, onSelect, onClear }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const kind = file ? detectKind(file.name) : null;

  const pick = () => inputRef.current?.click();

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) onSelect(selected);
          event.target.value = '';
        }}
      />

      {file ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                {formatBytes(file.size)}
              </p>
            </div>
            {busy ? (
              <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--color-primary)]" />
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {kind ? (
              <Badge variant="secondary">{KIND_LABELS[kind]}</Badge>
            ) : (
              <Badge variant="warning">
                <TriangleAlert />
                不支持的格式
              </Badge>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={pick} disabled={busy}>
              <FileUp />
              更换文件
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
              <X />
              移除
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) onSelect(dropped);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            dragging
              ? 'border-[var(--color-primary)] bg-[var(--color-accent)]'
              : 'border-[var(--color-border)] bg-[var(--color-card)]'
          )}
        >
          <FileUp className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          <p className="text-xs font-medium">把文件拖到这里</p>
          <Button size="sm" onClick={pick}>
            选择文件
          </Button>
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            一次一个文件 · 全程在浏览器本地处理
          </p>
        </div>
      )}
    </div>
  );
}
