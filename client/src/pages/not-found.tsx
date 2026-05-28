import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <div className="text-6xl font-bold text-[var(--color-muted)]">404</div>
      <p className="text-[var(--color-muted)]">页面不存在</p>
      <Button asChild>
        <Link to="/">返回首页</Link>
      </Button>
    </div>
  );
}
