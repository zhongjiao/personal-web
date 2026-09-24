import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import ToolPage from '../src/page';
import './index.css';

/* 独立调试台：不依赖 apps/web，可单独 `pnpm --filter @pmp/tool-beauty dev` 开发 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="h-full">
      <ToolPage />
    </div>
    <Toaster position="top-center" richColors closeButton />
  </React.StrictMode>
);
