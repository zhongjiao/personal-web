import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '@pmp/ui';

/** 面板内的紧凑按钮 */
export function ToolButton({
  children,
  onClick,
  icon: Icon,
  variant = 'soft',
  disabled,
  active,
  block,
  title
}: {
  children: ReactNode;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
  variant?: 'soft' | 'primary' | 'ghost';
  disabled?: boolean;
  active?: boolean;
  block?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40',
        block && 'w-full',
        variant === 'primary'
          ? 'border-violet-300 bg-violet-500 text-white shadow-sm shadow-violet-200 hover:border-violet-400 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]'
          : variant === 'ghost'
            ? 'border-transparent text-violet-500 hover:border-violet-100 hover:bg-violet-50'
            : cn(
                'border-violet-200 bg-violet-50/60 text-violet-500 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-600 hover:shadow-sm active:scale-[0.98]',
                active && 'border-violet-300 bg-violet-100 text-violet-600'
              )
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/** 可折叠面板（状态记忆在 localStorage） */
export function Section({
  id,
  title,
  icon: Icon,
  children,
  action,
  defaultOpen = true
}: {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
}) {
  const storageKey = `pmp-konva-panel-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored === '1';
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* 忽略存储失败 */
    }
  }, [storageKey, open]);

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-[0_6px_20px_-12px_rgba(124,58,237,0.45)] transition-colors duration-300 hover:border-violet-300">
      <div className="flex w-full items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-100/80 text-violet-500">
              <Icon className="h-3.5 w-3.5" />
            </span>
            {title}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-2">
          {action}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? '收起面板' : '展开面板'}
            className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-violet-50"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-violet-300 transition-transform duration-300',
                !open && '-rotate-90'
              )}
            />
          </button>
        </span>
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-2.5 pt-3 pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** 滑杆行：标签 + 数值 + range，双击标签复位 */
export function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  decimals = 0,
  disabled,
  onChange,
  onReset
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className={cn('space-y-1', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between text-[11px]">
        <span
          onDoubleClick={onReset}
          className={cn('text-zinc-500', onReset && 'cursor-pointer select-none hover:text-violet-500')}
          title={onReset ? '双击复位' : undefined}
        >
          {label}
        </span>
        <span className="font-mono text-violet-500">
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-violet-100 outline-none transition-colors [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-violet-200 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-violet-200 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
      />
    </div>
  );
}

/** 胶囊样式的选择按钮 */
export const chipClass = (active: boolean) =>
  cn(
    'rounded-full border px-2.5 py-1 text-[11px] transition-all duration-200',
    active
      ? 'border-violet-300 bg-violet-500 text-white shadow-sm shadow-violet-200'
      : 'border-violet-200 bg-violet-50 text-violet-500 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-600'
  );

/** 复位小按钮（面板 action 用） */
export function ResetChip({ onClick, label = '重置' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-500 transition-colors hover:border-violet-300 hover:bg-violet-100"
    >
      <RotateCcw className="h-3 w-3" />
      {label}
    </button>
  );
}
