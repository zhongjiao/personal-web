/// <reference types="vite/client" />

declare module '*?url' {
  const url: string;
  export default url;
}

declare module 'pdfjs-dist/build/pdf.mjs';
declare module 'pdfjs-dist/build/pdf.worker.mjs?url';
