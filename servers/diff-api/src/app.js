const express = require('express');
const cors = require('cors');

const healthRouter = require('./routes/health');
const diffRouter = require('./routes/diff');
const docRouter = require('./routes/doc');
const toolsRouter = require('./routes/tools');

/**
 * 装配 express 应用（与启动解耦，便于测试或挂载到更大的服务里）
 */
function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', healthRouter);
  app.use('/api/diff', diffRouter);
  app.use('/api', docRouter);
  app.use('/api', toolsRouter);

  return app;
}

module.exports = { createApp };
