import { GitCompareArrows } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'diff',
  name: '差异对比',
  description: '基于 Monaco Editor 的差异对比工具，支持 文本/代码/DOCX/PDF，可通过 API 数据对比',
  path: '/tools/diff',
  icon: GitCompareArrows,
  tags: ['Monaco', 'DOCX', 'PDF'],
  load: () => import('./page')
});
