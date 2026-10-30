/** 首次进入 / 点「示例」时填充的内容 */

export const SAMPLE_MARKDOWN = `# 项目说明

一个**零依赖**的 Markdown 子集渲染器，用来做实时预览。支持 *斜体*、**粗体**、~~删除线~~、
\`行内代码\`，以及 [链接](https://www.example.com) 和裸链接 https://www.example.com 。

> 引用块里也可以包含其它块级元素：
>
> 1. 有序列表
> 2. 第二项

## 能力清单

- 标题（ATX 与 \`===\` / \`---\` 两种写法）
- 列表（可嵌套，支持任务列表）
  - 二级条目
- 表格（含对齐）
- 代码块（语言标记会显示在右上角）

### 任务列表

- [x] 解析块级结构
- [x] 行内语法与转义
- [ ] 语法高亮（暂不支持）

### 表格

| 能力 | 状态 | 备注 |
| :--- | :--: | ---: |
| 标题 | 支持 | 带 anchor id |
| 表格 | 支持 | GFM 对齐 |
| 脚注 | 不支持 | 保持轻量 |

### 代码块

\`\`\`ts
export function renderMarkdown(source: string) {
  return { html: parse(source), stats: count(source) };
}
\`\`\`

---

参考式链接也支持：[文档][doc]。

[doc]: https://commonmark.org "CommonMark 规范"
`;


export const SAMPLE_JSON = `{
  "name": "pmp-management",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "servers/*"],
  "scripts": {
    "dev": "concurrently -k -n API,WEB \\"pnpm dev:server\\" \\"pnpm dev:web\\"",
    "build": "pnpm -r --filter \\"./packages/*\\" build"
  },
  "tools": [
    { "id": "diff", "name": "差异对比", "tags": ["Monaco", "DOCX", "PDF"], "stars": 86 },
    {
      "id": "json",
      "name": "JSON / HTML 工具",
      "tags": ["JSON", "HTML", "格式化"],
      "enabled": true,
      "author": null,
      "stars": 128
    }
  ],
  "meta": {
    "createdAt": "2026-09-27T08:00:00.000Z",
    "nested": { "level1": { "level2": { "level3": [1, 2, 3, 4, 5] } } }
  },
  "unicode": "中文 / emoji 🚀 / 转义 \\"quotes\\"",
  "emptyObject": {},
  "emptyArray": []
}
`;

export const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>HTML 预览示例</title>
  <style>
    body { font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; padding: 24px; color: #1f2933; }
    .card { max-width: 460px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; }
    h1 { font-size: 17px; margin: 0 0 8px; }
    button { padding: 6px 14px; border-radius: 8px; border: 1px solid #c7d2fe; background: #eef2ff; color: #3730a3; cursor: pointer; }
    button:hover { background: #e0e7ff; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>HTML 预览示例</h1>
    <p>这是沙箱 iframe 里的实时预览：样式、脚本、表单都能正常工作。</p>
    <p>当前计数：<b id="count">0</b>，点按钮后 <code>console.log</code> 会回传到下方控制台。</p>
    <button id="btn">点我 +1</button>
  </div>
  <script>
    var n = 0;
    var countEl = document.getElementById('count');
    document.getElementById('btn').addEventListener('click', function () {
      n += 1;
      countEl.textContent = String(n);
      console.log('计数更新', n, { at: new Date().toISOString() });
    });
    console.warn('示例脚本已加载');
  </script>
</body>
</html>
`;
