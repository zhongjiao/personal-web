import { Suspense, lazy, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { ToolDef } from '@pmp/tool-contract';

/** 工具页面懒加载时的占位 */
function ToolFallback() {
  return (
    <div className="h-full flex items-center justify-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      <Loader2 className="h-4 w-4 animate-spin" />
      正在加载工具…
    </div>
  );
}

/** 把 ToolDef.load 包成路由可用的懒加载组件（每个工具一个独立 chunk） */
export function LazyTool({ def }: { def: ToolDef }) {
  const Tool = useMemo(() => lazy(def.load), [def]);
  return (
    <Suspense fallback={<ToolFallback />}>
      <Tool />
    </Suspense>
  );
}
