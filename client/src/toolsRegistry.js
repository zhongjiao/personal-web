// 工具注册表 - 新增工具时在此注册即可
export const tools = [
  {
    id: 'diff',
    name: '代码差异对比',
    description: '基于 Monaco Editor 的差异对比工具，支持 文本/代码、DOCX、PDF 文件，亦可通过 API 数据对比',
    path: '/tools/diff',
    icon: 'D'
  }
  // 后续工具继续添加...
  // { id: 'json', name: 'JSON 工具', description: '...', path: '/tools/json', icon: 'J' }
];
