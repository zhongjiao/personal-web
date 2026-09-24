import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { pmpAliases } from '../../vite.aliases.mjs';

const repoRoot = path.resolve(__dirname, '../..');

/**
 * - `vite dev`   ：以包根目录的 index.html 作为独立调试台（dev/），
 *                  `@pmp/*` 由 alias 直接指向各包源码（不依赖符号链接、HMR 直通源码）
 * - `vite build` ：库模式产出可单独发布的 ESM（裸导入全部外部化）
 */
export default defineConfig(({ command }): UserConfig => {
  if (command === 'build') {
    return {
      plugins: [react()],
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/index.ts'),
          formats: ['es'],
          fileName: () => 'index.js'
        },
        sourcemap: true,
        rollupOptions: {
          external: (id) => !id.startsWith('.') && !path.isAbsolute(id)
        }
      }
    };
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: pmpAliases(repoRoot),
      preserveSymlinks: false
    },
    server: { port: 5181, open: '/', fs: { allow: [repoRoot] } }
  };
});
