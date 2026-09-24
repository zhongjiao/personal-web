import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import ToolPage from '../src/page';
import './index.css';

/* 独立调试台：页面依赖 router（?id=）与 react-query，这里补上最小上下文 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tools/diff']}>
        <div className="h-full">
          <ToolPage />
        </div>
      </MemoryRouter>
    </QueryClientProvider>
    <Toaster position="top-center" richColors closeButton />
  </React.StrictMode>
);
