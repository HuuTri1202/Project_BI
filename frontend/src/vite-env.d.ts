/// <reference types="vite/client" />

/**
 * Khai báo kiểu cho biến môi trường VITE_* để `import.meta.env` không bị any.
 *
 * `vite/client` có sẵn một index signature `[key: string]: any`, nên đọc bằng
 * `env['TEN_BIEN']` vẫn biên dịch được — nhưng trả về `any`, và gõ sai tên biến
 * thành `undefined` lúc chạy mà không ai báo. Khai tường minh ở đây thì gõ sai
 * là lỗi biên dịch.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
