import { Copy, Download, ExternalLink, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardTitle, Separator } from '@pmp/ui';
import { KIND_LABELS, type ConvertResult } from '../lib/types';

interface ResultPanelProps {
  result: ConvertResult | null;
  busy: boolean;
  stale: boolean;
  onReconvert: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onOpen: () => void;
}

export function ResultPanel({
  result,
  busy,
  stale,
  onReconvert,
  onDownload,
  onCopy,
  onOpen
}: ResultPanelProps) {
  if (!result) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">转换结果</CardTitle>
          <Badge variant="secondary">{KIND_LABELS[result.kind]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {result.stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <p className="text-[11px] text-[var(--color-muted-foreground)]">{stat.label}</p>
              <p className="truncate font-mono text-xs" title={stat.value}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {result.warnings.length > 0 && (
          <>
            <Separator />
            <ul className="space-y-1.5">
              {result.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-[11px] leading-4 text-[var(--color-muted-foreground)]">
                    {warning}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onDownload} disabled={busy}>
            <Download />
            下载 HTML
          </Button>
          <Button size="sm" variant="outline" onClick={onCopy} disabled={busy}>
            <Copy />
            复制 HTML
          </Button>
          <Button size="sm" variant="outline" onClick={onOpen} disabled={busy}>
            <ExternalLink />
            新窗口打开
          </Button>
          {stale && (
            <Button size="sm" variant="secondary" onClick={onReconvert} disabled={busy}>
              <RefreshCw />
              用新参数重新转换
            </Button>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-[var(--color-muted-foreground)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            生成的 HTML 是单个文件：样式内联、图片以 data URI 嵌入，离线打开也能正常显示，可直接发给别人。
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
