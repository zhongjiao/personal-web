const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { nanoid } = require('nanoid');

const execAsync = promisify(exec);

/**
 * 检测系统是否安装了 LibreOffice（soffice）
 */
async function detectLibreOffice() {
  // 常见安装路径（Windows / Linux / macOS）
  const candidates = [
    process.env.SOFFICE_PATH,
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  ].filter(Boolean);

  for (const cmd of candidates) {
    try {
      const probe = cmd.includes(' ') || cmd.includes('\\') ? `"${cmd}"` : cmd;
      const { stdout } = await execAsync(`${probe} --version`, { timeout: 5000 });
      if (stdout && /LibreOffice/i.test(stdout)) {
        return cmd;
      }
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

let _sofficePromise = null;
function getSoffice() {
  if (!_sofficePromise) _sofficePromise = detectLibreOffice();
  return _sofficePromise;
}

/**
 * 用 LibreOffice 把 .doc 转成 .docx，返回新 buffer
 */
async function convertDocToDocxViaLibreOffice(buffer, soffice) {
  const tmpDir = path.join(os.tmpdir(), 'pmp-doc-' + nanoid(8));
  fs.mkdirSync(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, 'input.doc');
  fs.writeFileSync(inputPath, buffer);

  try {
    const sofficeCmd =
      soffice.includes(' ') || soffice.includes('\\') ? `"${soffice}"` : soffice;
    // --headless: 无界面 / --convert-to docx / --outdir 指定输出目录
    await execAsync(
      `${sofficeCmd} --headless --convert-to docx --outdir "${tmpDir}" "${inputPath}"`,
      { timeout: 30000 }
    );
    const outputPath = path.join(tmpDir, 'input.docx');
    if (!fs.existsSync(outputPath)) {
      throw new Error('LibreOffice 未生成 docx 输出文件');
    }
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * 用 word-extractor 纯 JS 提取 .doc 文本（无格式）
 */
async function extractDocTextFallback(buffer) {
  // 写入临时文件，word-extractor 只支持文件路径
  const tmpFile = path.join(os.tmpdir(), 'pmp-doc-' + nanoid(8) + '.doc');
  fs.writeFileSync(tmpFile, buffer);
  try {
    const WordExtractor = require('word-extractor');
    const extractor = new WordExtractor();
    const doc = await extractor.extract(tmpFile);
    return doc.getBody() || '';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * 处理 .doc 文件：优先 LibreOffice 保留格式，失败则 word-extractor 提文本
 *
 * @returns { mode: 'docx'|'text', docxBuffer?: Buffer, text?: string, message: string }
 */
async function processDocFile(buffer) {
  const soffice = await getSoffice();
  if (soffice) {
    try {
      const docxBuffer = await convertDocToDocxViaLibreOffice(buffer, soffice);
      return {
        mode: 'docx',
        docxBuffer,
        message: '已通过 LibreOffice 转换为 docx，保留格式'
      };
    } catch (err) {
      // LibreOffice 转换失败，降级
      console.warn('[doc-converter] LibreOffice 转换失败，降级到文本提取：', err.message);
    }
  }

  // 兜底：纯 JS 提文本
  const text = await extractDocTextFallback(buffer);
  return {
    mode: 'text',
    text,
    message: soffice
      ? '[降级] LibreOffice 转换失败，已提取纯文本（无格式）'
      : '[降级] 未检测到 LibreOffice，已提取纯文本（无格式）。如需保留格式，请安装 LibreOffice 或设置 SOFFICE_PATH 环境变量'
  };
}

module.exports = { processDocFile, getSoffice };
