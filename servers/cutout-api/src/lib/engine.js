/**
 * 抠图引擎封装
 *
 * 整条链路上**只有这个文件**依赖第三方抠图库，换引擎时只改这里，
 * 路由层 / 前端都不用动 —— 只要仍然「收图片字节、返回 PNG 字节」即可。
 *
 * 当前实现：`@imgly/background-removal-node`（IMG.LY）
 * - 模型默认 `medium`（首次下载约 80MB，质量更好）；`CUTOUT_MODEL=small` 约 40MB，更快
 * - 首次调用会下载模型 / wasm，之后走本地缓存
 * - 图片全程只在这台机器上处理，不会发往第三方
 *
 * ⚠️ 许可证注意
 * `@imgly/background-removal-node` 是 **AGPL-3.0**（见 node_modules 里的 LICENSE.md）。
 * AGPL 第 13 条要求「通过网络对外提供服务」的修改版必须向使用者开放对应源码，
 * 因此**闭源对外提供服务需要另行取得商业授权**。
 * 若本项目需要宽松许可，把 `removeImageBackground` 换成
 * `onnxruntime-node`（MIT）+ U²-Net（Apache-2.0）的 ONNX 模型即可，
 * 其余代码与接口契约完全不用改。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { removeBackground } = require('@imgly/background-removal-node');

/** 模型档位：medium（默认，质量好）/ small（快，体积小） */
const MODEL = process.env.CUTOUT_MODEL === 'small' ? 'small' : 'medium';

/**
 * 模型 / wasm 资源目录。
 *
 * 不能依赖引擎的默认值：它按 `path.resolve('node_modules/@imgly/background-removal-node/dist/')`
 * 相对 **cwd** 拼路径，而本仓库 `.npmrc` 用的是 `node-linker=hoisted`，
 * 依赖被提升到仓库根 `node_modules`，从 `servers/cutout-api` 起跑时默认路径并不存在。
 * 这里改用 `require.resolve` 拿到入口文件的真实位置，天然兼容 hoisted / 嵌套两种链接方式。
 * 需要自托管资源时用 `CUTOUT_PUBLIC_PATH` 覆盖（目录，需以 / 结尾或由 pathToFileURL 补上）。
 */
const PUBLIC_PATH = (() => {
  if (process.env.CUTOUT_PUBLIC_PATH) return process.env.CUTOUT_PUBLIC_PATH;
  // require.resolve 返回 .../@imgly/background-removal-node/dist/index.cjs
  const distDir = path.dirname(require.resolve('@imgly/background-removal-node'));
  return pathToFileURL(distDir + path.sep).href;
})();

/** 引擎元信息，供启动日志与 /api/cutout/capabilities 暴露 */
function getEngineInfo() {
  return {
    name: '@imgly/background-removal-node',
    license: 'AGPL-3.0',
    model: MODEL,
    publicPath: PUBLIC_PATH
  };
}

/**
 * 去掉图片背景，返回透明背景的 PNG。
 * @param {Buffer} input 原始图片字节（PNG / JPEG / WEBP）
 * @param {string} [mimeType] 原始图片的 MIME 类型；**必须传**，引擎靠它判格式
 * @returns {Promise<Buffer>} PNG 字节
 */
async function removeImageBackground(input, mimeType) {
  // 引擎的入参联合类型为 Buffer | ArrayBuffer | Uint8Array | Blob | URL | string，
  // 这里统一包成 Blob：传 Blob 时必须带 type，否则引擎会以
  // `Unsupported format: `（空格式名）报错，它不按文件内容嗅探
  const source = new Blob([input], { type: mimeType || 'image/png' });
  const blob = await removeBackground(source, {
    publicPath: PUBLIC_PATH,
    model: MODEL,
    output: { format: 'image/png', type: 'foreground' }
  });
  return Buffer.from(await blob.arrayBuffer());
}

module.exports = { getEngineInfo, removeImageBackground };
