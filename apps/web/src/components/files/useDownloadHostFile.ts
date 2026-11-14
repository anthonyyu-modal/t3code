import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { resolveAssetUrl } from "~/assets/assetUrls";
import { assetEnvironment } from "~/state/assets";
import { readPreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import { stackedThreadToast, toastManager } from "../ui/toast";

async function saveToThisDevice(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The environment did not send the file. Try again.");
  // The desktop app is not served over http, so a link to the file would open in a browser.
  const blobUrl = URL.createObjectURL(await response.blob());
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = name;
  anchor.click();
}

/**
 * Downloads a file from the environment's machine to this device, the way the browser saves any
 * download. The server decides whether this connection may read the file.
 */
export function useDownloadHostFile(environmentId: EnvironmentId) {
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  return async (resource: AssetResource, name: string): Promise<void> => {
    const progress = toastManager.add({ type: "loading", title: `Preparing ${name}…` });
    const result = await settlePromise(async () => {
      const connection = readPreparedConnection(environmentId);
      if (!connection) throw new Error("Reconnect to this environment and try again.");
      const created = await createAssetUrl({ environmentId, input: { resource } });
      if (created._tag === "Failure") throw squashAtomCommandFailure(created);
      const url = resolveAssetUrl(connection.httpBaseUrl, created.value.relativeUrl);
      if (!url) throw new Error("The environment returned an invalid file address.");
      await saveToThisDevice(url, name);
    });
    if (AsyncResult.isSuccess(result)) {
      toastManager.update(progress, {
        type: "success",
        title: "Download started",
        description: name,
      });
      return;
    }
    const error = squashAtomCommandFailure(result);
    toastManager.update(
      progress,
      stackedThreadToast({
        type: "error",
        title: `Could not download ${name}`,
        description: error instanceof Error ? error.message : "The download failed.",
      }),
    );
  };
}
