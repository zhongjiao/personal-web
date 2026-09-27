/** 首次进入 / 点「示例」时填充的内容 */

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
