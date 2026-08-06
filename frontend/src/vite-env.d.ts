/// <reference types="vite/client" />

/** Khai báo kiểu cho biến môi trường VITE_* để `import.meta.env` không bị any. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
