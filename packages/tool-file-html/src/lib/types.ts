export type ConvertKind =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'pptx'
  | 'csv'
  | 'text'
  | 'json'
  | 'html'
  | 'image';

export const KIND_LABELS: Record<ConvertKind, string> = {
  pdf: 'PDF 文档',
  docx: 'Word 文档',
  doc: 'Word 文档（旧格式）',
  xlsx: 'Excel 工作簿',
  pptx: 'PowerPoint 演示文稿',
  csv: 'CSV / 分隔符表格',
  text: '纯文本',
  json: 'JSON',
  html: 'HTML 页面',
  image: '图片'
};

export interface ConvertProgress {
  phase: string;
  current?: number;
  total?: number;
}

/**
 * PDF 输出方式：
 *  - image      逐页转图片，版式最忠实（体积大、文字不可选）
 *  - positioned 文本层 + 原始坐标定位，文字可选可搜索（不保留图片 / 矢量图形）
 *  - text       只保留文字（版式全丢）
 */
export type PdfMode = 'image' | 'positioned' | 'text';

export interface PdfOptions {
  mode: PdfMode;
  /** 图片模式的渲染倍率：1 ≈ 96dpi，越大越清晰、体积越大 */
  scale: number;
  format: 'jpeg' | 'png';
  /** JPEG 质量（0~1） */
  quality: number;
  /** 最多处理多少页，0 表示全部 */
  maxPages: number;
}

export interface ConvertOptions {
  pdf: PdfOptions;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  // 默认「文本 + 定位」：体积小、文字可选，且没有文本层的页会自动回退成图片
  pdf: { mode: 'positioned', scale: 1.5, format: 'jpeg', quality: 0.85, maxPages: 100 }
};

export interface ConvertStat {
  label: string;
  value: string;
}

export interface ConvertResult {
  kind: ConvertKind;
  /** 生成 HTML 的标题（一般取原文件名） */
  title: string;
  html: string;
  /** 生成 HTML 的 UTF-8 字节数 */
  bytes: number;
  stats: ConvertStat[];
  warnings: string[];
  durationMs: number;
}

export type ShellLayout = 'doc' | 'wide' | 'deck' | 'plain';
