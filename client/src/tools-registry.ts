import { GitCompareArrows, type LucideIcon } from 'lucide-react';

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  path: string;
  icon: LucideIcon;
}

export const tools: ToolDef[] = [
  {
    id: 'diff',
    name: '差异对比',
    description: '基于 Monaco Editor 的差异对比工具，支持 文本/代码/DOCX/PDF，可通过 API 数据对比',
    path: '/tools/diff',
    icon: GitCompareArrows
  }
];
