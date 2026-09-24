const express = require('express');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { upload } = require('../lib/upload');
const { put, get } = require('../lib/store');
const { processDocFile } = require('../lib/doc-converter');

const router = express.Router({ mergeParams: true });

/* ---- 推送 diff 数据：返回 id，前端凭 id 拉取 ---- */
router.post('/push', (req, res) => {
  const { original = '', modified = '', language = 'plaintext', title = '' } = req.body || {};
  if (typeof original !== 'string' || typeof modified !== 'string') {
    return res.status(400).json({ success: false, message: 'original / modified 必须为字符串' });
  }
  const id = put({ original, modified, language, title, createdAt: Date.now() });
  res.json({ success: true, id });
});

/* ---- 拉取 diff 数据 ---- */
router.get('/pull/:id', (req, res) => {
  const data = get(req.params.id);
  if (!data) {
    return res.status(404).json({ success: false, message: '数据不存在或已过期' });
  }
  res.json({ success: true, data });
});

/* ---- 文件转纯文本：支持 docx / pdf / 文本 ---- */
// 注意：.doc(旧二进制) 不在内置支持范围；如需支持请配合 LibreOffice/Antiword
router.post('/extract', upload.single('file'), async (req, res) => {
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

module.exports = router;
