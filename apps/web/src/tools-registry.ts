import type { ToolDef } from '@pmp/tool-contract';
import { toolManifest as beauty } from '@pmp/tool-beauty/manifest';
import { toolManifest as konvaImage } from '@pmp/tool-konva-image/manifest';
import { toolManifest as diff } from '@pmp/tool-diff/manifest';
import { toolManifest as photoshop } from '@pmp/tool-photoshop/manifest';
import { toolManifest as compositor } from '@pmp/tool-compositor/manifest';
import { toolManifest as json } from '@pmp/tool-json/manifest';

/**
 * 工具注册表。
 *
 * 只依赖各工具包的 `./manifest` 子路径（很轻，不含页面本体），
 * 页面由 `ToolDef.load()` 动态 import —— 新增工具只需：
 *   1) 新建/安装一个工具包并在其 `src/manifest.ts` 里 defineTool
 *   2) 在下面的数组里加一行
 */
export const tools: ToolDef[] = [beauty, konvaImage, diff, photoshop, compositor, json];

export type { ToolDef };
