import { useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { applyTheme, useThemeStore, type AppTheme } from '@/store/theme-store';

const ICONS: Record<AppTheme, React.ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
  system: <Monitor />
};

const NEXT: Record<AppTheme, AppTheme> = {
  light: 'dark',
  dark: 'system',
  system: 'light'
};

const LABEL: Record<AppTheme, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统'
};

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();

  useEffect(() => {
    applyTheme(theme);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => applyTheme('system');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [theme]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          onClick={() => setTheme(NEXT[theme])}
          aria-label="切换主题"
          className="h-12 w-12 rounded-xl [&_svg]:size-5"
        >
          {ICONS[theme]}
        </Button>
      </TooltipTrigger>
      <TooltipContent>当前：{LABEL[theme]}（点击切换）</TooltipContent>
    </Tooltip>
  );
}
