import type { Rect } from '../document';

/**
 * GL 绘图原语接口。
 *
 * 合成器（`compositor.ts`）在自己的闭包里实现它，效果链（`effects.ts`）只依赖这个接口 ——
 * 这样效果模块不必知道表面池、脏矩形、FBO 归属这些细节，合成器也不必被效果代码撑大。
 */

export interface GlProgramRef {
  program: WebGLProgram;
  /** 取 uniform 位置（带缓存）；名字不存在时返回 null */
  u: (name: string) => WebGLUniformLocation | null;
}

export interface GlTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  /** 该目标在文档坐标中的原点与尺寸 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** FBO 目标恒为 false；默认帧缓冲为 true（见合成器顶部的坐标约定） */
  flipY: boolean;
}

export interface GlDrawRequest {
  program: GlProgramRef;
  out: GlTarget;
  /**
   * 四边形覆盖的**文档矩形**。
   * 约定：所有输入纹理都恰好覆盖这个矩形，因此可以共用同一个归一化 UV ——
   * 效果链里每一层的模糊场都对齐同一块区域，正是靠这条约定省掉了一整套坐标换算。
   */
  rect: Rect;
  textures?: { name: string; texture: WebGLTexture; unit: number }[];
  uniforms?: Record<string, number | number[]>;
}

export interface GlDevice {
  readonly gl: WebGL2RenderingContext;
  /** 链接一个程序；顶点着色器自带（效果链用自己那套），aPos 固定绑到 0 号属性槽 */
  link(vertexSource: string, fragmentSource: string): GlProgramRef;
  /**
   * 取一块临时表面（从池里复用）；用完必须 `release`。
   *
   * `linear` 默认为 false（NEAREST）—— 合成本身都是 1:1 纹素对齐，NEAREST 才是逐位精确的。
   * 但模糊金字塔的升采样必须用 LINEAR，否则放大会退化成块状（曾在投影边缘留下 2 像素台阶）。
   */
  acquire(width: number, height: number, x: number, y: number, linear?: boolean): GlTarget;
  release(target: GlTarget): void;
  draw(request: GlDrawRequest): void;
  /** 从目标读回一块像素（y 方向已对齐文档坐标，不需要翻转） */
  read(target: GlTarget, rect: Rect): ImageData;
}
