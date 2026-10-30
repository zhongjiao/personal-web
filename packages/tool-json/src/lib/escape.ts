/**
 * 两套互转工具：
 *  1. JSON 字符串字面量：`转义` / `去转义`（\n \t \uXXXX …）；
 *  2. HTML 实体：`转实体字符` / `去实体字符`（&amp; &lt; &#x4e2d; …）。
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const HTML_ESCAPE_RE = /[&<>"']/g;

/**
 * 转实体字符：把会破坏 HTML 结构的 5 个字符换成命名实体。
 * 只处理这 5 个 —— 中文、emoji 等原样保留，需要数字实体时用 `&#x…;` 自行书写，
 * 「去实体字符」同样支持把它们还原回来。
 */
export function encodeHtmlEntities(text: string): string {
  return text.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPES[ch]);
}

/** 渲染 HTML 片段时的转义（与「转实体字符」同一套映射） */
export function escapeHtml(text: string): string {
  return encodeHtmlEntities(text);
}

export function escapeAttr(text: string): string {
  return escapeHtml(text);
}

/** 常用命名实体反向表（大小写敏感：`&Alpha;` 与 `&alpha;` 不是同一个字符） */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  prime: '′',
  Prime: '″',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  sect: '§',
  para: '¶',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  minus: '−',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  curren: '¤',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  infin: '∞',
  ne: '≠',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  equiv: '≡',
  sum: '∑',
  prod: '∏',
  radic: '√',
  part: '∂',
  int: '∫',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω'
};

/** `&#123;` / `&#x1F600;` / `&amp;` —— 三种形态一次匹配 */
const ENTITY_PATTERN = '&(#x[0-9a-fA-F]{1,6}|#\\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});';
const ENTITY_TEST_RE = new RegExp(ENTITY_PATTERN);
const ENTITY_GLOBAL_RE = new RegExp(ENTITY_PATTERN, 'g');

export function hasHtmlEntities(text: string): boolean {
  return ENTITY_TEST_RE.test(text);
}

/**
 * 去实体字符：命名实体 + 十进制 / 十六进制数字实体。
 * 只解一层 —— `&amp;lt;` 得到 `&lt;`（而不是 `<`），这样「转实体 → 去实体」能严格还原；
 * 认不出的实体（如 `&unknown;`）原样保留，避免误伤普通文本。
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY_GLOBAL_RE, (match, token: string) => {
    if (token.startsWith('#')) {
      const hex = token[1] === 'x' || token[1] === 'X';
      const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      // 0 与超出 Unicode 范围的值留在原样，不做「静默替换成 �」这种事
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return safeFromCodePoint(code);
    }
    return NAMED_ENTITIES[token] ?? match;
  });
}

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
