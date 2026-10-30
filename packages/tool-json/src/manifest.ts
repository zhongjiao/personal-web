import { Braces } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'json',
  name: 'JSON / HTML / Markdown',
  description:
    'JSON 格式化、压缩、排序与折叠查看；HTML 字符串沙箱预览；Markdown 实时渲染并可导出单文件 HTML',
  path: '/tools/json',
  icon: Braces,
  tags: ['JSON', 'HTML', 'Markdown'],
  load: () => import('./page')
});
