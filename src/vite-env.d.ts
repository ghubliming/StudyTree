/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set for the static GitHub Pages build: no API server. */
  readonly VITE_STATIC?: string;
}
