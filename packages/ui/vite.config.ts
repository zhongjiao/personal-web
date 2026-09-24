import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** 库模式构建：ESM 输出，所有裸导入（react / radix / zustand 等）保持外部化 */
export default defineConfig({
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
});
