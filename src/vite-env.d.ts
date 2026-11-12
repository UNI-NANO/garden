/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** emulator / staging / prod. 없으면 emulator. */
  readonly VITE_GARDEN_ENV?: string;
}
