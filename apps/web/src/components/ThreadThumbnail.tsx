import { useEffect, useSyncExternalStore } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import {
  getThreadThumbnail,
  subscribeThreadThumbnails,
  THREAD_THUMBNAIL_CONFIG_KEY,
  wantThreadThumbnail,
} from "../threadThumbnails";
import {
  DEFAULT_THREAD_THUMBNAIL_CONFIG,
  isThumbnailableTitle,
  ThreadThumbnailConfig,
} from "../threadThumbnails.logic";

/** Image endpoint settings for thread thumbnails. Kept on this device. */
export function useThreadThumbnailConfig() {
  return useLocalStorage(
    THREAD_THUMBNAIL_CONFIG_KEY,
    DEFAULT_THREAD_THUMBNAIL_CONFIG,
    ThreadThumbnailConfig,
  );
}

/**
 * The thread's generated picture, pinned to the left of its sidebar card. The
 * card makes room for it with `has-[[data-thread-thumbnail]]`, so it takes no
 * space while thumbnails are off.
 */
export function ThreadThumbnail(props: { environmentId: string; threadId: string; title: string }) {
  const [config] = useThreadThumbnailConfig();
  const threadKey = `${props.environmentId}:${props.threadId}`;
  const thumbnail = useSyncExternalStore(subscribeThreadThumbnails, () =>
    getThreadThumbnail(threadKey),
  );

  const active = config.enabled && config.endpoint !== "";

  useEffect(() => {
    if (!active || !isThumbnailableTitle(props.title)) return;
    return wantThreadThumbnail(threadKey, props.title);
  }, [active, threadKey, props.title]);

  if (!active) return null;
  return (
    <span
      data-thread-thumbnail
      aria-hidden
      className="absolute top-1/2 left-(--sidebar-row-content-inset) size-12 -translate-y-1/2 overflow-hidden rounded-md bg-sidebar-border/40"
    >
      {thumbnail ? (
        <img src={thumbnail.dataUrl} alt="" draggable={false} className="size-full" />
      ) : null}
    </span>
  );
}
