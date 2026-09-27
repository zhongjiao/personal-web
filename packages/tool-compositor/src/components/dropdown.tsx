import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@pmp/ui';

interface DropdownProps {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** 渲染菜单项；调用参数里的 `close` 收起菜单（要在触发文件选择框之前调用） */
  children: (close: () => void) => ReactNode;
}

/** 轻量下拉菜单：点外部 / Escape 收起 */
export function Dropdown({ label, icon, disabled, children }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-20 w-max min-w-[200px] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xl"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  icon,
  label,
  hint,
  disabled,
  onClick
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50 disabled:hover:bg-transparent [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      {icon}
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {hint && (
        <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">{hint}</span>
      )}
    </button>
  );
}
