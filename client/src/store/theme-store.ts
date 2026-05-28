import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppTheme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (t) => set({ theme: t })
    }),
    { name: 'pmp-theme' }
  )
);

/**
 * 应用主题到 <html> 上
 */
export function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  root.classList.remove('dark');
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'system') {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    }
  }
}
