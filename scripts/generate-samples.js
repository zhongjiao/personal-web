/**
 * 生成测试用的 docx / pdf 文件（每种 2 份，含差异）
 * 运行：node scripts/generate-samples.js
 */
const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType
} = require('docx');
const PDFDocument = require('pdfkit');

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
fs.mkdirSync(SAMPLES_DIR, { recursive: true });

// ============== DOCX ==============

function tableRow(cells, opts = {}) {
  return new TableRow({
    children: cells.map(
      (text) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold })] })],
          width: { size: 33, type: WidthType.PERCENTAGE }
        })
    )
  });
}

function buildDocxV1() {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: '产品需求规格说明书（V1.0）',
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({
            children: [
              new TextRun({ text: '版本：', bold: true }),
              new TextRun('1.0')
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: '日期：', bold: true }),
              new TextRun('2026-05-01')
            ]
          }),

          new Paragraph({ text: '一、项目背景', heading: HeadingLevel.HEADING_2 }),
          new Paragraph(
            '本项目旨在搭建一套企业级 PMP 管理平台，覆盖项目立项、开发、上线、运营全流程。'
          ),
          new Paragraph(
            '当前用户在使用过程中存在工具分散、数据割裂的问题，需要一个统一的入口。'
          ),

          new Paragraph({ text: '二、核心功能', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: '差异对比工具', bullet: { level: 0 } }),
          new Paragraph({ text: '日志查询工具', bullet: { level: 0 } }),
          new Paragraph({ text: '配置管理工具', bullet: { level: 0 } }),

          new Paragraph({ text: '三、关键指标', heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              tableRow(['指标', '目标', '负责人'], { bold: true }),
              tableRow(['日活跃用户', '500', '产品组']),
              tableRow(['平均响应时间', '< 200ms', '后端组']),
              tableRow(['前端首屏', '< 2s', '前端组'])
            ],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),

          new Paragraph({ text: '四、风险与应对', heading: HeadingLevel.HEADING_2 }),
          new Paragraph(
            '人力风险：跨部门协作可能影响进度，需要项目经理提前对齐。'
          )
        ]
      }
    ]
  });
}

function buildDocxV2() {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: '产品需求规格说明书（V2.0）',
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({
            children: [
              new TextRun({ text: '版本：', bold: true }),
              new TextRun('2.0')
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: '日期：', bold: true }),
              new TextRun('2026-05-28')
            ]
          }),

          new Paragraph({ text: '一、项目背景', heading: HeadingLevel.HEADING_2 }),
          new Paragraph(
            '本项目旨在搭建一套企业级 PMP 管理平台，覆盖项目立项、开发、上线、运营、复盘全流程。'
          ),
          new Paragraph(
            '当前用户在使用过程中存在工具分散、数据割裂的问题，需要一个统一的入口与权限体系。'
          ),

          new Paragraph({ text: '二、核心功能', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: '差异对比工具（支持 docx/pdf 等多种格式）', bullet: { level: 0 } }),
          new Paragraph({ text: '日志查询工具', bullet: { level: 0 } }),
          new Paragraph({ text: '配置管理工具', bullet: { level: 0 } }),
          new Paragraph({ text: '权限管理工具', bullet: { level: 0 } }),
          new Paragraph({ text: '数据看板', bullet: { level: 0 } }),

          new Paragraph({ text: '三、关键指标', heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              tableRow(['指标', '目标', '负责人'], { bold: true }),
              tableRow(['日活跃用户', '1000', '产品组']),
              tableRow(['平均响应时间', '< 150ms', '后端组']),
              tableRow(['前端首屏', '< 1.5s', '前端组']),
              tableRow(['月度留存', '> 60%', '运营组'])
            ],
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),

          new Paragraph({ text: '四、风险与应对', heading: HeadingLevel.HEADING_2 }),
          new Paragraph(
            '人力风险：跨部门协作可能影响进度，需要项目经理提前对齐 OKR。'
          ),
          new Paragraph(
            '安全风险：用户数据涉及隐私合规，需通过安全部门审计。'
          )
        ]
      }
    ]
  });
}

async function writeDocx(name, doc) {
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(SAMPLES_DIR, name), buf);
  console.log('✓', name, buf.length, 'bytes');
}

// ============== PDF ==============

/**
 * 找一个可用的 TTF 中文字体（pdfkit 不支持 TTC 容器，必须 TTF/OTF）
 */
function findCJKTTF() {
  const candidates = [
    'C:\\Windows\\Fonts\\simhei.ttf',  // Windows 黑体
    'C:\\Windows\\Fonts\\simfang.ttf', // Windows 仿宋
    'C:\\Windows\\Fonts\\simkai.ttf',  // Windows 楷体
    '/System/Library/Fonts/STHeiti Light.ttc', // macOS（这条是 ttc，pdfkit 可能不支持）
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && /\.(ttf|otf)$/i.test(p)) return p;
  }
  return null;
}

function writePdf(name, data) {
  return new Promise((resolve, reject) => {
    const fontPath = findCJKTTF();
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const out = fs.createWriteStream(path.join(SAMPLES_DIR, name));
    doc.pipe(out);

    if (fontPath) {
      try {
        doc.registerFont('cjk', fontPath);
        doc.font('cjk');
      } catch (err) {
        console.warn('  字体加载失败，回退默认（中文可能无法显示）:', err.message);
      }
    } else {
      console.warn('  未找到可用 TTF 中文字体，PDF 将使用默认字体');
    }

    // 标题
    doc.fontSize(20).text(data.title, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(11);
    doc.text(`${data.versionLabel}：${data.version}`);
    doc.text(`${data.dateLabel}：${data.date}`);
    doc.moveDown(0.8);

    for (const section of data.sections) {
      doc.fontSize(14).text(section.heading);
      doc.moveDown(0.4);
      doc.fontSize(11);
      for (const p of section.paragraphs) {
        doc.text(p, { paragraphGap: 4 });
      }
      doc.moveDown(0.6);
    }

    doc.end();
    out.on('finish', () => {
      console.log('✓', name);
      resolve();
    });
    out.on('error', reject);
  });
}

const { v1: pdfV1, v2: pdfV2 } = require('./sample-pdf-data');

(async function main() {
  console.log('生成 DOCX...');
  await writeDocx('requirements-v1.docx', buildDocxV1());
  await writeDocx('requirements-v2.docx', buildDocxV2());

  console.log('生成 PDF...');
  await writePdf('meeting-minutes-v1.pdf', pdfV1);
  await writePdf('meeting-minutes-v2.pdf', pdfV2);

  console.log('\n输出目录:', SAMPLES_DIR);
})();
