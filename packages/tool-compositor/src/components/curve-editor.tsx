import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * 曲线编辑器。
 *
 * 坐标约定：控制点用图像空间 (x, y)，两者都是 0–255；画到屏幕上时 y 要翻转。
 * 曲线本身用 `curveLookup` 采样绘制 —— 与合成时用的是同一个插值实现，所见即所得。
 */

export interface CurvePoint {
  x: number;
  y: number;
}

const SIZE = 256;
const HIT_RADIUS = 14;

const toScreen = (p: CurvePoint): [number, number] => [p.x, SIZE - p.y];
const toCurve = (x: number, y: number): CurvePoint => ({ x, y: SIZE - y });

export function CurveEditor({
  points,
  lookup,
  onChange
}: {
  points: CurvePoint[];
  /** 与渲染端一致的查表函数，用来画曲线 */
  lookup: (points: CurvePoint[]) => Uint8ClampedArray;
  onChange: (points: CurvePoint[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const at = (SIZE / 4) * i + 0.5;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, SIZE);
      ctx.moveTo(0, at);
      ctx.lineTo(SIZE, at);
      ctx.stroke();
    }
    // 对角参考线
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    ctx.lineTo(SIZE, 0);
    ctx.stroke();

    // 曲线
    const lut = lookup(points);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < SIZE; x += 1) {
      const y = SIZE - lut[x];
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 控制点
    for (const point of points) {
      const [px, py] = toScreen(point);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [points, lookup]);

  const eventPoint = (e: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLCanvasElement;
  }): CurvePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * SIZE) / rect.width;
    const y = ((e.clientY - rect.top) * SIZE) / rect.height;
    return toCurve(
      Math.max(0, Math.min(255, Math.round(x))),
      Math.max(0, Math.min(255, Math.round(y)))
    );
  };

  const handleDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const target = eventPoint(e);
    let index = -1;
    let best = HIT_RADIUS;
    points.forEach((point, i) => {
      const [px, py] = toScreen(point);
      const [tx, ty] = toScreen(target);
      const distance = Math.hypot(px - tx, py - ty);
      if (distance < best) {
        best = distance;
        index = i;
      }
    });

    if (index < 0) {
      // 空白处按下 = 新增控制点
      const next = [...points, target].sort((a, b) => a.x - b.x);
      index = next.indexOf(target);
      onChange(next);
    }
    dragRef.current = index;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const index = dragRef.current;
    if (index === null) return;
    const target = eventPoint(e);
    const next = points.map((p) => ({ ...p }));
    const isFirst = index === 0;
    const isLast = index === points.length - 1;

    // 端点只允许上下移动，保持 0 / 255 的 x，曲线才有定义域
    if (isFirst) next[index] = { x: 0, y: target.y };
    else if (isLast) next[index] = { x: 255, y: target.y };
    else {
      const lower = next[index - 1].x + 1;
      const upper = next[index + 1].x - 1;
      next[index] = { x: Math.max(lower, Math.min(upper, target.x)), y: target.y };
    }
    onChange(next);
  };

  const handleUp = () => {
    dragRef.current = null;
  };

  /** 双击删除内部点 */
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (points.length <= 2) return;
    const target = eventPoint(e);
    let index = -1;
    let best = HIT_RADIUS;
    points.forEach((point, i) => {
      const [px, py] = toScreen(point);
      const [tx, ty] = toScreen(target);
      const distance = Math.hypot(px - tx, py - ty);
      if (distance < best) {
        best = distance;
        index = i;
      }
    });
    if (index > 0 && index < points.length - 1) {
      onChange(points.filter((_, i) => i !== index));
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className="h-auto w-full cursor-crosshair touch-none rounded border border-[var(--color-border)]"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}
