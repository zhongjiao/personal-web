import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';

let configured = false;

/**
 * `@monaco-editor/react` 默认从 CDN 拉 monaco；这里改成用 node_modules 里的本地副本，
 * 并注册各语言的 Web Worker —— 编辑器完全离线可用，不发任何外部请求。
 */
export function ensureMonaco(): void {
  if (configured) return;
  configured = true;

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new jsonWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker();
        default:
          return new editorWorker();
      }
    }
  };

  loader.config({ monaco });
}
