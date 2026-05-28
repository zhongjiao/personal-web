import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from '@/App';
import HomePage from '@/pages/home';
import DiffToolPage from '@/pages/tools/diff';
import NotFoundPage from '@/pages/not-found';
import { applyTheme, useThemeStore } from '@/store/theme-store';
import './index.css';

// 启动时立即应用持久化的主题，避免闪屏
applyTheme(useThemeStore.getState().theme);

const router = createBrowserRouter([
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: HomePage },
      { path: 'tools/diff', Component: DiffToolPage },
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
