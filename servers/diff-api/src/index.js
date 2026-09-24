const { createApp } = require('./app');
const { getSoffice } = require('./lib/doc-converter');

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, async () => {
  console.log(`[pmp-diff-api] listening on http://localhost:${PORT}`);
  const soffice = await getSoffice();
  if (soffice) {
    console.log(`[pmp-diff-api] LibreOffice detected: ${soffice} → .doc 将保留格式转换为 docx`);
  } else {
    console.log('[pmp-diff-api] LibreOffice 未检测到 → .doc 仅可降级提取纯文本');
    console.log('  如需保留格式，请安装 LibreOffice 或设置 SOFFICE_PATH 环境变量');
  }
});
