# PMP 管理项目

基于现代主流 React 技术栈的工具集合管理平台。

## 项目结构

```
.
├── client/          # 前端 (React 19 + Vite 7 + TS + Tailwind v4 + shadcn/ui)
│   └── src/game/    # 恐龙快打街机游戏引擎（Canvas 2D，纯程序化绘制）
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

### 恐龙快打 (Dino Arcade)

路径：`/tools/dino` · 源码：`client/src/game/`

纯 Canvas 手绘的经典横版清关街机（无外部图片/音频资源）：

- **4 名可选角色**：杰克 / 汉娜 / 穆斯塔法 / 麦斯，体力、速度、力量各不相同
- **战斗系统**：三连击（第三段为终结技击飞）、跳跃飞踢、双击冲刺 + 冲撞、必杀技（消耗体力，全向击退）、命中停顿与屏幕震动、连击计分
- **武器道具**：打碎木箱获得鸡腿（回血）、铁管 / 球棒（近战，有挥击次数）、手枪（8 发子弹）
- **敌人与 BOSS**：打手、暴走族、持刀刺客、重装巨汉、迅猛龙，第三关 BOSS 暴君恐龙会跺地范围攻击并咆哮召唤援军
- **关卡**：废墟都市 → 丛林沼泽 → 恐龙巢穴，每关 3 波敌人，镜头锁屏推进，程序化生成的视差背景
- **操作**：`WASD/方向键` 移动 · `J/Z/空格` 攻击 · `K/X` 跳跃 · 双击左右冲刺 · `L/C/Shift` 必杀 · `P/Esc` 暂停；触屏设备自动显示虚拟按键
- **其他**：WebAudio 合成音效（可开关）、最高分本地持久化、每 4 万分奖命

### 差异对比工具 (Diff Tool)

- 自动识别语言（按扩展名 + 内容启发，无需用户操作）
- 支持 文本/代码、**DOCX**、**PDF** 文件本地对比
- **`.doc` 旧格式自动通过后端转换**（LibreOffice 保留格式 / 兜底纯文本）
- DOCX 三种视图模式：**文本** / **Markdown** / **富文本（保留格式 + 字级高亮）**
- Monaco 主题切换（`vs-dark` / `vs` / `hc-black` / `hc-light`），偏好持久化
- 通过 `?id=xxx` 加载 API 推送的数据进行对比
- 一键将当前内容推送到 API，自动复制分享链接
- 状态栏实时显示左右字符数 / 当前语言
- 组件样式采用 **CSS Modules** 局部作用域，不污染全局

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

### .doc → .docx 转换（保留格式）

需要服务器安装 [LibreOffice](https://www.libreoffice.org/) 并保证 `soffice` 命令可用。也可设置环境变量 `SOFFICE_PATH` 指向 `soffice.exe` 完整路径。

```bash
POST /api/doc/convert        # multipart, field=file
# 成功 + 有 LibreOffice → 直接返回 docx 二进制（响应头 X-Convert-Mode: docx）
# 成功 + 无 LibreOffice → 返回 JSON { mode: "text", text, message } (兜底)
```

服务器启动时会自动检测 LibreOffice 并打印日志：

```
[pmp-server] LibreOffice detected: ... → .doc 将保留格式转换为 docx
```

或：

```
[pmp-server] LibreOffice 未检测到 → .doc 仅可降级提取纯文本
```

### 后端能力查询

```bash
GET /api/capabilities
```

返回 `{ libreoffice: bool, docToDocx: bool, docToText: true }`。

## 添加新工具

1. 在 `client/src/pages/tools/` 下新建工具页（`.tsx`）
2. 在 `client/src/main.tsx` 添加路由
3. 在 `client/src/tools-registry.ts` 注册工具元信息

首页会自动展示新工具卡片。
