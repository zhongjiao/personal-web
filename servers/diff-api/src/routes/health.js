const express = require('express');

const router = express.Router();

/* ---- 健康检查 ---- */
router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
