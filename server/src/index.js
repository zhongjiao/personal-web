const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const path = require('path');
const { processDocFile, getSoffice } = require('./doc-converter');

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
      // .doc 旧格式：用 LibreOffice 转 docx 后提文本（兜底用 word-extractor）
      const result = await processDocFile(buffer);
      if (result.mode === 'docx') {
        const m = await mammoth.extractRawText({ buffer: result.docxBuffer });
        text = m.value || '';
      } else {
        text = result.text || '';
      }
      kind = 'doc';
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

// ---- .doc → .docx 转换接口（专为前端 .doc 上传场景） ----
// 成功 + 有 LibreOffice：返回二进制 docx（前端再走 mammoth 解析，保留格式）
// 成功 + 无 LibreOffice：返回 JSON { mode: 'text', text, message }
// 失败：返回 JSON { success: false, message }
app.post('/api/doc/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '缺少文件 (form field: file)' });
    }
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext !== '.doc') {
      return res.status(400).json({ success: false, message: '仅支持 .doc 文件' });
    }
    const result = await processDocFile(req.file.buffer);
    if (result.mode === 'docx') {
      // 返回 docx 二进制
      const newName =
        path.basename(req.file.originalname, '.doc') + '.docx';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(newName)}"`
      );
      res.setHeader('X-Convert-Mode', 'docx');
      res.setHeader('X-Convert-Message', encodeURIComponent(result.message));
      return res.send(result.docxBuffer);
    }
    // 降级：返回纯文本 JSON
    return res.json({
      success: true,
      mode: 'text',
      text: result.text || '',
      message: result.message
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '转换失败：' + err.message });
  }
});

// ---- 后端能力信息（前端可询问当前是否支持 docx 保留格式转换） ----
app.get('/api/capabilities', async (req, res) => {
  const soffice = await getSoffice();
  res.json({
    success: true,
    data: {
      libreoffice: !!soffice,
      docToDocx: !!soffice,
      docToText: true
    }
  });
});

app.listen(PORT, async () => {
  console.log(`[pmp-server] listening on http://localhost:${PORT}`);
  const soffice = await getSoffice();
  if (soffice) {
    console.log(`[pmp-server] LibreOffice detected: ${soffice} → .doc 将保留格式转换为 docx`);
  } else {
    console.log('[pmp-server] LibreOffice 未检测到 → .doc 仅可降级提取纯文本');
    console.log('  如需保留格式，请安装 LibreOffice 或设置 SOFFICE_PATH 环境变量');
  }
});
