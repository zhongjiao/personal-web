# PMP 管理项目

基于现代主流 React 技术栈的工具集合管理平台。

## 项目结构

```
.
├── client/          # 前端 (React 19 + Vite 7 + TS + Tailwind v4 + shadcn/ui)
├── server/          # 后端 (Node.js + Express)
├── pnpm-workspace.yaml
└── package.json     # workspace 根
```

## 前端技术栈

| 维度 | 选型 |
|---|---|
| 语言 | TypeScript 5.6 |
| UI 框架 | React 19 |
| 构建 | Vite 7 |
| 路由 | React Router v7（data router） |
| 样式 | Tailwind CSS v4 |
| UI 组件 | shadcn/ui 风格（Button/Card/Select 已内置） |
| 数据请求 | TanStack Query v5 |
| 全局状态 | Zustand v5 |
| 通知 | Sonner |
| 图标 | lucide-react |
| 编辑器 | Monaco Editor (`@monaco-editor/react`) |
| 文档解析 | mammoth (docx) + pdfjs-dist (pdf) |
| Lint | ESLint v9 flat config + Prettier |

## 已实现工具

### 差异对比工具 (Diff Tool)

- 自动识别语言（按扩展名 + 内容启发，无需用户操作）
- 支持 文本/代码、**DOCX**、**PDF** 文件本地对比
- `.doc` 旧格式：提示用户另存为 `.docx`
- 通过 `?id=xxx` 加载 API 推送的数据进行对比
- 一键将当前内容推送到 API，自动复制分享链接
- 状态栏实时显示左右字符数 / 当前语言

## 快速开始

```bash
pnpm install        # 一次装好 root + client + server
pnpm dev            # 同时跑前后端
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

## 常用命令

```bash
pnpm dev:server         # 只跑后端
pnpm dev:client         # 只跑前端
pnpm build              # 构建前端
pnpm --filter pmp-client lint    # 前端 lint
pnpm --filter pmp-client format  # 格式化

# 给某子包加依赖
pnpm --filter pmp-client add axios
pnpm --filter pmp-server add -D jest
```

## API

### 推送 diff 数据

```bash
POST /api/diff/push
Content-Type: application/json

{ "original": "...", "modified": "...", "language": "json" }
```

返回 `{ "success": true, "id": "xxx" }`，前端访问 `/tools/diff?id=xxx` 即可载入。

### 拉取 diff 数据

```bash
GET /api/diff/pull/:id
```

### 文档转纯文本（DOCX / PDF）

```bash
POST /api/diff/extract       # multipart, field=file
```

## 添加新工具

1. 在 `client/src/pages/tools/` 下新建工具页（`.tsx`）
2. 在 `client/src/main.tsx` 添加路由
3. 在 `client/src/tools-registry.ts` 注册工具元信息

首页会自动展示新工具卡片。
