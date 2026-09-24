import { Wand2 } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'beauty',
  name: '美图工坊',
  description:
    '美图秀秀式日常修图：一键美颜、12 款滤镜、色温与光影调节、贴纸文字、旋转翻转与高清导出，全程本地处理',
  path: '/tools/beauty',
  icon: Wand2,
  tags: ['美颜', '滤镜', '贴纸'],
  load: () => import('./page')
});
