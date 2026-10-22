import { File, type FileOptions, Virtualizer } from "@pierre/diffs/react";
import { useRef } from "react";

import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { useClientSettings } from "~/hooks/useSettings";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { FILE_SOURCE_UNSAFE_CSS } from "./fileSurfaceChrome";
import { useWordOccurrenceHighlights } from "./wordOccurrenceHighlights";

export default function ReadOnlySourcePreview(props: {
  readonly name: string;
  readonly text: string;
  readonly cacheKey?: string;
  readonly onPostRender?: FileOptions<unknown, undefined>["onPostRender"];
  /** A preview's own wrap toggle; omitted follows the word wrap setting. */
  readonly wordWrap?: boolean;
}) {
  const resolvedTheme = useRenderedAppearance();
  const defaultWordWrap = useClientSettings((settings) => settings.wordWrap);
  const wordWrap = props.wordWrap ?? defaultWordWrap;
  const rootRef = useRef<HTMLDivElement>(null);
  useWordOccurrenceHighlights(rootRef, () => props.text);
  return (
    <DiffWorkerPoolProvider>
      <div ref={rootRef} className="contents">
        <Virtualizer
          key={`${props.name}:${resolvedTheme}:${props.text.length}`}
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
        >
          <File
            file={{
              name: props.name,
              contents: props.text,
              ...(props.cacheKey ? { cacheKey: props.cacheKey } : {}),
            }}
            options={{
              disableFileHeader: true,
              overflow: wordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: FILE_SOURCE_UNSAFE_CSS,
              ...(props.onPostRender ? { onPostRender: props.onPostRender } : {}),
            }}
            className="min-h-full"
          />
        </Virtualizer>
      </div>
    </DiffWorkerPoolProvider>
  );
}
