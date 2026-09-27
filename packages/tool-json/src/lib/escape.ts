/**
 * 转义 / 去转义：把一整段文本当成「JSON 字符串字面量」互转。
 * 典型场景：拿到的是 `"<div>a\n</div>"` 这种被转义过的 HTML / JSON 片段，
 * 先「去转义」再贴进编辑器或预览。
 */

/** 文本 → JSON 字符串字面量（含首尾引号） */
export function encodeAsJsonString(text: string): string {
  return JSON.stringify(text);
}

/** 是否看起来像被转义过的文本（用于给「去转义」按钮加提示） */
export function hasEscapes(text: string): boolean {
  return /\\[nrtbfv"'\\/u0-9]/.test(text);
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "'": "'",
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  0: '\0'
};

/**
 * 去转义：支持 \n \r \t \b \f \v \0 \" \' \\ \/ \uXXXX \xHH
 * 遇到无法识别的转义序列时原样保留（`\d` 仍然是 `\d`）。
 */
export function decodeEscapes(text: string): string {
  return text.replace(
    /\\(u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
    (_match, _whole, codePoint: string, u: string, x: string, simple: string) => {
      if (codePoint) return safeFromCodePoint(parseInt(codePoint, 16));
      if (u) return safeFromCodePoint(parseInt(u, 16));
      if (x) return safeFromCodePoint(parseInt(x, 16));
      if (simple in SIMPLE_ESCAPES) return SIMPLE_ESCAPES[simple];
      return `\\${simple}`;
    }
  );
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
