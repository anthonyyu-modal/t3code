import { useEffect } from "react";

import { isElectron } from "../env";
import { isMacPlatform } from "../lib/utils";
import { createHistorySwipeTracker } from "../trackpadHistorySwipe";
import { useTrackpadSwipeEnabled } from "./settings/TrackpadSwipeSettings";

// A gesture that starts over a sideways scroller (code blocks, diffs, tab
// strips, text fields) scrolls it instead of navigating.
function scrollsHorizontally(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      const { overflowX } = getComputedStyle(element);
      if (field || overflowX === "auto" || overflowX === "scroll") return true;
    }
    element = element.parentElement;
  }
  return false;
}

/** Two-finger trackpad swipes move through route history like ⌘[ and ⌘] (macOS desktop). */
export function TrackpadHistorySwipe() {
  const [enabled] = useTrackpadSwipeEnabled();

  useEffect(() => {
    if (!enabled || !isElectron || !isMacPlatform(navigator.platform)) return;
    const track = createHistorySwipeTracker();
    const onWheel = (event: WheelEvent) => {
      const direction = track(
        {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          timeStamp: event.timeStamp,
          // Pinch zoom arrives as ctrl+wheel and Shift turns a mouse wheel sideways.
          blocked:
            event.defaultPrevented ||
            event.ctrlKey ||
            event.shiftKey ||
            event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL,
        },
        () => !scrollsHorizontally(event.target),
      );
      if (direction === "back") window.history.back();
      else if (direction === "forward") window.history.forward();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [enabled]);

  return null;
}
