import { useCallback } from 'react';
import { copyText } from './clipboard';

type Notify = (message: string, level: 'success' | 'error') => void;

/**
 * 统一的「复制 + 提示」入口。
 * 提示方式由调用方注入（外壳用 sonner，也可以传自己的实现），
 * 这样 @pmp/ui 不必为一个 hook 引入 toast 依赖。
 */
export function useCopy(notify: Notify) {
  return useCallback(
    async (text: string, label = '已复制到剪贴板') => {
      const ok = await copyText(text);
      if (ok) notify(label, 'success');
      else notify('复制失败，请手动选择内容复制', 'error');
    },
    [notify]
  );
}
