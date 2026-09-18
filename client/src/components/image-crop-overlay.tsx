import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { clamp, type CropRect, type Rect } from '@/lib/image-editor';

type Handle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_DIRS: Record<Exclude<Handle, 'move'>, string> = {
  nw: 'nw',
  n: 'n',
  ne: 'ne',
  e: 'e',
  se: 'se',
  s: 's',
  sw: 'sw',
  w: 'w'
};

const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_STYLE: Record<Exclude<Handle, 'move'>, React.CSSProperties> = {
  nw: { left: -7, top: -7, cursor: 'nwse-resize' },
  n: { left: '50%', top: -7, marginLeft: -7, cursor: 'ns-resize' },
  ne: { right: -7, top: -7, cursor: 'nesw-resize' },
  e: { right: -7, top: '50%', marginTop: -7, cursor: 'ew-resize' },
  se: { right: -7, bottom: -7, cursor: 'nwse-resize' },
  s: { left: '50%', bottom: -7, marginLeft: -7, cursor: 'ns-resize' },
  sw: { left: -7, bottom: -7, cursor: 'nesw-resize' },
  w: { left: -7, top: '50%', marginTop: -7, cursor: 'ew-resize' }
};

export interface ImageCropOverlayProps {
  /** 图像在容器中的像素矩形 */
  imageRect: Rect;
  crop: CropRect;
  /** 像素宽高比；null 为自由裁剪 */
  aspect: number | null;
  active: boolean;
  onChange: (crop: CropRect) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

export function ImageCropOverlay({
  imageRect,
  crop,
  aspect,
  active,
  onChange,
  onDragStateChange
}: ImageCropOverlayProps) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    rect: Rect;
  } | null>(null);
  const rectRef = useRef(imageRect);
  const aspectRef = useRef(aspect);
  const changeRef = useRef(onChange);
  const dragCbRef = useRef(onDragStateChange);

  rectRef.current = imageRect;
  aspectRef.current = aspect;
  changeRef.current = onChange;
  dragCbRef.current = onDragStateChange;

  const px: Rect = {
    left: imageRect.left + crop.x * imageRect.width,
    top: imageRect.top + crop.y * imageRect.height,
    width: crop.w * imageRect.width,
    height: crop.h * imageRect.height
  };

  const begin = (handle: Handle) => (e: React.PointerEvent) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      rect: { ...px }
    };
    setDragging(true);
    dragCbRef.current?.(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const img = rectRef.current;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const minPx = Math.min(img.width, img.height) * 0.06;

      let l = d.rect.left;
      let t = d.rect.top;
      let r = d.rect.left + d.rect.width;
      let b = d.rect.top + d.rect.height;

      if (d.handle === 'move') {
        l = clamp(d.rect.left + dx, img.left, img.left + img.width - d.rect.width);
        t = clamp(d.rect.top + dy, img.top, img.top + img.height - d.rect.height);
        r = l + d.rect.width;
        b = t + d.rect.height;
      } else {
        const dirs = HANDLE_DIRS[d.handle];
        if (dirs.includes('w')) l = clamp(d.rect.left + dx, img.left, r - minPx);
        if (dirs.includes('e'))
          r = clamp(d.rect.left + d.rect.width + dx, l + minPx, img.left + img.width);
        if (dirs.includes('n')) t = clamp(d.rect.top + dy, img.top, b - minPx);
        if (dirs.includes('s'))
          b = clamp(d.rect.top + d.rect.height + dy, t + minPx, img.top + img.height);

        const asp = aspectRef.current;
        if (asp) {
          let w = r - l;
          let h = b - t;
          const horizontal = dirs.includes('e') || dirs.includes('w');
          if (horizontal) {
            h = w / asp;
          } else {
            w = h * asp;
          }
          if (w > img.width) {
            w = img.width;
            h = w / asp;
          }
          if (h > img.height) {
            h = img.height;
            w = h * asp;
          }
          if (dirs.includes('w')) l = r - w;
          else r = l + w;
          if (dirs.includes('n')) t = b - h;
          else b = t + h;
          if (l < img.left) {
            l = img.left;
            r = l + w;
          }
          if (t < img.top) {
            t = img.top;
            b = t + h;
          }
          if (r > img.left + img.width) {
            r = img.left + img.width;
            l = r - w;
          }
          if (b > img.top + img.height) {
            b = img.top + img.height;
            t = b - h;
          }
        }
      }

      changeRef.current({
        x: (l - img.left) / img.width,
        y: (t - img.top) / img.height,
        w: (r - l) / img.width,
        h: (b - t) / img.height
      });
    };
    const onUp = () => {
      setDragging(false);
      dragCbRef.current?.(false);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  const transition = dragging ? 'none' : 'left 320ms cubic-bezier(.22,.61,.36,1), top 320ms cubic-bezier(.22,.61,.36,1), width 320ms cubic-bezier(.22,.61,.36,1), height 320ms cubic-bezier(.22,.61,.36,1)';

  return (
    <div
      className={cn(
        'absolute inset-0 z-20',
        active ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      style={{ transition: 'opacity 280ms ease' }}
    >
      <div
        className="absolute cursor-move"
        style={{
          left: px.left,
          top: px.top,
          width: px.width,
          height: px.height,
          boxShadow: '0 0 0 9999px rgba(30, 14, 60, 0.55)',
          outline: '2px solid rgba(139, 92, 246, 0.95)',
          transition
        }}
        onPointerDown={begin('move')}
      >
        {/* 三分参考线 */}
        <div className="pointer-events-none absolute inset-0">
          {[33.33, 66.66].map((p) => (
            <div
              key={`v${p}`}
              className="absolute top-0 bottom-0 w-px bg-white/35"
              style={{ left: `${p}%` }}
            />
          ))}
          {[33.33, 66.66].map((p) => (
            <div
              key={`h${p}`}
              className="absolute left-0 right-0 h-px bg-white/35"
              style={{ top: `${p}%` }}
            />
          ))}
        </div>

        {HANDLES.map((h) => (
          <div
            key={h}
            onPointerDown={begin(h)}
            className="absolute h-3.5 w-3.5 rounded-full border-2 border-violet-500 bg-white shadow-sm transition-transform hover:scale-125"
            style={HANDLE_STYLE[h]}
          />
        ))}
      </div>
    </div>
  );
}
