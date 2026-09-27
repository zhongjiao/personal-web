import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@pmp/ui';
import ToolPage from '../src/page';
import './index.css';

/* 独立调试台：页面本身不依赖 router / react-query，这里只补主题与提示上下文 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={150}>
      <div className="h-full">
        <ToolPage />
      </div>
    </TooltipProvider>
    <Toaster position="top-center" richColors closeButton />
  </React.StrictMode>
);
