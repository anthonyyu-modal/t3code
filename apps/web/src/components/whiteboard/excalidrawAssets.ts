// Excalidraw fetches its fonts at run time and falls back to a CDN, which the desktop app's
// content policy blocks. vite.config.ts ships the fonts with the app under this path instead.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
  `${import.meta.env.BASE_URL}excalidraw-assets/`,
  window.location.href,
).href;
