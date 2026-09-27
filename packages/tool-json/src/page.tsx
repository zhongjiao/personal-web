import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@pmp/ui';
import { HtmlPane } from './components/html-pane';
import { JsonPane } from './components/json-pane';
import { useMonacoTheme } from './lib/use-monaco-theme';

type PaneId = 'json' | 'html';

export default function JsonHtmlToolPage() {
  const theme = useMonacoTheme();
  const [pane, setPane] = useState<PaneId>('json');
  // 首次进入只挂载当前面板，切过去之后再保留挂载 —— 来回切换不丢内容与展开状态
  const [mounted, setMounted] = useState<Record<PaneId, boolean>>({ json: true, html: false });

  const select = (id: PaneId) => {
    setPane(id);
    setMounted((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={pane}
          onValueChange={(value) => value && select(value as PaneId)}
        >
          <ToggleGroupItem value="json">JSON 查看器</ToggleGroupItem>
          <ToggleGroupItem value="html">HTML 预览</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          解析、格式化与渲染全部在浏览器本地完成，不联网、不上传
        </span>
      </div>

      <div className={pane === 'json' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        {mounted.json && <JsonPane theme={theme} />}
      </div>
      <div className={pane === 'html' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        {mounted.html && <HtmlPane theme={theme} />}
      </div>
    </div>
  );
}
