const express = require('express');
const path = require('path');
const { upload } = require('../lib/upload');
const { processDocFile, getSoffice } = require('../lib/doc-converter');

const router = express.Router();

/* ---- .doc → .docx 转换接口（专为前端 .doc 上传场景） ----
 * 成功 + 有 LibreOffice：返回二进制 docx（前端再走 mammoth 解析，保留格式）
 * 成功 + 无 LibreOffice：返回 JSON { mode: 'text', text, message }
 * 失败：返回 JSON { success: false, message } */
router.post('/doc/convert', upload.single('file'), async (req, res) => {
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
      const newName = path.basename(req.file.originalname, '.doc') + '.docx';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(newName)}"`);
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

/* ---- 后端能力信息（前端可询问当前是否支持 docx 保留格式转换） ---- */
router.get('/capabilities', async (req, res) => {
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

module.exports = router;
