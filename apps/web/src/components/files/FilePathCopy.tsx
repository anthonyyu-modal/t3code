import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useGT, useMessages } from "gt-react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard, writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { fileClipboardPaths } from "./filePath";
import { FileSurfaceAction } from "./fileSurfaceChrome";

function useCopyFailureToast() {
  const gt = useGT();
  const m = useMessages();
  return (error: unknown) => {
    toastManager.add({
      type: "error",
      title: gt("Failed to copy path"),
      description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
    });
  };
}

/** Copies the open file's or folder's full path from the file view header. */
export function FilePathCopyAction(props: { readonly path: string; readonly cwd: string }) {
  const gt = useGT();
  const showFailure = useCopyFailureToast();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ onError: showFailure });
  return (
    <FileSurfaceAction
      label={isCopied ? gt("Copied") : gt("Copy full path")}
      onPress={() => copyToClipboard(fileClipboardPaths(props.path, props.cwd).full, undefined)}
    >
      {isCopied ? (
        <CheckIcon className="size-3.5 text-success" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </FileSurfaceAction>
  );
}

/** Right-click handler for a breadcrumb: copies that crumb's full or relative path. */
export function useCopyPathContextMenu(cwd: string) {
  const gt = useGT();
  const showFailure = useCopyFailureToast();
  return (event: ReactMouseEvent, path: string) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const paths = fileClipboardPaths(path, cwd);
    void (async () => {
      const clicked = await api.contextMenu.show(
        [
          { id: "copy-full", label: gt("Copy full path") },
          ...(paths.relative === null
            ? []
            : [{ id: "copy-relative" as const, label: gt("Copy relative path") }]),
        ],
        { x: event.clientX, y: event.clientY },
      );
      if (clicked === null) return;
      await writeTextToClipboard(
        clicked === "copy-relative" && paths.relative !== null ? paths.relative : paths.full,
      );
    })().catch(showFailure);
  };
}
