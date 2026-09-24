import { Image as ImageIcon } from 'lucide-react';
import { defineTool } from '@pmp/tool-contract';

export const toolManifest = defineTool({
  id: 'photoshop',
  name: 'Photoshop 基础',
  description:
    '本地运行的位图编辑器：画笔 / 橡皮 / 油漆桶 / 渐变 / 文字 / 形状、矩形与椭圆选区、多图层混合、调整滤镜与 PNG/JPG/WEBP 导出',
  path: '/tools/photoshop',
  icon: ImageIcon,
  tags: ['位图', '图层', '选区'],
  load: () => import('./page')
});
