import Editor, { type BeforeMount } from '@monaco-editor/react';
import { ensureMonaco } from '../lib/monaco-setup';
import type { MonacoTheme } from '../lib/use-monaco-theme';

interface CodeEditorProps {
  value: string;
  language: 'json' | 'html';
  theme: MonacoTheme;
  onChange: (value: string) => void;
}

/**
 * 关掉 Monaco 的 JSON 校验：
 * 本工具自己有「解析状态 + 行:列 + 宽松模式」的报错面板，
 * 开着官方校验会和宽松模式（注释 / 尾随逗号）打架，出现满屏红线。
 */
const configureJson: BeforeMount = (monaco) => {
  monaco.languages.json?.jsonDefaults.setDiagnosticsOptions({
    validate: false,
    schemas: [],
    enableSchemaRequest: false
  });
};

export function CodeEditor({ value, language, theme, onChange }: CodeEditorProps) {
  ensureMonaco();

  return (
    <Editor
      language={language}
      theme={theme}
      value={value}
      beforeMount={language === 'json' ? configureJson : undefined}
      onChange={(next) => onChange(next ?? '')}
      loading={
        <div className="flex h-full w-full items-center justify-center text-xs text-[var(--color-muted-foreground)]">
          正在加载编辑器…
        </div>
      }
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        tabSize: 2,
        wordWrap: 'on',
        folding: true,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderLineHighlight: 'line',
        padding: { top: 10, bottom: 10 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
      }}
    />
  );
}
