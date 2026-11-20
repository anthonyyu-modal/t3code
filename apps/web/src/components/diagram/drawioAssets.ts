/** Must match `ROUTE` in apps/web/vite/drawioAssets.ts. */
const DRAWIO_ASSET_PAGE = "drawio-assets/index.html";

/**
 * Builds the local same-origin embed URL for the self-hosted offline draw.io editor.
 * Every cloud storage provider and external service is disabled so it runs under desktop CSP.
 */
export function drawioEmbedUrl(appearance: "light" | "dark"): string {
  const url = new URL(`${import.meta.env.BASE_URL}${DRAWIO_ASSET_PAGE}`, window.location.href);
  const params = url.searchParams;
  params.set("embed", "1");
  params.set("proto", "json");
  params.set("spin", "1");
  params.set("offline", "1");
  params.set("stealth", "1");
  params.set("lockdown", "1");
  params.set("pwa", "0");
  params.set("math", "0");
  params.set("ui", "min");
  params.set("dark", appearance === "dark" ? "1" : "0");
  params.set("noSaveBtn", "1");
  params.set("noExitBtn", "1");
  params.set("libraries", "1");
  params.set("lang", "en");
  params.set("gapi", "0");
  params.set("od", "0");
  params.set("ms365", "0");
  params.set("gh", "0");
  params.set("gl", "0");
  params.set("db", "0");
  params.set("tr", "0");
  params.set("browser", "0");
  params.set("noDevice", "1");
  return url.href;
}
