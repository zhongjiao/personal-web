const express = require('express');
const { upload } = require('../lib/upload');
const { getEngineInfo, removeImageBackground } = require('../lib/engine');

const router = express.Router();

/** 允许的输入格式（引擎内部用 sharp 按内容解码，这里只做粗筛给出更好的报错） */
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

/* ---- 抠图：上传图片 → 返回透明背景 PNG ----
 * 成功：image/png 二进制，附带 X-Cutout-Engine / X-Cutout-Ms 头
 * 失败：JSON { success: false, message } */
router.post('/cutout', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '缺少文件 (form field: image)' });
    }
    const mime = req.file.mimetype || '';
    if (!ALLOWED_MIME.includes(mime)) {
      return res.status(400).json({
        success: false,
        message: `不支持的图片格式：${mime || '未知'}（仅支持 PNG / JPEG / WEBP）`
      });
    }

    const started = Date.now();
    const png = await removeImageBackground(req.file.buffer, mime);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Cutout-Engine', getEngineInfo().name);
    res.setHeader('X-Cutout-Ms', String(Date.now() - started));
    return res.send(png);
  } catch (err) {
    // 首次下载模型失败 / 内存不足等都会走到这里
    console.error('[pmp-cutout-api] 抠图失败:', err);
    return res.status(500).json({ success: false, message: '抠图失败：' + err.message });
  }
});

/* ---- 后端能力信息（前端可据此确认服务是否在线、用的什么引擎） ---- */
router.get('/cutout/capabilities', (req, res) => {
  res.json({ success: true, data: { ...getEngineInfo(), formats: ALLOWED_MIME } });
});

module.exports = router;
