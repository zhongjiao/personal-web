import { useCallback } from 'react';
import { toast } from 'sonner';
import { useCopy as useBaseCopy } from '@pmp/ui';

/** 复制 + sonner 提示（@pmp/ui 只提供复制与回调，提示由各工具自己决定） */
export function useCopy() {
  const notify = useCallback((message: string, level: 'success' | 'error') => {
    if (level === 'success') toast.success(message);
    else toast.error(message);
  }, []);

  return useBaseCopy(notify);
}
