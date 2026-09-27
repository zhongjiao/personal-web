import { useEffect, useState, type ReactNode } from 'react';
import type { CompRgb } from '../lib/comp-format';

/** 属性面板 / 调整表单 / 效果表单共用的表单原子 */

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5">
      <span className="w-16 shrink-0 text-[10px] text-[var(--color-muted-foreground)]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SliderRow({
  label,
  min,
  max,
  step = 1,
  value,
  display,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          className="h-1 min-w-0 flex-1 accent-[var(--color-primary)]"
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
          {display}
        </span>
      </div>
    </Row>
  );
}

const INPUT_CLASS =
  'w-full min-w-0 rounded border border-[var(--color-input)] bg-[var(--color-background)] px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[var(--color-ring)]';

/** 受控数字输入：输入过程保留文本，失焦 / 回车才提交 */
export function NumInput({
  value,
  onCommit
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const rounded = Math.round(value * 100) / 100;
  const [text, setText] = useState(String(rounded));

  useEffect(() => setText(String(rounded)), [rounded]);

  return (
    <input
      type="number"
      value={text}
      className={INPUT_CLASS}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const parsed = Number(text);
        if (Number.isFinite(parsed)) onCommit(parsed);
        else setText(String(rounded));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function CheckRow({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="checkbox"
        checked={checked}
        className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        onChange={(e) => onChange(e.target.checked)}
      />
    </Row>
  );
}

const rgbToHex = (color: CompRgb): string =>
  `#${[color.red, color.green, color.blue]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

const hexToRgb = (hex: string): CompRgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return {
    red: ((n >> 16) & 255) / 255,
    green: ((n >> 8) & 255) / 255,
    blue: (n & 255) / 255
  };
};

export function ColorRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: CompRgb;
  onChange: (color: CompRgb) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="color"
        value={rgbToHex(value)}
        className="h-6 w-14 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0"
        onChange={(e) => onChange(hexToRgb(e.target.value))}
      />
    </Row>
  );
}

/** 小节标题 */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1">
      <span className="text-[10px] font-medium tracking-wide text-[var(--color-muted-foreground)]">
        {children}
      </span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
      {action}
    </div>
  );
}
