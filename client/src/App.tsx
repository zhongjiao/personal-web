import { NavLink, Outlet } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function App() {
  return (
    <div className="flex flex-col h-full">
      <header className="h-14 flex items-center px-6 bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-sm shrink-0">
        <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold tracking-wide">
          <Boxes className="h-5 w-5" />
          PMP 管理平台
        </NavLink>
        <nav className="ml-8 flex gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'px-3 py-1.5 rounded-md text-sm transition-colors',
                isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10'
              )
            }
          >
            首页
          </NavLink>
          <NavLink
            to="/tools/diff"
            className={({ isActive }) =>
              cn(
                'px-3 py-1.5 rounded-md text-sm transition-colors',
                isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10'
              )
            }
          >
            差异对比
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
