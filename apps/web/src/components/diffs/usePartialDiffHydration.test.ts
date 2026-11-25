import type { FileDiffMetadata, PostRenderPhase } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it, vi } from "vite-plus/test";

import { createPartialDiffHydration } from "./usePartialDiffHydration";

function changedFile(name: string): FileDiffMetadata {
  return parsePatchFiles(
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -5,3 +5,3 @@\n before\n-old\n+new\n after\n`,
  )[0]!.files[0]!;
}

function addedFile(name: string): FileDiffMetadata {
  return parsePatchFiles(
    `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n+new\n`,
  )[0]!.files[0]!;
}

interface Instance {
  diff: FileDiffMetadata | undefined;
  getDiffForSearch(): FileDiffMetadata | undefined;
  prepareForEditing(): Promise<void>;
}

/** Stands in for the code view: an instance asks the loader, then completes its diff in place. */
function codeView() {
  const hydration = createPartialDiffHydration();
  const requests: string[] = [];
  const reads = new Map<string, PromiseWithResolvers<void>>();
  const load = hydration.loader(async (fileDiff) => {
    requests.push(fileDiff.name);
    const read = Promise.withResolvers<void>();
    reads.set(fileDiff.name, read);
    await read.promise;
    return { oldFile: null, newFile: { name: fileDiff.name, contents: "" } };
  });
  return {
    requests,
    reads,
    instance: (): Instance => ({
      diff: undefined,
      getDiffForSearch() {
        return this.diff;
      },
      async prepareForEditing() {
        const fileDiff = this.diff!;
        await load(fileDiff);
        if (this.diff === fileDiff) fileDiff.isPartial = false;
      },
    }),
    render(
      instance: Instance,
      fileDiff: FileDiffMetadata,
      { phase = "mount", collapsed = false }: { phase?: PostRenderPhase; collapsed?: boolean } = {},
    ) {
      instance.diff = fileDiff;
      hydration.rendered(phase, { type: "diff", instance, item: { collapsed } });
    },
  };
}

describe("createPartialDiffHydration", () => {
  it("loads the files of the diffs on screen two at a time, newest first", async () => {
    const view = codeView();
    for (const name of ["a.py", "b.py", "c.py", "d.py"]) {
      view.render(view.instance(), changedFile(name));
    }
    expect(view.requests).toEqual(["a.py", "b.py"]);

    view.reads.get("a.py")!.resolve();
    await vi.waitFor(() => expect(view.requests).toEqual(["a.py", "b.py", "d.py"]));
    view.reads.get("b.py")!.resolve();
    await vi.waitFor(() => expect(view.requests).toEqual(["a.py", "b.py", "d.py", "c.py"]));
  });

  it("leaves alone the diffs that have nothing to load or are no longer shown", async () => {
    const view = codeView();
    const complete = changedFile("complete.py");
    complete.isPartial = false;
    view.render(view.instance(), complete);
    view.render(view.instance(), addedFile("added.py"));
    view.render(view.instance(), changedFile("collapsed.py"), { collapsed: true });
    expect(view.requests).toEqual([]);

    for (const name of ["a.py", "b.py", "c.py"]) view.render(view.instance(), changedFile(name));
    // Newest, so it would be next in line if it were still shown.
    const scrolledAway = view.instance();
    const hidden = changedFile("hidden.py");
    view.render(scrolledAway, hidden);
    view.render(scrolledAway, hidden, { phase: "unmount" });
    view.reads.get("a.py")!.resolve();
    await vi.waitFor(() => expect(view.requests).toEqual(["a.py", "b.py", "c.py"]));
  });

  it("asks once for files that cannot be read", async () => {
    const view = codeView();
    const instance = view.instance();
    const unreadable = changedFile("unreadable.py");
    view.render(instance, unreadable);
    for (const name of ["a.py", "b.py"]) view.render(view.instance(), changedFile(name));
    view.reads.get("unreadable.py")!.reject(new Error("too large"));
    await vi.waitFor(() => expect(view.requests).toEqual(["unreadable.py", "a.py", "b.py"]));

    view.render(view.instance(), changedFile("c.py"));
    // Newest, so it would be next in line if it were asked for again.
    view.render(instance, unreadable, { phase: "update" });
    view.reads.get("a.py")!.resolve();
    await vi.waitFor(() =>
      expect(view.requests).toEqual(["unreadable.py", "a.py", "b.py", "c.py"]),
    );
  });

  it("loads again through the instance a diff moved to while it was loading", async () => {
    const view = codeView();
    const moved = changedFile("moved.py");
    const first = view.instance();
    view.render(first, moved);
    // The viewer reused the first instance for another file, so it drops the files it asked for.
    first.diff = undefined;
    view.render(view.instance(), moved);
    expect(view.requests).toEqual(["moved.py"]);

    view.reads.get("moved.py")!.resolve();
    await vi.waitFor(() => expect(view.requests).toEqual(["moved.py", "moved.py"]));
  });
});
