import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FoldVertical,
  Search,
  UnfoldVertical
} from 'lucide-react';
import { Badge, Button, cn } from '@pmp/ui';
import {
  allBranchIds,
  defaultExpandedIds,
  findMatches,
  nodeToJson,
  previewOf,
  type BuildTreeResult,
  type JsonTreeNode
} from '../lib/json-tree';
import { useCopy } from '../lib/use-copy';

const TYPE_STYLES: Record<JsonTreeNode['type'], string> = {
  object: 'text-[var(--color-primary)]',
  array: 'text-[var(--color-primary)]',
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-amber-600 dark:text-amber-400',
  boolean: 'text-violet-600 dark:text-violet-400',
  null: 'text-[var(--color-muted-foreground)] italic'
};

/** 命中片段高亮（只处理前 50 段，避免超长行把 DOM 撑爆） */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let at = lower.indexOf(needle);
  let guard = 0;

  while (at >= 0 && guard < 50) {
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <mark
        key={`${at}-${guard}`}
        className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-400/30"
      >
        {text.slice(at, at + needle.length)}
      </mark>
    );
    cursor = at + needle.length;
    at = lower.indexOf(needle, cursor);
    guard++;
  }
  parts.push(text.slice(cursor));

  return <>{parts}</>;
}

interface RowProps {
  node: JsonTreeNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  query: string;
  matchIds: Set<string>;
  onCopy: (text: string, label?: string) => void;
}

function TreeRow({ node, expanded, onToggle, query, matchIds, onCopy }: RowProps) {
  const branch = node.type === 'object' || node.type === 'array';
  const open = branch && expanded.has(node.id);
  const label = node.index >= 0 ? `[${node.index}]` : (node.key ?? '$');
  const isMatch = matchIds.has(node.id);

  return (
    <>
      <div
        className={cn(
          'group flex items-center gap-1 rounded py-[2px] pr-1 font-mono text-xs leading-5 hover:bg-[var(--color-accent)]',
          isMatch && 'bg-amber-100/70 dark:bg-amber-400/10'
        )}
        style={{ paddingLeft: node.depth * 14 + 2 }}
      >
        {branch ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={open ? '折叠' : '展开'}
            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onCopy(node.path, `已复制路径 ${node.path}`)}
          title={`复制路径：${node.path}`}
          className="shrink-0 cursor-pointer text-sky-600 hover:underline dark:text-sky-400"
        >
          <Highlight text={label} query={query} />
        </button>

        <span className="shrink-0 text-[var(--color-muted-foreground)]">:</span>

        {branch ? (
          <>
            <span className={cn('shrink-0', TYPE_STYLES[node.type])}>
              {node.type === 'array' ? '[…]' : '{…}'}
            </span>
            <span className="shrink-0 text-[var(--color-muted-foreground)]">
              {node.size} 项
            </span>
          </>
        ) : (
          <span
            className={cn('min-w-0 truncate', TYPE_STYLES[node.type])}
            title={String(node.value)}
          >
            <Highlight text={previewOf(node)} query={query} />
          </span>
        )}

        <button
          type="button"
          onClick={() => onCopy(nodeToJson(node), '已复制该节点 JSON')}
          title="复制该节点 JSON"
          className="ml-auto shrink-0 cursor-pointer text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-foreground)] group-hover:opacity-100"
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
        </button>
      </div>

      {open &&
        node.children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            expanded={expanded}
            onToggle={onToggle}
            query={query}
            matchIds={matchIds}
            onCopy={onCopy}
          />
        ))}
    </>
  );
}

export function JsonTreeView({ tree }: { tree: BuildTreeResult }) {
  const [expanded, setExpanded] = useState(() => defaultExpandedIds(tree));
  const [query, setQuery] = useState('');
  const onCopy = useCopy();

  const matches = useMemo(() => findMatches(tree.root, query), [tree, query]);

  /**
   * 树每次重新解析都会换新对象（改一个字就重算），所以不能无脑重置展开状态：
   *  - 同一份文档被编辑：保留用户展开的位置，只把已经消失的路径剪掉；
   *  - 换了一份文档（顶层键变了）：回到默认展开策略。
   */
  const rootSignature = tree.root.children.map((child) => child.id).join('|');
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const isNewDocument = lastSignatureRef.current !== rootSignature;
    lastSignatureRef.current = rootSignature;

    setExpanded((prev) => {
      const branches = allBranchIds(tree);
      const next = new Set<string>();
      prev.forEach((id) => {
        if (branches.has(id)) next.add(id);
      });
      if (isNewDocument) defaultExpandedIds(tree).forEach((id) => next.add(id));
      return next;
    });
  }, [tree, rootSignature]);

  // 搜索时把命中的祖先链自动展开
  useEffect(() => {
    if (!query.trim() || matches.count === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      matches.ancestorIds.forEach((id) => next.add(id));
      return next;
    });
  }, [matches, query]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索键名或值…"
            className="h-8 w-52 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          />
        </div>

        {query.trim() && (
          <Badge variant={matches.count ? 'secondary' : 'outline'}>
            {matches.count ? `${matches.count} 处匹配` : '无匹配'}
          </Badge>
        )}

        <Button size="sm" variant="outline" onClick={() => setExpanded(allBranchIds(tree))}>
          <UnfoldVertical />
          展开全部
        </Button>
        <Button size="sm" variant="outline" onClick={() => setExpanded(new Set())}>
          <FoldVertical />
          折叠全部
        </Button>

        <div className="flex-1" />

        <span className="text-[11px] text-[var(--color-muted-foreground)]">
          {tree.nodeCount} 个节点
          {tree.truncated ? '（超出上限已截断）' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <TreeRow
          node={tree.root}
          expanded={expanded}
          onToggle={toggle}
          query={query.trim()}
          matchIds={matches.matchIds}
          onCopy={onCopy}
        />
      </div>
    </div>
  );
}
