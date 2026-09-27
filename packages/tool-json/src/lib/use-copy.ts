import { useCallback } from 'react';
import { toast } from 'sonner';
import { copyText } from './clipboard';

/** 统一的「复制 + 提示」入口，避免每个按钮都写一遍 try/catch 与 toast */
export function useCopy() {
  return useCallback(async (text: string, label = '已复制到剪贴板') => {
    const ok = await copyText(text);
    if (ok) toast.success(label);
    else toast.error('复制失败，请手动选择内容复制');
  }, []);
}
