import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Boxes, Github, Home as HomeIcon } from 'lucide-react';
import { tools } from '@/tools-registry';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

export default function App() {
  const location = useLocation();
  const currentTool = tools.find((t) => location.pathname.startsWith(t.path));

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full bg-[var(--color-background)] text-[var(--color-foreground)]">
        {/* Sidebar */}
        <aside className="w-20 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-card)] flex flex-col items-center py-4 gap-3">
          <NavLink to="/" className="mb-2">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
              <Boxes className="h-5 w-5" />
            </div>
          </NavLink>

          <Separator className="my-1 w-8" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                className="h-12 w-12 rounded-xl [&_svg]:size-5 data-[active=true]:bg-[var(--color-primary)] data-[active=true]:text-[var(--color-primary-foreground)] data-[active=true]:hover:bg-[var(--color-primary)]/90"
              >
                <NavLink
                  to="/"
                  end
                  data-active={location.pathname === '/' || undefined}
                >
                  <HomeIcon />
                </NavLink>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">首页</TooltipContent>
          </Tooltip>

          {tools.map((tool) => {
            const Icon = tool.icon;
            const active = location.pathname.startsWith(tool.path);
            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    className="h-12 w-12 rounded-xl [&_svg]:size-5 data-[active=true]:bg-[var(--color-primary)] data-[active=true]:text-[var(--color-primary-foreground)] data-[active=true]:hover:bg-[var(--color-primary)]/90"
                  >
                    <NavLink to={tool.path} data-active={active || undefined}>
                      <Icon />
                    </NavLink>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{tool.name}</TooltipContent>
              </Tooltip>
            );
          })}

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                className="h-12 w-12 rounded-xl [&_svg]:size-5"
              >
                <a
                  href="https://github.com/zhongjiao/personal-web"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                >
                  <Github />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">GitHub</TooltipContent>
          </Tooltip>

          <ThemeToggle />
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top bar */}
          <header className="h-14 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-card)] flex items-center px-6 gap-3">
            <h1 className="text-base font-semibold tracking-tight">
              {currentTool ? currentTool.name : 'PMP 管理平台'}
            </h1>
            {currentTool && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs text-[var(--color-muted-foreground)] truncate">
                  {currentTool.description}
                </span>
              </>
            )}
          </header>

          <main className="flex-1 min-h-0 flex flex-col">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
