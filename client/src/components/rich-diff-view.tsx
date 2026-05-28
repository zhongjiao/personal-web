import { useMemo } from 'react';
import { diffWords } from 'diff';
import styles from './rich-diff-view.module.css';

interface RichDiffViewProps {
  /** 原始 HTML */
  originalHtml: string;
  /** 修改后 HTML */
  modifiedHtml: string;
}

/**
 * 提取 HTML 中的纯文本，但保留段落 / 列表 / 标题等块级换行
 */
function htmlToBlockText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  const blocks = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BR', 'BLOCKQUOTE'];
  const walk = (node: Node, out: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    for (const child of Array.from(el.childNodes)) walk(child, out);
    if (blocks.includes(el.tagName)) out.push('\n');
  };
  const out: string[] = [];
  walk(div, out);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSideDiff(leftText: string, rightText: string): { left: string; right: string } {
  const diff = diffWords(leftText, rightText);
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

  let left = '';
  let right = '';
  for (const part of diff) {
    const safe = escape(part.value);
    if (part.added) {
      right += `<ins>${safe}</ins>`;
    } else if (part.removed) {
      left += `<del>${safe}</del>`;
    } else {
      left += safe;
      right += safe;
    }
  }
  return { left, right };
}

export function RichDiffView({ originalHtml, modifiedHtml }: RichDiffViewProps) {
  const { leftHtml, rightHtml } = useMemo(() => {
    const leftText = htmlToBlockText(originalHtml);
    const rightText = htmlToBlockText(modifiedHtml);
    const { left, right } = buildSideDiff(leftText, rightText);
    return { leftHtml: left, rightHtml: right };
  }, [originalHtml, modifiedHtml]);

  return (
    <div className="grid grid-cols-2 h-full overflow-hidden bg-white">
      <div className="overflow-auto p-6 border-r border-[var(--color-border)]">
        <div className={styles.side} dangerouslySetInnerHTML={{ __html: leftHtml }} />
      </div>
      <div className="overflow-auto p-6">
        <div className={styles.side} dangerouslySetInnerHTML={{ __html: rightHtml }} />
      </div>
    </div>
  );
}
