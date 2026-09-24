import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { pmpAliases } from '../../vite.aliases.mjs';

const repoRoot = path.resolve(__dirname, '../..');

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
    resolve: { alias: pmpAliases(repoRoot) },
    server: { port: 5182, open: '/', fs: { allow: [repoRoot] } }
  };
});
