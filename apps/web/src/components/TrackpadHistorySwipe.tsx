import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { isElectron } from "../env";
import { isMacPlatform } from "../lib/utils";
import {
  createHistorySwipeTracker,
  HISTORY_SWIPE_IDLE_END_MS,
  type HistorySwipeDirection,
  type HistorySwipeProgress,
} from "../trackpadHistorySwipe";
import { useTrackpadSwipeEnabled } from "./settings/TrackpadSwipeSettings";

// Chrome navigates on overscroll: a swipe over a code block, diff, tab strip,
// or text field scrolls it until it reaches that edge.
function canScrollToward(target: EventTarget | null, direction: HistorySwipeDirection) {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      const { overflowX } = getComputedStyle(element);
      const room =
        direction === "back"
          ? element.scrollLeft
          : element.scrollWidth - element.clientWidth - element.scrollLeft;
      if ((field || overflowX === "auto" || overflowX === "scroll") && room > 1) return true;
    }
    element = element.parentElement;
  }
  return false;
}

// The arrow starts just off the window edge and slides in as the swipe grows.
const HIDDEN_OFFSET_PX = -48;
const SHOWN_OFFSET_PX = 20;
const SETTLE_TRANSITION = "opacity 180ms ease-out, transform 180ms ease-out";
const COLOR_TRANSITION = "background-color 120ms, border-color 120ms, color 120ms";

function paintArrow(arrow: HTMLElement, swipe: HistorySwipeProgress) {
  const shown = Math.min(swipe.progress, 1);
  const offset = HIDDEN_OFFSET_PX + shown * (SHOWN_OFFSET_PX - HIDDEN_OFFSET_PX);
  const back = swipe.direction === "back";
  arrow.dataset.direction = swipe.direction;
  arrow.dataset.active = String(swipe.progress >= 1);
  arrow.style.left = back ? "0" : "auto";
  arrow.style.right = back ? "auto" : "0";
  arrow.style.transform = `translate(${back ? offset : -offset}px, -50%)`;
  arrow.style.opacity = String(Math.min(1, shown * 2));
}

/**
 * Two-finger trackpad swipes move through route history like ⌘[ and ⌘]
 * (macOS desktop), with Chrome's arrow following the swipe.
 */
export function TrackpadHistorySwipe() {
  const [enabled] = useTrackpadSwipeEnabled();
  const active = enabled && isElectron && isMacPlatform(navigator.platform);
  const arrowRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Listens to window wheel and gesture-end events and drives the arrow's DOM while swipes are on.
  useEffect(() => {
    if (!active) return;
    const tracker = createHistorySwipeTracker();
    let latest: HistorySwipeProgress | null = null;
    let frame: number | null = null;
    let idle: ReturnType<typeof setTimeout> | null = null;

    // A committed arrow fades where it is; a cancelled one slides back out.
    const settle = (committed: boolean) => {
      const arrow = arrowRef.current;
      if (arrow && latest) {
        arrow.style.transition = `${SETTLE_TRANSITION}, ${COLOR_TRANSITION}`;
        if (committed) arrow.style.opacity = "0";
        else paintArrow(arrow, { ...latest, progress: 0 });
      }
      latest = null;
    };

    const finish = () => {
      if (idle !== null) clearTimeout(idle);
      idle = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const target = tracker.end();
      settle(target !== null);
      if (target === "back") window.history.back();
      else if (target === "forward") window.history.forward();
    };

    const onWheel = (event: WheelEvent) => {
      const swipe = tracker.wheel(
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
        (direction) => !canScrollToward(event.target, direction),
      );
      if (idle !== null) clearTimeout(idle);
      idle = setTimeout(finish, HISTORY_SWIPE_IDLE_END_MS);
      if (!swipe) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        settle(false);
        return;
      }
      if (latest === null && arrowRef.current) arrowRef.current.style.transition = COLOR_TRANSITION;
      latest = swipe;
      frame ??= requestAnimationFrame(() => {
        frame = null;
        if (arrowRef.current && latest) paintArrow(arrowRef.current, latest);
      });
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    const stopScrollEnd = window.desktopBridge?.onTrackpadScrollEnd?.(finish);
    return () => {
      window.removeEventListener("wheel", onWheel);
      stopScrollEnd?.();
      if (idle !== null) clearTimeout(idle);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active]);

  if (!active) return null;
  return createPortal(
    <div
      ref={arrowRef}
      aria-hidden
      data-direction="back"
      data-active="false"
      className="group/swipe pointer-events-none fixed top-1/2 z-50 flex size-11 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 shadow-lg data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
    >
      <ArrowLeftIcon className="size-5 group-data-[direction=forward]/swipe:hidden" />
      <ArrowRightIcon className="size-5 group-data-[direction=back]/swipe:hidden" />
    </div>,
    document.body,
  );
}
