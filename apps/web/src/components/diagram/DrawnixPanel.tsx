/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import "@plait-board/react-board/index.css";
import "@plait-board/react-text/index.css";
import "@drawnix/drawnix/index.css";
import "./drawnixOverrides.css";

import { Drawnix } from "@drawnix/drawnix";
import { ThemeColorMode, type PlaitElement, type PlaitTheme, type Viewport } from "@plait/core";
import type { DiagramBoardId, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { openDrawnixSession, type DrawnixDocument, type DrawnixSession } from "./drawnixSession";

interface LoadedBoard {
  readonly elements: PlaitElement[];
  readonly viewport?: Viewport | undefined;
  readonly theme: PlaitTheme;
}

function defaultDrawnixTheme(appearance: "light" | "dark"): PlaitTheme {
  return {
    themeColorMode: appearance === "dark" ? ThemeColorMode.dark : ThemeColorMode.default,
  };
}

// Drawnix's I18nProvider defaults to "zh" when localStorage["language"] is unset.
function ensureDrawnixEnglishDefault(): void {
  try {
    if (window.localStorage.getItem("language") === null) {
      window.localStorage.setItem("language", "en");
    }
  } catch {
    // Ignore restricted storage contexts.
  }
}

/**
 * One Drawnix board (Plait + Slate rich text). Mounts Drawnix once the server delivers the saved
 * `.drawnix` document so initial viewport, elements, and theme load without a fit-viewport jump.
 */
export default function DrawnixPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: DiagramBoardId;
}) {
  const { environmentId, boardId } = props;
  const appearance = useRenderedAppearance();
  const [initialAppearance] = useState(appearance);
  const [loaded, setLoaded] = useState<LoadedBoard | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const sessionRef = useRef<DrawnixSession | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the server's `.drawnix` document while mounted and flushes unsaved edits on unmount
  useEffect(() => {
    ensureDrawnixEnglishDefault();
    const opened = openDrawnixSession({
      environmentId,
      boardId,
      onInitialLoad: (doc) => {
        setLoaded({
          elements: doc.elements,
          ...(doc.viewport === undefined ? {} : { viewport: doc.viewport }),
          theme: doc.theme ?? defaultDrawnixTheme(initialAppearance),
        });
      },
      onRemoteUpdate: (doc) => {
        setLoaded((current) => ({
          elements: doc.elements,
          ...(doc.viewport === undefined ? {} : { viewport: doc.viewport }),
          theme: doc.theme ?? current?.theme ?? defaultDrawnixTheme(initialAppearance),
        }));
      },
      onSaveFailed: setSaveFailed,
    });
    sessionRef.current = opened;
    return () => {
      sessionRef.current = null;
      opened.close();
    };
  }, [environmentId, boardId, initialAppearance]);

  const handleChange = (data: {
    readonly children: PlaitElement[];
    readonly viewport: Viewport;
    readonly theme: PlaitTheme;
  }) => {
    const doc: DrawnixDocument = {
      elements: data.children,
      viewport: data.viewport,
      theme: data.theme,
    };
    sessionRef.current?.changed(doc);
  };

  return (
    <div
      role="application"
      aria-label="Drawnix"
      tabIndex={-1}
      className="@container relative h-full min-h-0 w-full overflow-hidden outline-none select-none"
      data-testid="drawnix-panel"
      data-whiteboard-keys
      data-drawnix-keys
      onPointerDownCapture={(event) => {
        if (
          !(
            event.target instanceof Element &&
            event.target.closest('input, textarea, select, [contenteditable="true"]')
          )
        ) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
    >
      {loaded === null ? null : (
        <Drawnix
          value={loaded.elements}
          {...(loaded.viewport === undefined ? {} : { viewport: loaded.viewport })}
          theme={loaded.theme}
          tutorial={false}
          onChange={handleChange}
        />
      )}
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
