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
  /**
   * Client ID của Google — §1.9. Không khai thì nút Google không hiện.
   *
   * ⚠️ `?:` chứ không phải bắt buộc, và đó là chủ ý: tính năng này tuỳ chọn,
   * nên khai bắt buộc ở đây là bắt mọi người tự dựng dự án phải đi xin một
   * client ID họ chưa cần. Vite nhúng thẳng giá trị này vào bundle — client ID
   * vốn công khai nên không sao, nhưng client SECRET thì TUYỆT ĐỐI không.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
