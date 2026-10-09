import type { ConvertProgress } from '../types';

export interface DocxConvertOutput {
  body: string;
  warnings: string[];
}

/**
 * Word（.docx）→ HTML：交给 mammoth。
 * 内置的图片转换器会把图片编码成 data URI，因此产物依然是单文件。
 */
export async function docxToHtml(
  data: ArrayBuffer,
  onProgress: (progress: ConvertProgress) => void
): Promise<DocxConvertOutput> {
  onProgress({ phase: '解析 Word 文档' });
  const mammoth = (await import('mammoth')).default;

  // mammoth 的浏览器构建读 `arrayBuffer`，Node 构建（脚本 / 单测）读 `buffer`：
  // 两个字段都传，同一份代码在两端都能跑，也便于在 Node 里回归测试。
  const input = { arrayBuffer: data, buffer: new Uint8Array(data) } as Parameters<
    typeof mammoth.convertToHtml
  >[0];

  const result = await mammoth.convertToHtml(
    input,
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => p.subtitle:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        'b => strong',
        'i => em'
      ]
    }
  );

  const warnings = result.messages
    .filter((message) => message.type === 'warning')
    .map((message) => message.message)
    .slice(0, 20);

  if (result.messages.length > 20) warnings.push('（仅显示前 20 条提示）');

  const body = result.value?.trim();
  return {
    body: body || '<p class="empty-note">这份文档没有可提取的正文内容</p>',
    warnings
  };
}
