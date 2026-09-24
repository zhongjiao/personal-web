const { createApp } = require('./app');
const { getEngineInfo } = require('./lib/engine');

const PORT = process.env.PORT || 3002;
const app = createApp();

app.listen(PORT, () => {
  const engine = getEngineInfo();
  console.log(`[pmp-cutout-api] listening on http://localhost:${PORT}`);
  console.log(`[pmp-cutout-api] engine: ${engine.name} (model: ${engine.model})`);
  console.log('[pmp-cutout-api] 模型随包分发，无需联网；首次抠图需加载 ONNX 会话，约几秒');
});
