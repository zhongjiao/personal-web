import {
  createCanvas,
  ensureMaskAlpha,
  intersectRect,
  layerBounds,
  type AdjustmentLayer,
  type EditorDocument,
  type LayerMask,
  type LayerNode,
  type RasterLayer,
  type Rect
} from '../document';
import { applyAdjustment } from '../adjustments';
import { effectMargin } from '../effects';
import { applyMask, drawBody, expandRect, sampleAlpha } from '../render';
import { BLEND_GLSL, BLEND_MODE_INDEX } from './blend-glsl';
import type { GlDevice } from './device';
import { createGlEffects, renderStrokeRing } from './effects';

/**
 * WebGL2 合成器。
 *
 * ## 为什么只搬「合成」这一步
 *
 * Canvas2D 的 `drawImage` 本来就是浏览器在 GPU 上做的，17 种原生混合模式并不慢。
 * 真正拖后腿的只有那 7 种浏览器没有的模式（线性加深 / 亮光 / 线性光 / 点光 / 实色混合 /
 * 减去 / 划分）—— 它们每层要 `getImageData` + 逐像素 JS 循环 + `putImageData`，
 * 是整个合成器唯一被迫走 CPU 的地方。
 *
 * 所以这里**不重写像素准备**：图层变换、蒙版、图层效果、调整图层算子，全部照旧由 Canvas2D
 * （`render.ts` 里那几个函数）算好，GPU 只负责最后一件事 —— 把算好的位图按不透明度与
 * 混合模式合到目标上。这样两条路径的差异被压到只有一个函数，可以逐像素对拍（见 `verify` 注释）。
 *
 * ## 目标不是显示画布
 *
 * 合成结果落在 FBO 纹理上，最后一帧 `drawImage` 到原来的 2D 显示画布。
 * 这样上层完全不用改：魔棒照样 `getImageData`、导出照样 `toBlob`、缩略图照样画。
 *
 * ## 坐标约定（三处必须一致，写错一处就整块错位）
 *
 * - 纹理第 j 行 ↔ 文档 y = 目标原点 + j（**不**用 `UNPACK_FLIP_Y_WEBGL`，
 *   画布第一行落在纹理第 0 行）；
 * - NDC：对 **FBO** 目标，`docY` 增大方向对应 NDC y 减小方向（`* 2 - 1`）；
 *   但**默认帧缓冲**按 GL 惯例显示（行 0 在画布底部），所以要再乘 `uNdcFlip = -1`，
 *   否则最后搬到画布时会上下颠倒。这个差异只出现在「FBO → 屏幕」那一次搬运上；
 * - 因此 `gl.scissor` 的 y 直接就是「文档行号 − 目标原点行号」，`readPixels` 返回的第一行
 *   就是矩形最上面那一行 —— 两处都不需要翻转；
 * - **合成结果必须显式搬一次到默认帧缓冲**：`drawImage(gl.canvas)` 读的是默认帧缓冲，
 *   只往 FBO 里画的话它永远是空白（这一条踩过一次，对拍时表现为「GPU 侧全透明」）。
 */

const VERTEX_GLSL = `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec4 uTarget;
uniform vec4 uReadRect;
uniform vec4 uSrcRect;
uniform float uNdcFlip;
out vec2 vBackUV;
out vec2 vSrcUV;
out vec2 vDoc;
void main() {
  vec2 doc = uRect.xy + aPos * uRect.zw;
  vDoc = doc;
  vBackUV = (doc - uReadRect.xy) / uReadRect.zw;
  vSrcUV = (doc - uSrcRect.xy) / uSrcRect.zw;
  vec2 ndc = ((doc - uTarget.xy) / uTarget.zw) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, ndc.y * uNdcFlip, 0.0, 1.0);
}`;

const COPY_GLSL = `#version 300 es
precision highp float;
in vec2 vBackUV;
out vec4 outColor;
uniform sampler2D uBackdrop;
void main() { outColor = texture(uBackdrop, vBackUV); }`;

const COMPOSITE_GLSL = `#version 300 es
precision highp float;
in vec2 vBackUV;
in vec2 vSrcUV;
out vec4 outColor;
uniform sampler2D uBackdrop;
uniform sampler2D uSource;
uniform float uOpacity;
uniform int uMode;
${BLEND_GLSL}
void main() {
  vec4 backdrop = texture(uBackdrop, vBackUV);
  // 源矩形之外原样透传：源位图只覆盖它自己那一块，其余像素必须保持背景不动
  if (vSrcUV.x < 0.0 || vSrcUV.x >= 1.0 || vSrcUV.y < 0.0 || vSrcUV.y >= 1.0) {
    outColor = backdrop;
    return;
  }
  outColor = w3cComposite(backdrop, texture(uSource, vSrcUV), uOpacity, uMode);
}`;

const MASK_GLSL = `#version 300 es
precision highp float;
in vec2 vBackUV;
in vec2 vDoc;
out vec4 outColor;
uniform sampler2D uBackdrop;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
void main() {
  vec4 inner = texture(uBackdrop, vBackUV);
  vec2 uv = (vDoc - uMaskRect.xy) / uMaskRect.zw;
  float a = 1.0;
  if (uv.x >= 0.0 && uv.x < 1.0 && uv.y >= 0.0 && uv.y < 1.0) a = texture(uMask, uv).a;
  // 等价于 Canvas2D 的 destination-in：alpha 相乘、RGB 不变
  outColor = vec4(inner.rgb, inner.a * a);
}`;

/** 纹理单元：0 号给「背景/目标」，1 号给「源/蒙版」 */
const UNIT_BACKDROP = 0;
const UNIT_SOURCE = 1;

interface GlProgram {
  program: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

interface Surface {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  x: number;
  y: number;
  width: number;
  height: number;
  busy: boolean;
  /** FBO 目标：纹理行 0 就在文档上方，不需要翻转 NDC */
  flipY: boolean;
}

/** 绘制目标的几何描述；默认帧缓冲借用它、并置 `flipY` */
interface QuadTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  flipY: boolean;
}

export interface GlCompositor {
  /** 合成结果所在画布，供调用方 `drawImage` 到显示画布 */
  readonly canvas: HTMLCanvasElement;
  readonly maxTextureSize: number;
  /** 返回 false 表示这张文档超出 GPU 能力或 GL 已失效，调用方应回退到 Canvas2D */
  render(doc: EditorDocument, dirty: Rect | null): boolean;
  dispose(): void;
}

export function createGlCompositor(): GlCompositor | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    // 结果要跨帧保留（脏矩形只重绘一小块），并且要被 drawImage 取用
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false
  });
  if (!gl) return null;

  try {
    return build(gl, canvas);
  } catch {
    return null;
  }

  function build(
    gl2: WebGL2RenderingContext,
    surfaceCanvas: HTMLCanvasElement
  ): GlCompositor {
    const maxTextureSize = gl2.getParameter(gl2.MAX_TEXTURE_SIZE) as number;

    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl2.createShader(type);
      if (!shader) throw new Error('createShader 失败');
      gl2.shaderSource(shader, source);
      gl2.compileShader(shader);
      if (!gl2.getShaderParameter(shader, gl2.COMPILE_STATUS)) {
        const log = gl2.getShaderInfoLog(shader) ?? '无日志';
        gl2.deleteShader(shader);
        throw new Error(`着色器编译失败：${log}`);
      }
      return shader;
    };

    const link = (vertex: string, fragment: string): GlProgram => {
      const program = gl2.createProgram();
      if (!program) throw new Error('createProgram 失败');
      const vs = compile(gl2.VERTEX_SHADER, vertex);
      const fs = compile(gl2.FRAGMENT_SHADER, fragment);
      gl2.attachShader(program, vs);
      gl2.attachShader(program, fs);
      // 固定 aPos 到 0 号属性槽，这样三个程序可以共用一个 VAO
      gl2.bindAttribLocation(program, 0, 'aPos');
      gl2.linkProgram(program);
      gl2.deleteShader(vs);
      gl2.deleteShader(fs);
      if (!gl2.getProgramParameter(program, gl2.LINK_STATUS)) {
        const log = gl2.getProgramInfoLog(program) ?? '无日志';
        gl2.deleteProgram(program);
        throw new Error(`程序链接失败：${log}`);
      }
      const cache = new Map<string, WebGLUniformLocation | null>();
      return {
        program,
        u: (name: string) => {
          if (!cache.has(name)) cache.set(name, gl2.getUniformLocation(program, name));
          return cache.get(name) ?? null;
        }
      };
    };

    const copyProgram = link(VERTEX_GLSL, COPY_GLSL);
    const compositeProgram = link(VERTEX_GLSL, COMPOSITE_GLSL);
    const maskProgram = link(VERTEX_GLSL, MASK_GLSL);

    // 单位四边形（三角形带）
    const vao = gl2.createVertexArray();
    const quad = gl2.createBuffer();
    gl2.bindVertexArray(vao);
    gl2.bindBuffer(gl2.ARRAY_BUFFER, quad);
    gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl2.STATIC_DRAW);
    gl2.enableVertexAttribArray(0);
    gl2.vertexAttribPointer(0, 2, gl2.FLOAT, false, 0, 0);
    gl2.bindVertexArray(null);

    gl2.disable(gl2.BLEND);
    gl2.disable(gl2.DEPTH_TEST);
    gl2.disable(gl2.CULL_FACE);
    gl2.enable(gl2.SCISSOR_TEST);
    gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, false);
    gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    /**
     * 上传纹理用**一组轮转**而不是单张复用。
     *
     * 原因：效果链里精灵与描边环要同时活着 —— 单张复用的话，上传描边环会把刚上传的精灵覆盖掉，
     * 合成时读到的就是描边而不是本体。环长 4 足够：同帧内同时存活的上传不超过 2 张，
     * 而 GL 按提交顺序执行，槽位被下一层重用时上一层的绘制命令早已提交。
     */
    const uploadTextures = [0, 1, 2, 3].map(() => {
      const texture = gl2.createTexture();
      if (!texture) throw new Error('createTexture 失败');
      return texture;
    });
    let uploadCursor = 0;

    const upload = (source: TexImageSource, filter: number): WebGLTexture => {
      const texture = uploadTextures[uploadCursor];
      uploadCursor = (uploadCursor + 1) % uploadTextures.length;
      gl2.activeTexture(gl2.TEXTURE0 + UNIT_SOURCE);
      gl2.bindTexture(gl2.TEXTURE_2D, texture);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, filter);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, filter);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA8, gl2.RGBA, gl2.UNSIGNED_BYTE, source);
      return texture;
    };

    const createSurface = (width: number, height: number): Surface => {
      const texture = gl2.createTexture();
      if (!texture) throw new Error('createTexture 失败');
      gl2.activeTexture(gl2.TEXTURE0 + UNIT_BACKDROP);
      gl2.bindTexture(gl2.TEXTURE_2D, texture);
      gl2.texImage2D(
        gl2.TEXTURE_2D,
        0,
        gl2.RGBA8,
        width,
        height,
        0,
        gl2.RGBA,
        gl2.UNSIGNED_BYTE,
        null
      );
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);

      const framebuffer = gl2.createFramebuffer();
      if (!framebuffer) throw new Error('createFramebuffer 失败');
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, framebuffer);
      gl2.framebufferTexture2D(
        gl2.FRAMEBUFFER,
        gl2.COLOR_ATTACHMENT0,
        gl2.TEXTURE_2D,
        texture,
        0
      );
      if (gl2.checkFramebufferStatus(gl2.FRAMEBUFFER) !== gl2.FRAMEBUFFER_COMPLETE) {
        throw new Error('帧缓冲不完整');
      }
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
      return { texture, framebuffer, x: 0, y: 0, width, height, busy: false, flipY: false };
    };

    const deleteSurface = (s: Surface): void => {
      gl2.deleteFramebuffer(s.framebuffer);
      gl2.deleteTexture(s.texture);
    };

    /** 组目标与背景副本共用的池：同尺寸复用，避免每帧新建纹理 */
    const pool: Surface[] = [];
    let docSurface: Surface | null = null;

    const resetAll = (): void => {
      for (const s of pool) deleteSurface(s);
      pool.length = 0;
      if (docSurface) deleteSurface(docSurface);
      docSurface = null;
    };

    /** 池里的表面按尺寸复用，滤波方式每次重设 —— 同一块表面可能这次当合成目标、下次当金字塔一级 */
    const setFilter = (surface: Surface, linear: boolean): void => {
      gl2.activeTexture(gl2.TEXTURE0 + UNIT_BACKDROP);
      gl2.bindTexture(gl2.TEXTURE_2D, surface.texture);
      const filter = linear ? gl2.LINEAR : gl2.NEAREST;
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, filter);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, filter);
    };

    const acquire = (
      width: number,
      height: number,
      x: number,
      y: number,
      linear = false
    ): Surface => {
      for (const s of pool) {
        if (!s.busy && s.width === width && s.height === height) {
          s.busy = true;
          s.x = x;
          s.y = y;
          setFilter(s, linear);
          return s;
        }
      }
      const created = createSurface(width, height);
      created.busy = true;
      created.x = x;
      created.y = y;
      setFilter(created, linear);
      pool.push(created);
      return created;
    };

    const release = (s: Surface): void => {
      s.busy = false;
    };

    const rectOf = (s: QuadTarget): [number, number, number, number] => [
      s.x,
      s.y,
      s.width,
      s.height
    ];

    const bindSurface = (s: Surface): void => {
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, s.framebuffer);
      gl2.viewport(0, 0, s.width, s.height);
    };

    /** 文档矩形 → 目标自身的裁剪框（因为 NDC 是「docY 向下对应 y 减小」，这里不需要翻转） */
    const setScissor = (rect: Rect, s: Surface): void => {
      gl2.scissor(rect.x - s.x, rect.y - s.y, Math.max(0, rect.w), Math.max(0, rect.h));
    };

    const selectProgram = (p: GlProgram): void => {
      gl2.useProgram(p.program);
    };

    const setQuad = (
      p: GlProgram,
      quadRect: Rect,
      target: QuadTarget,
      readSurface: QuadTarget,
      srcRect: Rect
    ): void => {
      gl2.uniform4f(p.u('uRect'), quadRect.x, quadRect.y, quadRect.w, quadRect.h);
      const t = rectOf(target);
      gl2.uniform4f(p.u('uTarget'), t[0], t[1], t[2], t[3]);
      const r = rectOf(readSurface);
      gl2.uniform4f(p.u('uReadRect'), r[0], r[1], r[2], r[3]);
      gl2.uniform4f(p.u('uSrcRect'), srcRect.x, srcRect.y, srcRect.w, srcRect.h);
      gl2.uniform1f(p.u('uNdcFlip'), target.flipY ? -1 : 1);
    };

    const bindTexture = (p: GlProgram, name: string, texture: WebGLTexture, unit: number): void => {
      gl2.activeTexture(gl2.TEXTURE0 + unit);
      gl2.bindTexture(gl2.TEXTURE_2D, texture);
      gl2.uniform1i(p.u(name), unit);
    };

    const drawQuad = (): void => {
      gl2.bindVertexArray(vao);
      gl2.drawArrays(gl2.TRIANGLE_STRIP, 0, 4);
      gl2.bindVertexArray(null);
    };

    /* ── 合成 ──────────────────────────────────────────────────── */

    /**
     * 把 `sourceTexture` 按不透明度与混合模式合进 `target` 的 `clip` 区域。
     *
     * 分两步走 —— 先把目标内容抄进一张与 clip 同尺寸的副本，再「读副本 + 读源 → 写目标」。
     * 之所以要绕这一下：着色器不能同时读写同一张纹理。这样绕开之后，目标纹理在 clip
     * **之外**的像素始终没被动过，脏矩形的正确性得以保持（与 Canvas2D 路径同一套论证）。
     */
    const compositeInto = (
      target: Surface,
      sourceTexture: WebGLTexture,
      srcRect: Rect,
      opacity: number,
      blendMode: keyof typeof BLEND_MODE_INDEX,
      clip: Rect
    ): void => {
      const scratch = acquire(clip.w, clip.h, clip.x, clip.y);

      bindSurface(scratch);
      setScissor(clip, scratch);
      selectProgram(copyProgram);
      setQuad(copyProgram, clip, scratch, target, clip);
      bindTexture(copyProgram, 'uBackdrop', target.texture, UNIT_BACKDROP);
      drawQuad();

      bindSurface(target);
      setScissor(clip, target);
      selectProgram(compositeProgram);
      setQuad(compositeProgram, clip, target, scratch, srcRect);
      bindTexture(compositeProgram, 'uBackdrop', scratch.texture, UNIT_BACKDROP);
      bindTexture(compositeProgram, 'uSource', sourceTexture, UNIT_SOURCE);
      gl2.uniform1f(compositeProgram.u('uOpacity'), opacity);
      gl2.uniform1i(compositeProgram.u('uMode'), BLEND_MODE_INDEX[blendMode]);
      drawQuad();

      release(scratch);
    };

    /** 组蒙版：`inner.a *= mask.a`，等价于 Canvas2D 的 destination-in */
    const applyTargetMask = (
      surface: Surface,
      doc: EditorDocument,
      mask: LayerMask,
      clip: Rect
    ): void => {
      const scratch = acquire(clip.w, clip.h, clip.x, clip.y);

      bindSurface(scratch);
      setScissor(clip, scratch);
      selectProgram(copyProgram);
      setQuad(copyProgram, clip, scratch, surface, clip);
      bindTexture(copyProgram, 'uBackdrop', surface.texture, UNIT_BACKDROP);
      drawQuad();

      bindSurface(surface);
      setScissor(clip, surface);
      selectProgram(maskProgram);
      setQuad(maskProgram, clip, surface, scratch, clip);
      bindTexture(maskProgram, 'uBackdrop', scratch.texture, UNIT_BACKDROP);
      // 蒙版是灰度渐变，用 LINEAR 更贴近 Canvas2D 的双线性缩放；尺寸恰好一致时与 NEAREST 等价
      bindTexture(maskProgram, 'uMask', upload(ensureMaskAlpha(mask), gl2.LINEAR), UNIT_SOURCE);
      gl2.uniform4f(maskProgram.u('uMaskRect'), 0, 0, doc.width, doc.height);
      drawQuad();

      release(scratch);
    };

    const readRegion = (surface: Surface, rect: Rect): ImageData => {
      const buf = new Uint8Array(rect.w * rect.h * 4);
      bindSurface(surface);
      gl2.readPixels(
        rect.x - surface.x,
        rect.y - surface.y,
        rect.w,
        rect.h,
        gl2.RGBA,
        gl2.UNSIGNED_BYTE,
        buf
      );
      return new ImageData(new Uint8ClampedArray(buf.buffer), rect.w, rect.h);
    };

    /**
     * 调整图层：把当前已合成内容读回来 → 套算子 → 按「蒙版覆盖率 × 选区覆盖率」调制源 alpha → 合回去。
     * 读回用 `readPixels`，与 Canvas2D 路径的 `getImageData` 是同一量级的同步停顿，没有变差。
     */
    const renderAdjustment = (
      target: Surface,
      doc: EditorDocument,
      layer: AdjustmentLayer,
      clip: Rect
    ): void => {
      if (clip.w <= 0 || clip.h <= 0) return;

      const original = readRegion(target, clip);
      const adjusted = new ImageData(new Uint8ClampedArray(original.data), clip.w, clip.h);
      applyAdjustment(adjusted, layer.adjustment);

      const maskData =
        layer.mask && layer.maskEnabled ? sampleAlpha(ensureMaskAlpha(layer.mask), clip) : null;
      const selectionData = doc.selection ? sampleAlpha(doc.selection, clip) : null;

      const od = original.data;
      const ad = adjusted.data;
      const count = clip.w * clip.h;
      for (let p = 0, i = 0; p < count; p += 1, i += 4) {
        let mix = 1;
        if (maskData) mix *= maskData[i + 3] / 255;
        if (selectionData) mix *= selectionData[i + 3] / 255;
        ad[i + 3] = od[i + 3] * mix;
      }

      const { canvas: temp, ctx } = createCanvas(clip.w, clip.h);
      ctx.putImageData(adjusted, 0, 0);
      compositeInto(
        target,
        upload(temp, gl2.NEAREST),
        clip,
        layer.opacity,
        layer.blendMode,
        clip
      );
    };

    /* ── 效果链所需的绘图原语 ─────────────────────────────────── */

    /**
     * 把合成器已有的内部工具包成 `GlDevice` 交给效果链 ——
     * 效果模块因此不必知道表面池、脏矩形、FBO 归属这些细节，合成器也不必被效果代码撑大。
     */
    const device: GlDevice = {
      gl: gl2,
      link: (vertex, fragment) => link(vertex, fragment),
      acquire: (width, height, x, y, linear) => acquire(width, height, x, y, linear),
      release: (target) => release(target as Surface),
      draw: (request) => {
        const out = request.out as Surface;
        bindSurface(out);
        selectProgram(request.program);
        // 效果链的约定：所有输入纹理都恰好覆盖 rect，因此读取矩形与源矩形都填 rect 本身
        setQuad(request.program, request.rect, out, out, request.rect);
        for (const binding of request.textures ?? []) {
          bindTexture(request.program, binding.name, binding.texture, binding.unit);
        }
        for (const [name, value] of Object.entries(request.uniforms ?? {})) {
          // 合成器的顶点着色器没有 uReadRect/uSrcRect 之外的 uniform 时，位置为 null，
          // 对 null 位置赋值在 WebGL 里是静默忽略 —— 这里依赖这一点复用同一套设置代码。
          const location = request.program.u(name);
          if (typeof value === 'number') gl2.uniform1f(location, value);
          else if (value.length === 2) gl2.uniform2f(location, value[0], value[1]);
          else if (value.length === 3) gl2.uniform3f(location, value[0], value[1], value[2]);
          else gl2.uniform4f(location, value[0], value[1], value[2], value[3]);
        }
        setScissor(request.rect, out);
        drawQuad();
      },
      read: (target, rect) => readRegion(target as Surface, rect)
    };

    const effectChain = createGlEffects(device);

    /* ── 图层遍历（结构与 render.ts 的 drawLayers 一一对应） ────── */

    /** 把一张画布走完效果链再合成；`sprite`/`stroke` 已是纹理时走 `renderEffectTexture` */
    const finishWithEffects = (
      target: Surface,
      layer: RasterLayer | Extract<LayerNode, { kind: 'group' }>,
      outBounds: Rect,
      clip: Rect,
      spriteTexture: WebGLTexture,
      strokeTexture: WebGLTexture | null
    ): void => {
      const composed =
        layer.effects &&
        effectChain.render({
          effects: layer.effects,
          sprite: spriteTexture,
          stroke: strokeTexture,
          rect: outBounds
        });

      compositeInto(
        target,
        composed ? composed.texture : spriteTexture,
        outBounds,
        layer.opacity,
        layer.blendMode,
        clip
      );
      if (composed) release(composed as Surface);
    };

    const renderRaster = (
      target: Surface,
      doc: EditorDocument,
      layer: RasterLayer,
      _raw: Rect,
      outBounds: Rect,
      clip: Rect,
      margin: number
    ): void => {
      // 本体与蒙版：有 / 无效果都是同一段代码、同一块 outBounds 尺寸的精灵
      const { canvas: sprite, ctx } = createCanvas(outBounds.w, outBounds.h);
      ctx.translate(-outBounds.x, -outBounds.y);
      drawBody(doc, ctx, layer, outBounds);
      if (layer.mask && layer.maskEnabled) applyMask(doc, ctx, layer);

      // 有效果时精灵要参与金字塔降采样，必须 LINEAR；否则 1:1 合成，NEAREST 才是逐位精确的
      const spriteTexture = upload(sprite, margin === 0 ? gl2.NEAREST : gl2.LINEAR);
      if (margin === 0) {
        compositeInto(target, spriteTexture, outBounds, layer.opacity, layer.blendMode, clip);
        return;
      }

      // 描边环仍由 Canvas2D 画（见 effects.ts 顶部的取舍说明）
      const ring = renderStrokeRing(sprite, layer.effects?.stroke ?? null);
      finishWithEffects(
        target,
        layer,
        outBounds,
        clip,
        spriteTexture,
        ring ? upload(ring, gl2.LINEAR) : null
      );
    };

    const renderGroup = (
      target: Surface,
      doc: EditorDocument,
      layer: Extract<LayerNode, { kind: 'group' }>,
      _raw: Rect,
      outBounds: Rect,
      clip: Rect,
      margin: number
    ): void => {
      // 子树先合成到一块组级 FBO，整组再当作一个图层参与上层合成 ——
      // 这样「组不透明度压暗组内所有内容」与「组混合模式作用于合成结果」都成立
      const sub = acquire(outBounds.w, outBounds.h, outBounds.x, outBounds.y);
      bindSurface(sub);
      setScissor(outBounds, sub);
      gl2.clearColor(0, 0, 0, 0);
      gl2.clear(gl2.COLOR_BUFFER_BIT);
      renderTree(sub, doc, layer.children, outBounds);

      if (layer.mask && layer.maskEnabled) applyTargetMask(sub, doc, layer.mask, outBounds);

      if (margin === 0) {
        compositeInto(target, sub.texture, outBounds, layer.opacity, layer.blendMode, clip);
        release(sub);
        return;
      }

      // 有效果：组结果已经躺在 FBO 里，直接当精灵喂给效果链 —— 子树不必退回 Canvas2D。
      // 唯一需要读回的情形是「描边」：它的环要 Canvas2D 才算得出来。
      let ringTexture: WebGLTexture | null = null;
      if (layer.effects?.stroke?.enabled && layer.effects.stroke.size > 0) {
        const { canvas: spriteCanvas, ctx: sctx } = createCanvas(outBounds.w, outBounds.h);
        sctx.putImageData(readRegion(sub, outBounds), 0, 0);
        const ring = renderStrokeRing(spriteCanvas, layer.effects.stroke);
        if (ring) ringTexture = upload(ring, gl2.LINEAR);
      }
      // 子树的合成早就画完了，这里改滤波只影响效果链对它的取样
      setFilter(sub, true);

      finishWithEffects(target, layer, outBounds, clip, sub.texture, ringTexture);
      release(sub);
    };

    const renderTree = (
      target: Surface,
      doc: EditorDocument,
      layers: LayerNode[],
      clip: Rect
    ): void => {
      for (const layer of layers) {
        if (!layer.visible || layer.opacity <= 0) continue;

        if (layer.kind === 'adjustment') {
          renderAdjustment(target, doc, layer, clip);
          continue;
        }

        const raw = layerBounds(layer);
        if (!raw || raw.w <= 0 || raw.h <= 0) continue;

        const margin = effectMargin(layer.effects);
        const outBounds = intersectRect(margin > 0 ? expandRect(raw, margin) : raw, clip);
        if (!outBounds || outBounds.w <= 0 || outBounds.h <= 0) continue;

        if (layer.kind === 'group') {
          renderGroup(target, doc, layer, raw, outBounds, clip, margin);
        } else {
          renderRaster(target, doc, layer, raw, outBounds, clip, margin);
        }
      }
    };

    /**
     * 把 FBO 里的合成结果搬到默认帧缓冲 —— 显示画布要靠 `drawImage(gl.canvas)` 取它。
     *
     * 目标表面在脏矩形之外始终保留着上一帧的内容（见 `compositeInto` 的说明），
     * 所以这里整张搬过去是安全的，而且只需一次全屏四边形拷贝。
     */
    const blitToScreen = (source: Surface, full: Rect): void => {
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
      gl2.viewport(0, 0, surfaceCanvas.width, surfaceCanvas.height);
      gl2.scissor(0, 0, surfaceCanvas.width, surfaceCanvas.height);
      selectProgram(copyProgram);
      setQuad(
        copyProgram,
        full,
        { x: 0, y: 0, width: surfaceCanvas.width, height: surfaceCanvas.height, flipY: true },
        source,
        full
      );
      bindTexture(copyProgram, 'uBackdrop', source.texture, UNIT_BACKDROP);
      drawQuad();
    };

    /* ── 对外入口 ──────────────────────────────────────────────── */

    let failed = false;

    const ensureSize = (width: number, height: number): void => {
      if (surfaceCanvas.width === width && surfaceCanvas.height === height) return;
      surfaceCanvas.width = width;
      surfaceCanvas.height = height;
      resetAll();
    };

    const ensureDocSurface = (width: number, height: number): Surface => {
      if (docSurface && docSurface.width === width && docSurface.height === height) return docSurface;
      if (docSurface) deleteSurface(docSurface);
      docSurface = createSurface(width, height);
      return docSurface;
    };

    return {
      canvas: surfaceCanvas,
      maxTextureSize,
      render(doc: EditorDocument, dirty: Rect | null): boolean {
        if (failed) return false;
        if (doc.width < 1 || doc.height < 1) return false;
        if (doc.width > maxTextureSize || doc.height > maxTextureSize) return false;

        const full: Rect = { x: 0, y: 0, w: doc.width, h: doc.height };
        const region = dirty ? intersectRect(dirty, full) : full;

        try {
          ensureSize(doc.width, doc.height);
          if (!region || region.w <= 0 || region.h <= 0) return true;

          const target = ensureDocSurface(doc.width, doc.height);
          bindSurface(target);
          setScissor(region, target);
          gl2.clearColor(0, 0, 0, 0);
          gl2.clear(gl2.COLOR_BUFFER_BIT);

          renderTree(target, doc, doc.layers, region);
          blitToScreen(target, full);

          // 一次兜底自检：驱动不认某条路径时不要让整页黑掉，直接退回 Canvas2D
          if (gl2.getError() !== gl2.NO_ERROR) {
            failed = true;
            return false;
          }
          return true;
        } catch {
          failed = true;
          return false;
        }
      },
      dispose(): void {
        resetAll();
        for (const texture of uploadTextures) gl2.deleteTexture(texture);
        gl2.deleteBuffer(quad);
        gl2.deleteVertexArray(vao);
        for (const p of [copyProgram, compositeProgram, maskProgram]) gl2.deleteProgram(p.program);
        failed = true;
      }
    };
  }
}
