import { Layers } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'compositor',
  name: '合成器',
  description:
    '以 .comp 文档格式为核心的多图层合成编辑器：图层组与混合模式、图层蒙版、非破坏性变换、调整图层与图层效果，项目可与桌面版 Compositor 互通',
  path: '/tools/compositor',
  icon: Layers,
  tags: ['合成', '图层', '.comp'],
  load: () => import('./page')
});
