import { Sparkles } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'konva-image',
  name: 'Konva 图片编辑器',
  description:
    'Konva 底座的多图层编辑器：逐帧插值动画、旋转翻转拉伸、调色滤镜、裁剪、涂抹标注、图层管理与 1:1 导出',
  path: '/tools/konva-image',
  icon: Sparkles,
  tags: ['Konva', '动画', '多图层'],
  load: () => import('./page')
});
