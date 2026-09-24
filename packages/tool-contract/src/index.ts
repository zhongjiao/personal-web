import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 工具元信息 + 懒加载入口。
 *
 * 每个工具包在 `src/manifest.ts` 中导出一个 `ToolDef`，
 * 应用外壳（apps/web）只依赖各包的 `./manifest` 子路径，
 * 页面本体通过 `load()` 动态 import，保证被拆成独立 chunk。
 */
export interface ToolDef {
  /** 唯一标识，同时作为注册表 key */
  id: string;
  /** 展示名称 */
  name: string;
  /** 一句话描述（首页卡片与顶栏副标题共用） */
  description: string;
  /** 路由路径，需以 `/` 开头 */
  path: string;
  /** 侧边栏图标 */
  icon: LucideIcon;
  /** 标签，用于首页筛选 / 展示 */
  tags: string[];
  /** 页面组件懒加载入口 */
  load: () => Promise<{ default: ComponentType }>;
}

/** 仅做类型收窄，便于工具包获得更准确的 IntelliSense */
export function defineTool<const T extends ToolDef>(def: T): T {
  return def;
}
