/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by vite.config.ts's `define` at build time — package.json's
// version plus the exact git commit that was built, so a viewer can tell
// which deploy they're actually on (see Layout.tsx's version footer).
declare const __APP_VERSION__: string
declare const __GIT_HASH__: string
