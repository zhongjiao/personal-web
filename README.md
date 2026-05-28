# PMP 管理项目

基于 Node.js + React 的工具集合管理平台。

## 项目结构

```
.
├── client/          # 前端 (React + Vite + Monaco)
├── server/          # 后端 (Node.js + Express)
└── package.json     # 根目录脚本
```

## 已实现工具

- **代码差异对比工具 (Diff Tool)**：基于 Monaco Editor
  - 支持选择两个本地文件进行前后差异对比
  - 支持通过 API 接收外部数据进行差异对比

## 快速开始

### 1. 安装依赖

```bash
npm run install:all
```

### 2. 同时启动前后端

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

### 3. 单独启动

```bash
npm run dev:server   # 仅启动后端
npm run dev:client   # 仅启动前端
```

## API 用法

### 推送数据到 Diff 工具

```bash
POST http://localhost:3001/api/diff/push
Content-Type: application/json

{
  "original": "原始内容文本",
  "modified": "修改后的内容文本",
  "language": "javascript"   // 可选: javascript / json / typescript / html / css / markdown / plaintext ...
}
```

返回：

```json
{ "success": true, "id": "xxx" }
```

随后前端访问 `http://localhost:5173/tools/diff?id=xxx` 即可载入数据对比。

### 获取已推送的数据

```
GET http://localhost:3001/api/diff/pull/:id
```

## 添加新工具

1. 在 `client/src/tools/` 下新建工具组件
2. 在 `client/src/toolsRegistry.js` 中注册（id、name、description、path）
3. 在 `client/src/App.jsx` 中添加路由

首页会自动列出所有已注册的工具。
