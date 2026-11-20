/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import type { DiagramBoardId, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { drawioEmbedUrl } from "./drawioAssets";
import { openDrawioSession, type DrawioSession } from "./drawioSession";

/**
 * One draw.io diagram hosted in an offline same-origin iframe. The server holds the `.drawio` XML
 * file; `drawioSession` syncs autosaves and live-merges edits from other windows.
 */
export default function DrawioPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: DiagramBoardId;
}) {
  const { environmentId, boardId } = props;
  const appearance = useRenderedAppearance();
  const [initialAppearance] = useState(appearance);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const sessionRef = useRef<DrawioSession | null>(null);
  const embedSrc = drawioEmbedUrl(initialAppearance);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the postMessage bridge to the mounted draw.io iframe and flushes unsaved edits on unmount
  useEffect(() => {
    if (iframe === null) return;
    const expectedOrigin = new URL(embedSrc, window.location.href).origin;
    const opened = openDrawioSession({
      iframe,
      expectedOrigin,
      environmentId,
      boardId,
      initialAppearance,
      onReady: () => setReady(true),
      onSaveFailed: setSaveFailed,
    });
    sessionRef.current = opened;
    return () => {
      sessionRef.current = null;
      opened.close();
    };
  }, [iframe, embedSrc, environmentId, boardId, initialAppearance]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards app light/dark changes to the mounted draw.io iframe without reloading it
  useEffect(() => {
    sessionRef.current?.setAppearance(appearance);
  }, [appearance]);

  return (
    <div
      role="application"
      aria-label="draw.io"
      className="relative h-full min-h-0 w-full bg-background"
      data-testid="drawio-panel"
      data-drawio-ready={ready ? "true" : "false"}
    >
      {/* oxlint-disable-next-line react/iframe-missing-sandbox -- self-hosted same-origin draw.io editor needs scripts and same-origin XHR for local assets */}
      <iframe
        ref={setIframe}
        src={embedSrc}
        title="draw.io"
        className="block h-full w-full border-0"
      />
      {saveFailed ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs text-destructive shadow-sm"
        >
          Changes are not saved. They will be sent again with your next edit.
        </div>
      ) : null}
    </div>
  );
}
