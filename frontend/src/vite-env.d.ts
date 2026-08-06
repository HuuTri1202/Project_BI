/// <reference types="vite/client" />

/** Khai báo kiểu cho biến môi trường VITE_* để `import.meta.env` không bị any. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_KEYCLOAK_URL: string;
  readonly VITE_KEYCLOAK_REALM: string;
  readonly VITE_KEYCLOAK_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
