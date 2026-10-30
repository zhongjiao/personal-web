import { useState, type DragEvent } from 'react';

export interface FileDropOptions {
  /** 允许的扩展名（小写、不含点）；留空表示不校验 */
  extensions?: string[];
  /** 通过校验的文件 */
  onFile: (file: File) => void;
  /** 扩展名不匹配时 */
  onReject?: (file: File) => void;
}

export interface FileDropHandlers {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface FileDropState {
  /** 是否有文件正在被拖到容器上（用来渲染遮罩提示） */
  active: boolean;
  handlers: FileDropHandlers;
}

/** 只对「拖文件」生效：拖选中的文字不应该弹出遮罩 */
function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

/**
 * 让任意容器接收文件拖入。
 *
 * 几个容易踩的点：
 *  - `dragover` 必须 `preventDefault()`，否则浏览器会直接打开被拖入的文件；
 *  - 判断「离开」要看 `relatedTarget` 是否还在容器内 —— 鼠标在容器内的子元素之间移动
 *    同样会触发 dragleave，不判断的话遮罩会疯狂闪烁（也没法用计数器，子元素进出次数不对称）；
 *  - 遮罩层要能盖住下面的 Monaco / iframe，否则 drop 会落到它们身上。
 */
export function useFileDrop({ extensions = [], onFile, onReject }: FileDropOptions): FileDropState {
  const [active, setActive] = useState(false);

  return {
    active,
    handlers: {
      onDragEnter(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setActive(true);
      },

      onDragOver(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      },

      onDragLeave(event) {
        if (!isFileDrag(event)) return;
        const next = event.relatedTarget as Node | null;
        // 还在容器内部（比如移到了遮罩、工具栏上）不算离开；null 表示移出了窗口
        if (next && event.currentTarget.contains(next)) return;
        setActive(false);
      },

      onDrop(event) {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setActive(false);

        const file = event.dataTransfer?.files?.[0];
        if (!file) return;

        if (extensions.length > 0 && !extensions.includes(extensionOf(file.name))) {
          onReject?.(file);
          return;
        }
        onFile(file);
      }
    }
  };
}
