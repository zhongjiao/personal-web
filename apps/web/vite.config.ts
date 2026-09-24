import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { pmpAliases } from '../../vite.aliases.mjs';

const repoRoot = path.resolve(__dirname, '../..');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }, ...pmpAliases(repoRoot)]
  },
  server: {
    port: 5173,
    proxy: {
      // 抠图接口走 cutout-api（3002），其余 /api 走 diff-api（3001）
      // 顺序敏感：更长的前缀必须写在前面
      '/api/cutout': {
        target: 'http://localhost:3002',
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    },
    fs: {
      // 允许读取 packages/* 的源码
      allow: [repoRoot]
    },
    watch: {
      ignored: ['**/samples/**', '**/dist/**', '**/node_modules/**']
    }
  }
});
