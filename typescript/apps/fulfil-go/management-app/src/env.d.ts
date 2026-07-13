/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_USER_ID?: string;
  /** Display name for the dev-fallback principal (x-user-name → /auth/me). */
  readonly VITE_DEV_USER_NAME?: string;
  /** MapLibre style JSON url (vehicle map tiles). Default: MapLibre demo style. */
  readonly VITE_MAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
