import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { applyTheme, useThemeStore } from '@pmp/ui';
import App from '@/App';
import HomePage from '@/pages/home';
import NotFoundPage from '@/pages/not-found';
import { LazyTool } from '@/components/lazy-tool';
import { tools } from '@/tools-registry';
import './index.css';

// 启动时立即应用持久化的主题，避免闪屏
applyTheme(useThemeStore.getState().theme);

const router = createBrowserRouter([
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: HomePage },
      // 工具路由由各工具包的 manifest 装配，页面按需加载
      ...tools.map((def) => ({
        path: def.path.replace(/^\//, ''),
        element: <LazyTool def={def} />
      })),
      { path: '*', Component: NotFoundPage }
    ]
  }
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 }
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  </React.StrictMode>
);
