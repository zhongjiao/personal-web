import { Braces } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'json',
  name: 'JSON / HTML 工具',
  description: 'JSON 格式化、压缩、排序与折叠查看器；HTML 字符串沙箱实时预览（含控制台与报错回传）',
  path: '/tools/json',
  icon: Braces,
  tags: ['JSON', 'HTML', '格式化'],
  load: () => import('./page')
});
