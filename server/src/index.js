const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// multer 内存存储，限制 20MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

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

// ---- 文件转纯文本：支持 docx / pdf / 文本 ----
// 注意：.doc(旧二进制) 不在内置支持范围；如需支持请配合 LibreOffice/Antiword
app.post('/api/diff/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '缺少文件 (form field: file)' });
    }
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const buffer = req.file.buffer;
    let text = '';
    let kind = 'text';

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
      kind = 'docx';
    } else if (ext === '.pdf') {
      const result = await pdfParse(buffer);
      text = result.text || '';
      kind = 'pdf';
    } else if (ext === '.doc') {
      return res.status(415).json({
        success: false,
        message: '.doc 旧格式暂不支持，请另存为 .docx 后上传'
      });
    } else {
      // 默认按 utf-8 文本
      text = buffer.toString('utf-8');
      kind = 'text';
    }

    res.json({
      success: true,
      data: {
        filename: req.file.originalname,
        kind,
        text,
        size: req.file.size
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '解析失败：' + err.message });
  }
});

// ---- 工具列表（也可由前端硬编码，这里提供后端接口便于扩展） ----
app.get('/api/tools', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: 'diff',
        name: '代码差异对比',
        description: '基于 Monaco Editor 的差异对比工具，支持 文本/代码/DOCX/PDF 与 API 数据',
        path: '/tools/diff',
        icon: 'diff'
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`[pmp-server] listening on http://localhost:${PORT}`);
});
