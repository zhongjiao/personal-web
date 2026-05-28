import { useNavigate } from 'react-router-dom';
import { tools } from '@/tools-registry';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto w-full p-8">
      <h1 className="text-2xl font-bold mb-2">工具集</h1>
      <p className="text-[var(--color-muted)] mb-8">选择一个工具开始使用</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Card
              key={tool.id}
              className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-[var(--color-primary)]"
              onClick={() => navigate(tool.path)}
            >
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle>{tool.name}</CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm text-[var(--color-primary)]">打开 →</span>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
