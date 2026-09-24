# PMP 管理项目

基于现代主流 React 技术栈的工具集合管理平台。

## 项目结构

pnpm workspace + 多包（monorepo）：**每个工具是一个可以独立开发 / 构建 / 发布的 package**，
应用外壳只通过「工具契约」把它们装配起来。

```
.
├── apps/
│   └── web/                        @pmp/web            应用外壳：布局、路由装配、首页、主题
├── packages/
│   ├── tool-contract/              @pmp/tool-contract  工具契约（ToolDef / defineTool）
│   ├── ui/                         @pmp/ui             共享 UI 原子（shadcn 组件 / cn / 主题 token）
│   ├── image-kit/                  @pmp/image-kit      共享图像内核（画布·图层·标注·调色·导出 + 编辑器原子 UI）
│   ├── tool-beauty/                @pmp/tool-beauty          美图工坊
│   ├── tool-konva-image/           @pmp/tool-konva-image     Konva 图片编辑器
│   ├── tool-photoshop/             @pmp/tool-photoshop       Photoshop 基础
│   ├── tool-diff/                  @pmp/tool-diff            差异对比（含 samples/ 与生成脚本）
│   └── …                           新增工具在此建包（见「添加新工具」）
├── servers/
│   └── diff-api/                   @pmp/diff-api       差异对比的后端 API（Node.js + Express）
├── vite.aliases.mjs                monorepo 共用的 @pmp/* alias 生成器
├── tsconfig.base.json              各包共享的编译基线
└── pnpm-workspace.yaml
```

### 每个工具包的内部结构

所有工具包结构完全一致，复制即得一个新工具：

```
packages/tool-xxx/
├── package.json          # 名称 / 版本 / exports（.、./manifest、./page）/ 依赖与 peerDependencies
├── tsconfig.json         # 日常类型检查（@pmp/* 指向兄弟包 src）
├── tsconfig.build.json   # 发布用：只产 d.ts
├── vite.config.ts        # dev = 独立调试台；build = 库模式 ESM
├── index.html            # 独立调试台入口
├── dev/                  # 独立调试台（main.tsx + index.css）
└── src/
    ├── manifest.ts       # defineTool({...})：id/名称/描述/路径/图标/标签 + load()
    ├── page.tsx          # 工具页面（默认导出）
    ├── index.ts          # 导出 { default, toolManifest }
    ├── components/       # 该工具私有组件
    └── lib/              # 该工具私有逻辑
```

### 依赖关系

```
tool-contract ──┐
                ├─► tool-beauty ──────┐
ui ─────────────┤   tool-konva-image ─┤
                │   tool-photoshop ───┼─► apps/web
image-kit ──────┘   tool-diff ────────┘   （只依赖各包的 ./manifest + load()）
  └─► ui
```

- 工具之间**互不依赖**，只共同依赖 `@pmp/ui` / `@pmp/image-kit` / `@pmp/tool-contract`
- 外壳只静态引入各包的 `./manifest`（很轻），页面本体由 `ToolDef.load()` 动态 import，
  因此每个工具会被打成**独立 chunk**（构建产物里可见 `page-*.js`）
- 迁移某个工具 = 把 `packages/tool-xxx/` 整个目录搬走（或发布到 registry 后改一行依赖）

### 关于 `@pmp/*` 的解析（Windows 注意）

pnpm 的 workspace 依赖默认用 junction/symlink 链接，Windows 在无开发者模式时会出现
`UNKNOWN: unknown error, open ...`（见 `.npmrc` 注释）。因此：

1. `package.json` 里照常声明 `workspace:*`（发布、依赖图语义都正确）；
2. **开发态**额外用 `vite.aliases.mjs` + 各包 `tsconfig.json` 的 `paths` 把 `@pmp/*`
   直接指到兄弟包的真实 `src` —— 不依赖符号链接，且改 `packages/*` 源码能热更。

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
| AI 抠图 | `@imgly/background-removal-node`（后端本地 ONNX 推理，图片不出服务器；**AGPL-3.0**） |
| Lint | ESLint v9 flat config + Prettier |

## 已实现工具

### Konva 图片编辑器 (Konva Image Editor)

路径：`/tools/konva-image` · 包：`packages/tool-konva-image/`（页面 `src/page.tsx` + `src/components/konva-canvas.tsx`、`layer-panel.tsx`、`shortcut-settings-dialog.tsx` + `src/lib/layer-model.ts`、`image-shortcuts.ts`；`image-editor-ui` 已抽到 `packages/image-kit/`）

以 **Konva 10 + react-konva 19** 为底座的多图层图片编辑器，逐帧插值动画完整保留：

- **动画（逐帧插值的手感）**：用 `Konva.Animation` 每帧对旋转、翻转、拉伸、九项调色参数做指数插值 `approach()`，参数突变不会跳变；旋转按最短路径趋近（0° ↔ 270° 不会绕大圈）；换图有淡入（`appear` 0→1）
- **图层模型（`lib/layer-model.ts`，纯函数）**：参考 Figma / Photoshop，所有内容都是图层，结构是**可嵌套的树**——`CanvasLayer = photo | mark | group`，组内可再放组；同一父级内**数组顺序即 z 轴顺序（index 0 在最底）**；每个图层带独立的 名称 / 可见性 / 锁定 / 不透明度 / **混合模式**；查询与修改（深度查找、增删、跨父级移动、同层重排、置顶置底、上移下移、复制、编组解组、对齐分布、居中、适应画布、恢复原始比例）全部是纯函数，页面只负责把新树塞回 state，因此撤销重做与批量操作是同一套逻辑
- **编组（树形图层）**：`⌘/Ctrl + G` 编组、`⌘/Ctrl + ⇧ + G` 解组，面板支持折叠 / 展开与缩进展示；组不额外存变换——**选中组 = 选中组内所有叶子节点**，因此整体拖动 / 缩放 / 旋转由 Konva 的 `Transformer` 多节点变换直接完成，模型里始终只有一套归一化坐标
- **坐标系**：底图、图层、草稿、透视角点统一使用「画布中心为原点」的分组坐标（`归一化坐标 × 画布尺寸 − 半个画布`），交互回写时再加回半个画布，避免两套原点混用导致图层整体偏移
- **多选（成熟编辑器的手感）**：画布上 `Shift / ⌘ / Ctrl` 点选追加（点组内的元素会先选中整组，组已选中时再点会「钻」进下一层）、Shift 点图层行连选、⌘/Ctrl 点行多选、`⌘/Ctrl + A` 全选、`Esc` / 点空白取消；多选后 `Transformer` 同时绑定全部节点，**拖动任意一个节点或拖动包围盒内部即可整体移动**（Konva 的 `_proxyDrag` 原生代理，无需手写增量），缩放 / 旋转也是整体生效；选中的图层行会自动滚动到可视区
- **对齐 / 分布**：左 / 水平居中 / 右、上 / 垂直居中 / 下六向对齐（多选时相对选区包围盒，单选时相对画布），水平 / 垂直等距分布（≥3 个），以及在画布中水平 / 垂直居中、适应画布
- **混合模式**：16 种（正常 / 正片叠底 / 滤色 / 叠加 / 变暗 / 变亮 / 颜色减淡加深 / 强光 / 柔光 / 差值 / 排除 / 色相 / 饱和度 / 颜色 / 明度），直接落到 Konva 节点的 `globalCompositeOperation`。底图与所有图层现在共用一个画布，因此混合是真正与**底图**和下方图层混色；擦拭也不再使用 `destination-out`（那样会把底图画穿），而是「先把该区域内容擦掉，再把按笔迹形状裁出的底图补回来」，视觉效果保持一致
- **吸附辅助线**：拖动图层时按 8px 阈值吸附到画布边缘 / 中线与其他图层的边缘 / 中线，命中时显示虚线参考线（画布线紫色、图层线粉色），辅助线只画在覆盖层，不会进入导出图
- **图层面板（`layer-panel.tsx`）**：树形列表（缩进 + 折叠）、拖动左侧手柄调整层级（指针事件实现，触屏可用，带落点指示线；拖到组中间可放入该组）、双击重命名、显示 / 隐藏、锁定、混合模式、批量不透明度、置顶 / 置底 / 上移 / 下移 / 复制 / 删除、编组 / 解组、六向对齐 / 分布 / 画布居中 / 适应画布；底图固定在最底层并单独展示
- **底图操作**：底图再也不是「只能看不能动」——图层面板底图行右侧提供 `设为底图`（把选中的图片图层提升为底图，自动烘焙其翻转 / 90° 旋转）、`替换底图`（选文件换背景）、`底图转为图层`（画布尺寸不变，底图换成同尺寸透明画布、原底图变成最底层可自由移动 / 缩放 / 删除的图片图层）；图库缩略图**点击即新增图层**，「设为底图」是缩略图右下角的显式按钮，因此不会再有「点一下图片就把画布清空」的误操作；切换底图只替换底图本身，画布上的图层全部保留
- **导入落位**：没有底图时第一张作为底图（画布尺寸随之确定），其余图片自动成为图层——按画布 contain 适配（最大 60%）、居中并级联错开，插入到图层栈最上方后自动选中；图库缩略图可随时「设为底图」或「放回画布」
- **调色**：亮度 / 对比度 / 饱和度 / 色相 / 模糊 / 灰度 / 复古 / 反色 / 暗角 + 12 个滤镜预设（强度可调）。滤镜走 `ctx.filter`（GPU），预览与导出一致，无需 `cache()` 反复栅格化
- **裁剪**：比例预设 + 可拖拽裁剪框（复用 `ImageCropOverlay`），应用时用 `bakeOrientation` + `bakeCrop` 烘焙进底图
- **涂抹 / 标注**：涂抹、擦拭（还原底图语义）、马赛克（由底图生成像素化源图后按笔迹遮罩贴回）、涂层、形状（箭头/直线/方框/椭圆）、贴纸、文本；绘制完全复用 `paintMarks`，选中元素后可用 `Transformer` 移动 / 缩放 / 旋转（变换通过 `translateMark` / `scaleMark` 写回归一化模型，旋转由节点承担、绘制时用去旋转副本避免重复旋转）
- **文本**：放置后可**双击画布上的文字直接内联编辑**——浮层 `textarea` 按图层屏幕矩形（含旋转与视图缩放）定位，字号跟随画布缩放，`Enter` 换行、失焦或 `⌘/Ctrl + Enter` 保存、`Esc` 取消
- **几何**：任意角度拉直（`bakeFineRotate`，自动裁掉空白角）、透视校正（拖四角 + `bakePerspective` 拉直为矩形），两者与裁剪一样属于一次性烘焙：结果写回底图、画布元素一并重置、调色参数保留
- **导出**：`handle.exportCanvas(pixelRatio)` 1:1 取图（导出前临时把舞台重置为画布尺寸并隐藏选中框层，导出后恢复视图），JPG / WEBP 先铺白底再编码，预览与导出共用同一份图层与滤镜参数，不会出现位置偏差
- **界面布局**：预览区棋盘格底纹 + 右上角视图缩放胶囊（缩小 / 百分比 / 放大 / 适应窗口）、左上角当前工具提示胶囊、右下角标注笔数、左下角「按住看原图」按钮、空状态引导；左侧操作面板（涂抹 / 标注、变换、拉伸 / 尺寸、裁剪、调整、图库 / 图层、导出、历史步骤）
- **快捷键**：复用 `image-shortcuts` 的键位配置，顶部「快捷键」按钮打开设置弹窗（搜索 / 录制 / 冲突提示 / 恢复默认），保存到 `localStorage`（`pmp-image-shortcuts`）
- **其它**：撤销 / 重做（20 步）、历史步骤面板（点击可回退到该步之前）、重置、视图缩放（`Ctrl/⌘ + 滚轮`）、拖拽平移、双击复位视图、按住 `C` 对比原图

尚未迁移：拼图 / 批量导出、水印、相框 / 锐化 / 磨皮、涂抹笔迹的逐笔撤销（在 Konva 中分别对应多舞台导出 / `drawWatermark` / 一次性烘焙 / 命令栈实现）。

### 美图工坊 (Beauty Studio)

路径：`/tools/beauty` · 包：`packages/tool-beauty/`（`src/page.tsx` + `src/lib/beauty-studio.ts`）

参考美图秀秀的「日常修图」路径重新设计的产品：白底 + 紫色渐变 + 点阵背景的简约界面，全部处理都在浏览器本地完成（不上传服务器）：

- **一键美颜**：原图 / 自然 / 白皙 / 红润 / 清透 / 柔焦 / 强力七个预设，一键写入美颜滑杆；预设被手动改动后自动切到「自定义」
- **美颜细节（逐像素运算，`applySkin`）**：磨皮用「降采样高斯 + 边缘保护」——与模糊结果的差值越大（即轮廓 / 纹理）越保留原图，因此磨完不会糊成一片；美白按 `v += (255 - v) × k` 提亮暗部与中间调；红润只对偏暖的皮肤色区域加权加红，避免背景一起变红；清晰度用 USM 锐化（复用 `applySharpen`）
- **滤镜**：12 款预设（清新 / 胶片 / 黑白 / 复古 / 暖阳 / 冷调 / 鲜亮 / 奶白 / 夜色 / 梦幻 / 水墨），强度 0~100% 可调；滤镜与「调节」是两个独立图层，按强度插值后叠加
- **调节**：亮度 / 对比度 / 饱和度 / 色温 / 暗角 / 模糊 / 复古 / 黑白，以及旋转 90°、水平 / 垂直翻转
- **装饰**：12 个内置矢量贴纸 + 12 个 emoji + 文字，拖拽移动（指针事件 + `touch-action: none`，触屏可用）、缩放、旋转、换色；文字支持字体（黑体 / 宋体 / 等宽）与底色胶囊；`Delete` 删除、`Esc` 取消选中
- **实时预览的性能策略**：美颜（逐像素）在降采样到长边 1400 的预览图上计算并串到 `requestAnimationFrame`，拖动滑杆不卡；调色与滤镜走 CSS `filter` 实时生效；色温用 `soft-light` 混合层、暗角用径向渐变层；装饰层用独立小 canvas 绘制，导出与预览共用同一套 `drawDecos`
- **对比**：按住「对比」按钮随时看原图（同时屏蔽滤镜与装饰）
- **导出**：`exportImage` 在**全分辨率**底图上重跑一遍完整管线（美颜 → 方向 → 缩放 → 调色 / 滤镜 → 色温 → 暗角 → 装饰），PNG / JPG / WEBP 可选画质，并提供原尺寸 / 2048 / 1600 / 1080 / 640 长边预设，弹窗实时显示输出尺寸
- **其它**：`Ctrl+V` 粘贴导入、拖拽导入、无素材时一键生成示例图、撤销 / 重做（`Ctrl+Z` / `Ctrl+Shift+Z`，50 步）、一键重置全部效果

### Photoshop 基础 (Photoshop Basic)

路径：`/tools/photoshop` · 包：`packages/tool-photoshop/`（`src/page.tsx` + `src/lib/photoshop.ts`）

纯 Canvas 2D 的本地位图编辑器，覆盖 Photoshop 最常用的一层能力：

> 画布编辑、图层、选区、调整等**全部在浏览器里完成，不上传服务器**。唯一的例外是
> 「AI 抠图」——它会把图片 POST 给**本机自己跑的**抠图服务（`servers/cutout-api`）做去背景，
> 不会发往任何第三方接口。

- **工具**：移动、矩形 / 椭圆选框、套索、魔棒、画笔、橡皮擦、**马赛克**（`K`，拖拽涂抹打码，格子 3–64 px / 笔刷直径可调，`[` `]` 快速改笔刷）、油漆桶（容差）、渐变（线性 / 径向，前景→透明 / 前景→背景）、吸管、文字、形状（矩形 / 椭圆 / 直线 / 箭头）、裁剪
- **图层**：新建 / 复制 / 删除 / 上移下移 / 向下合并 / 合并可见图层，独立可见性、不透明度与 16 种混合模式，双击重命名，缩略图实时刷新；支持 **Ctrl/Shift 多选**多个图层一起移动 / 删除 / 合并 / 显隐
- **AI 抠图（`Q`）**：一键去掉背景，支持「整图抠图」与「抠当前图层」两种口径，结果作为**透明背景的新图层**插入，原图层全部保留；推理跑在本地抠图服务 `servers/cutout-api` 的 ONNX 引擎里（`@imgly/background-removal-node`），**图片不发往第三方**
- **拼图**：内置多图拼接，按网格模板（2/3/4/6/9 宫格）或纵向 / 横向长图把多张图片拼成一张，支持间距、圆角、背景色、输出宽度，可直接导出或生成到新文档继续编辑
- **选区**：矩形 / 椭圆（`M` / `Shift+M`）、套索（`L`，手绘圈选）、魔棒（`W`，按颜色容差连通选择，均为蒙版选区）；全选 `Ctrl+A`、反选、取消 `Ctrl+D`，删除 / 填充限定在选区内；形状选区以蚂蚁线动画、蒙版选区以蓝色染色 + 轮廓呈现
- **调整**：亮度 / 对比度 / 饱和度 / 色相 / 模糊滑杆（作用于当前图层并可限定选区，预览走 `ctx.filter`），反相 / 去色 / 锐化 / **马赛克** 一键滤镜
- **变换**：图层与整幅图像的 水平 / 垂直翻转、旋转 90°（图像旋转会随文档尺寸一起换向）；**自由变换（`Ctrl+T`）**——对选中图层整体移动 / 缩放（Shift 等比例）/ 旋转（顶部手柄），Enter 应用、Esc 取消，支持多选图层同时变换
- **历史**：20 步快照，撤销 / 重做与历史面板点击回退
- **多文档**：顶部标签页同时打开多张图片 / 新建文档，各自独立图层、历史、缩放与选区，双击重命名、点 × 关闭、`+` 新建
- **导入导出**：新建（预设尺寸 / 白底 / 透明）、打开图片（作为新标签页）与置入图层、拖拽 / `Ctrl+V` 粘贴为图层，导出 PNG / JPG / WEBP（可选质量）
- **其它**：缩放（`Ctrl+滚轮` / 按钮 / `Ctrl+0` 100%）、适应窗口、画笔 `[`/`]` 调大小、`X` 交换前景背景色、`D` 默认颜色

尚未实现：自由变换 / 图像大小重采样、图层蒙版、通道与路径、套索与磁性选区、自定义形状库。

> **关于 AI 抠图**
>
> - **为什么不直接用大模型 API**：DeepSeek 等对话/视觉模型的接口是「图片 + 文本 → 文本」，
>   只能描述图片，**没有分割 / 蒙版 / alpha 通道输出**，做不了像素级抠图。
>   因此这里走的是**专用抠图引擎**，而不是通用大模型。
> - **服务端**：`servers/cutout-api`（Express，默认端口 **3002**），
>   `POST /api/cutout` 收 `multipart/form-data` 的 `image` 字段，
>   返回透明背景的 PNG，并带 `X-Cutout-Engine` / `X-Cutout-Ms` 响应头；
>   `GET /api/cutout/capabilities` 可查询引擎与模型档位。
> - **图片只经过内存**：multer 用 `memoryStorage`，不落盘，也不发给第三方。
> - **模型随 npm 包分发，运行时不需要联网**：`dist/` 下是哈希命名的 ONNX / wasm 资源 +
>   `resources.json`（内含 `/models/small` 与 `/models/medium` 两份，整包解压后约 131MB）。
>   首次抠图只是加载 ONNX 会话，约几秒；`CUTOUT_MODEL=small` 可切到更小的模型。
> - **注意 `publicPath`**：本仓库用的是 `node-linker=hoisted`，依赖被提升到根 `node_modules`，
>   而引擎默认按 cwd 拼 `node_modules/@imgly/...` 找资源会落空。
>   `engine.js` 用 `require.resolve` 定位真实 `dist` 目录，兼容 hoisted / 嵌套两种布局，
>   也可用 `CUTOUT_PUBLIC_PATH` 覆盖。
> - **⚠️ 许可**：`@imgly/background-removal-node` 是 **AGPL-3.0**。
>   AGPL 第 13 条要求「通过网络对外提供服务」的修改版向使用者开放源码，
>   所以**闭源对外提供服务需要另行取得商业授权**。
>   引擎已被隔离在 `servers/cutout-api/src/lib/engine.js` 一个文件里：
>   换成 `onnxruntime-node`（MIT）+ U²-Net（Apache-2.0）的 ONNX 模型即可，
>   路由层与前端接口契约完全不用改。
> - **代码位置**：服务端 `servers/cutout-api/`，
>   前端调用层 `packages/tool-photoshop/src/lib/cutout-api.ts`，
>   界面入口是 `packages/tool-photoshop/src/page.tsx` 的「AI 抠图」工具。

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
pnpm install        # 一次装好 workspace 全部包
pnpm dev            # 同时跑「差异对比后端 + 抠图后端 + 应用外壳」
```

- 应用外壳：http://localhost:5173
- 差异对比后端：http://localhost:3001
- 抠图后端：http://localhost:3002（Photoshop 工具的「AI 抠图」依赖它）

### 单独开发某个工具

每个工具包自带独立调试台（`index.html` + `dev/`），不依赖 `apps/web`：

```bash
pnpm --filter @pmp/tool-beauty dev          # http://localhost:5181  美图工坊
pnpm --filter @pmp/tool-konva-image dev     # http://localhost:5182  Konva 图片编辑器
pnpm --filter @pmp/tool-photoshop dev       # http://localhost:5183  Photoshop 基础（/api 已代理到 3002）
pnpm --filter @pmp/tool-diff dev            # http://localhost:5184  差异对比（/api 已代理到 3001）
```

## 常用命令

```bash
pnpm dev                # 两个后端 + 外壳
pnpm dev:web            # 只跑外壳
pnpm dev:server         # 只跑差异对比后端（3001）
pnpm dev:cutout         # 只跑抠图后端（3002）

pnpm build              # 构建应用外壳（apps/web）
pnpm build:packages     # 构建全部 packages/*（ESM + d.ts，可单独发布）
pnpm typecheck          # 全部包类型检查
pnpm lint / pnpm format # 根目录统一 lint / 格式化
pnpm samples            # 重新生成差异对比的样例文件

# 单独构建某个包
pnpm --filter @pmp/ui build
pnpm --filter @pmp/tool-diff build

# 给某子包加依赖
pnpm --filter @pmp/tool-diff add xlsx
pnpm --filter @pmp/diff-api add -D jest
```

> 发布单个工具包：`pnpm --filter @pmp/tool-beauty publish`。
> 包内 `publishConfig` 会把 `exports` 从源码（`src/*.ts`）切到产物（`dist/*.js` + `*.d.ts`），
> `workspace:*` 也会被 pnpm 改写成真实版本号。

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
[pmp-diff-api] LibreOffice detected: ... → .doc 将保留格式转换为 docx
```

或：

```
[pmp-diff-api] LibreOffice 未检测到 → .doc 仅可降级提取纯文本
```

### 后端能力查询

```bash
GET /api/capabilities
```

返回 `{ libreoffice: bool, docToDocx: bool, docToText: true }`。

## 添加新工具

1. 复制一个现成工具包，例如 `cp -r packages/tool-photoshop packages/tool-xxx`
2. 改 `packages/tool-xxx/package.json` 的 `name` / `description` / 依赖
3. 改 `src/manifest.ts` 里的 `id` / `name` / `description` / `path` / `icon` / `tags`
   （`load: () => import('./page')` 不用动），然后重写 `src/page.tsx`
4. 需要引用其它包时：在 `package.json` 加 `"@pmp/xxx": "workspace:*"`，
   并在该包 `tsconfig.json` 的 `paths` 里加一条映射
5. 在外壳注册一行：`apps/web/src/tools-registry.ts` 的 `tools` 数组加入新 manifest

首页卡片、侧边栏图标、路由、顶栏副标题都会自动出现；页面自动按工具分包。
若该工具需要后端，按 `servers/diff-api/` 的样子新建一个 `servers/*` 包，
在 `src/routes/` 里加路由模块并在 `src/app.js` 挂载即可。
