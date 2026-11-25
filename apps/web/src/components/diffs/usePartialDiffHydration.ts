import type { FileDiffContentsLoader, FileDiffMetadata, PostRenderPhase } from "@pierre/diffs";
import { useState } from "react";

// Keeps up with scrolling and leaves the server's other git slots free.
const MAX_CONCURRENT_LOADS = 2;

interface RenderedDiff {
  /** The diff this instance shows, which can be an older object than its item's `fileDiff`. */
  getDiffForSearch(): FileDiffMetadata | undefined;
  /** Loads a patch-only diff's files through the viewer's `loadDiffFiles`, then re-renders. */
  prepareForEditing(): Promise<void>;
}

/** The context a code view passes to `onPostRender`. */
export type RenderedCodeViewItem =
  | { readonly type: "file" }
  | {
      readonly type: "diff";
      readonly instance: RenderedDiff;
      readonly item: { readonly collapsed?: boolean | undefined };
    };

/**
 * Loads the whole files of the diffs a code view has on screen. A patch holds only the lines
 * around each change, so the viewer highlights every hunk as if the file began there: a hunk that
 * starts inside a docstring or block comment takes the closing delimiter for an opening one and
 * colours the code after it as a string. Given the files, it highlights from the first line.
 */
export function createPartialDiffHydration() {
  const failed = new WeakSet<FileDiffMetadata>();
  const loading = new Set<FileDiffMetadata>();
  // Newest last, so diffs scrolled past while they waited give way to the ones on screen.
  const waiting = new Set<RenderedDiff>();

  const needsFiles = (fileDiff: FileDiffMetadata) =>
    fileDiff.isPartial &&
    // The patch of an added or deleted file is already the whole file.
    (fileDiff.type === "change" || fileDiff.type === "rename-changed") &&
    !failed.has(fileDiff);

  const start = () => {
    for (const instance of [...waiting].toReversed()) {
      const fileDiff = instance.getDiffForSearch();
      if (fileDiff === undefined || !needsFiles(fileDiff)) waiting.delete(instance);
      // A diff that moved to another instance mid-load waits: the viewer drops that load's files.
      else if (loading.size < MAX_CONCURRENT_LOADS && !loading.has(fileDiff)) {
        waiting.delete(instance);
        loading.add(fileDiff);
        void instance
          .prepareForEditing()
          // A failed read is recorded by `loader`; the viewer reports it and keeps the patch.
          .catch(() => undefined)
          .finally(() => {
            loading.delete(fileDiff);
            start();
          });
      }
    }
  };

  return {
    /** Wraps the viewer's `loadDiffFiles`, so a diff whose files cannot be read is asked once. */
    loader:
      (load: FileDiffContentsLoader): FileDiffContentsLoader =>
      async (fileDiff) => {
        try {
          return await load(fileDiff);
        } catch (error) {
          failed.add(fileDiff);
          throw error;
        }
      },
    /** Call from the viewer's `onPostRender`, only while it has a `loadDiffFiles`. */
    rendered(phase: PostRenderPhase, rendered: RenderedCodeViewItem) {
      if (rendered.type !== "diff") return;
      waiting.delete(rendered.instance);
      if (phase === "unmount" || rendered.item.collapsed === true) return;
      waiting.add(rendered.instance);
      start();
    },
  };
}

export function usePartialDiffHydration() {
  const [hydration] = useState(createPartialDiffHydration);
  return hydration;
}
