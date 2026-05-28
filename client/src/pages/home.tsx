import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { tools } from '@/tools-registry';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-auto">
      {/* Hero */}
      <div className="border-b border-[var(--color-border)] bg-gradient-to-br from-[var(--color-background)] to-[var(--color-accent)]">
        <div className="max-w-6xl mx-auto px-8 py-12">
          <Badge variant="outline" className="mb-3">
            <Sparkles className="h-3 w-3" />
            React 19 · Vite 7 · TypeScript
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            欢迎使用 PMP 管理平台
          </h1>
          <p className="text-[var(--color-muted-foreground)] max-w-2xl">
            一站式工具集合，提供差异对比、文档处理等常用能力。从下方选择一个工具开始。
          </p>
        </div>
      </div>

      {/* Tools */}
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="text-lg font-semibold">工具集</h2>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            共 {tools.length} 个工具
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Card
                key={tool.id}
                className="group cursor-pointer hover:shadow-lg hover:-translate-y-1 hover:border-[var(--color-primary)] transition-all duration-300"
                onClick={() => navigate(tool.path)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 text-[var(--color-primary)] flex items-center justify-center ring-1 ring-[var(--color-primary)]/20 group-hover:ring-[var(--color-primary)]/40 transition-all">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-[var(--color-muted-foreground)] opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </div>
                  <CardTitle className="text-base">{tool.name}</CardTitle>
                  <CardDescription>{tool.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">Monaco</Badge>
                    <Badge variant="secondary">DOCX</Badge>
                    <Badge variant="secondary">PDF</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
