const express = require('express');

const router = express.Router();

/* ---- 工具列表（前端已改为从各工具包的 manifest 装配，这里保留接口以兼容外部调用） ---- */
router.get('/tools', (req, res) => {
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

module.exports = router;
