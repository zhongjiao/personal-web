import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <div className="text-7xl font-bold bg-gradient-to-br from-blue-500 to-indigo-600 bg-clip-text text-transparent">
          404
        </div>
        <p className="mt-2 text-[var(--color-muted-foreground)]">页面不存在或已被移除</p>
      </div>
      <Button asChild>
        <Link to="/">
          <ArrowLeft />
          返回首页
        </Link>
      </Button>
    </div>
  );
}
