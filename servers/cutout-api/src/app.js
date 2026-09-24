const express = require('express');
const cors = require('cors');

const healthRouter = require('./routes/health');
const cutoutRouter = require('./routes/cutout');

/**
 * 装配 express 应用（与启动解耦，便于测试或挂载到更大的服务里）
 */
function createApp() {
  const app = express();

  app.use(cors());
  // 抠图走 multipart，JSON 只用于错误响应与能力查询，不需要大 body
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', healthRouter);
  app.use('/api', cutoutRouter);

  return app;
}

module.exports = { createApp };
