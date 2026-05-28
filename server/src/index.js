const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---- 内存存储（演示用，生产建议替换为 Redis / DB） ----
const diffStore = new Map();
const STORE_TTL = 1000 * 60 * 30; // 30 分钟过期

function setWithTTL(id, payload) {
  diffStore.set(id, payload);
  setTimeout(() => diffStore.delete(id), STORE_TTL);
}

// ---- 健康检查 ----
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- 推送 diff 数据：返回 id，前端凭 id 拉取 ----
app.post('/api/diff/push', (req, res) => {
  const { original = '', modified = '', language = 'plaintext', title = '' } = req.body || {};
  if (typeof original !== 'string' || typeof modified !== 'string') {
    return res.status(400).json({ success: false, message: 'original / modified 必须为字符串' });
  }
  const id = nanoid(10);
  setWithTTL(id, { original, modified, language, title, createdAt: Date.now() });
  res.json({ success: true, id });
});

// ---- 拉取 diff 数据 ----
app.get('/api/diff/pull/:id', (req, res) => {
  const data = diffStore.get(req.params.id);
  if (!data) {
    return res.status(404).json({ success: false, message: '数据不存在或已过期' });
  }
  res.json({ success: true, data });
});

// ---- 工具列表（也可由前端硬编码，这里提供后端接口便于扩展） ----
app.get('/api/tools', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: 'diff',
        name: '代码差异对比',
        description: '基于 Monaco Editor 的代码 / 文本差异对比工具，支持本地文件 & API 数据',
        path: '/tools/diff',
        icon: 'diff'
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`[pmp-server] listening on http://localhost:${PORT}`);
});
