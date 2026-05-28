/// <reference types="vite/client" />

declare module '*?url' {
  const url: string;
  export default url;
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module 'pdfjs-dist/build/pdf.mjs';
declare module 'pdfjs-dist/build/pdf.worker.mjs?url';
