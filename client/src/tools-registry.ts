import { Gamepad2, GitCompareArrows, type LucideIcon } from 'lucide-react';

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  path: string;
  icon: LucideIcon;
  tags: string[];
}

export const tools: ToolDef[] = [
  {
    id: 'diff',
    name: '差异对比',
    description: '基于 Monaco Editor 的差异对比工具，支持 文本/代码/DOCX/PDF，可通过 API 数据对比',
    path: '/tools/diff',
    icon: GitCompareArrows,
    tags: ['Monaco', 'DOCX', 'PDF']
  },
  {
    id: 'dino',
    name: '恐龙快打',
    description: '经典横版清关街机游戏，Canvas 手绘角色与恐龙，三关关卡 + BOSS，支持键鼠与触屏操作',
    path: '/tools/dino',
    icon: Gamepad2,
    tags: ['Canvas', '街机游戏', '动作闯关']
  }
];
