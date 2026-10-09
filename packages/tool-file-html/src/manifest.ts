import { FileOutput } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'file-html',
  name: '文档转 HTML',
  description:
    '把 PDF / Word / Excel / PowerPoint / CSV / 图片转成自包含的单文件 HTML：在线预览 + 一键下载，全程浏览器本地完成',
  path: '/tools/file-html',
  icon: FileOutput,
  tags: ['PDF', 'Word', 'Excel', 'PPT'],
  load: () => import('./page')
});
