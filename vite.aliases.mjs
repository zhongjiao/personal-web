import path from 'node:path';

/**
 * 生成 `@pmp/*` 的 Vite alias。
 *
 * 为什么需要它：pnpm 的 workspace 依赖在 Windows 上靠 junction/symlink，
 * 而本机（无开发者模式 / 杀软拦截）会出现 UNKNOWN open 错误（见 .npmrc 注释）。
 * 这里让「开发态」直接指向各包真实源码：
 *   1. 不依赖 node_modules 符号链接；
 *   2. HMR 直接作用于 packages/*，改源码立即生效，无需重新 install；
 *   3. 各包 package.json 里的 workspace 依赖仍然声明，发布时照常生效。
 *
 * 注意：数组顺序有意义 —— 更长的子路径必须排在包名之前。
 */
export function pmpAliases(repoRoot) {
  const p = (...seg) => path.join(repoRoot, 'packages', ...seg);

  const tools = [
    'tool-beauty',
    'tool-konva-image',
    'tool-photoshop',
    'tool-diff',
    'tool-compositor',
    'tool-json',
    'tool-file-html'
  ];

  return [
    { find: '@pmp/ui/styles/theme.css', replacement: p('ui', 'src/styles/theme.css') },
    { find: '@pmp/ui', replacement: p('ui', 'src/index.ts') },

    { find: '@pmp/image-kit/core', replacement: p('image-kit', 'src/lib/image-editor.ts') },
    { find: '@pmp/image-kit', replacement: p('image-kit', 'src/index.ts') },

    { find: '@pmp/tool-contract', replacement: p('tool-contract', 'src/index.ts') },

    ...tools.flatMap((t) => [
      { find: `@pmp/${t}/manifest`, replacement: p(t, 'src/manifest.ts') },
      { find: `@pmp/${t}`, replacement: p(t, 'src/index.ts') }
    ])
  ];
}
