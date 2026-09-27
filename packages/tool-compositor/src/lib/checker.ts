import type { CSSProperties } from 'react';

/** 透明棋盘格底纹，画布舞台与图层缩略图共用 */
export const CHECKER_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#c9c9c9 25%,transparent 25%),linear-gradient(-45deg,#c9c9c9 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#c9c9c9 75%),linear-gradient(-45deg,transparent 75%,#c9c9c9 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0'
};
