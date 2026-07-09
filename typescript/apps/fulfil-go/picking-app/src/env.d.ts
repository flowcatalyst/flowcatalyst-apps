/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute server URL for native builds; empty in browser dev (Vite proxy). */
  readonly VITE_API_BASE_URL?: string;
  /** Browser-dev principal for the server's x-user-id dev fallback. */
  readonly VITE_DEV_USER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
