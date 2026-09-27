import { useEffect, useState } from 'react';
import { useThemeStore } from '@pmp/ui';

export type MonacoTheme = 'vs' | 'vs-dark';

/** 跟随外壳主题（含 system 的实时切换）给 Monaco 选配色 */
export function useMonacoTheme(): MonacoTheme {
  const theme = useThemeStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  return dark ? 'vs-dark' : 'vs';
}
