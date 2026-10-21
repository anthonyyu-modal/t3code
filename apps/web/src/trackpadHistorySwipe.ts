// Fork: macOS browsers go back and forward on a two-finger horizontal swipe.
// Electron does not (its BrowserWindow "swipe" event only fires for
// three-finger swipes), so the desktop app reads the swipe from the trackpad's
// wheel events instead, and shows Chrome's arrow while it does.

export type HistorySwipeDirection = "back" | "forward";

export interface HistorySwipeWheel {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly timeStamp: number;
  /** Something else handled this event, or it is not a plain trackpad scroll. */
  readonly blocked: boolean;
}

/** How far a swipe has gone; at 1 or more, ending it navigates. */
export interface HistorySwipeProgress {
  readonly direction: HistorySwipeDirection;
  readonly progress: number;
}

// Electron reports where a trackpad gesture ends (after any momentum), but a
// renderer without that signal still needs a boundary between gestures.
export const HISTORY_SWIPE_IDLE_END_MS = 250;
/** Travel before a gesture commits to an axis, so a vertical scroll that drifts sideways stays a scroll. */
const HISTORY_SWIPE_AXIS_PX = 10;
/** Horizontal travel that navigates once the gesture ends. */
const HISTORY_SWIPE_NAVIGATE_PX = 140;

/**
 * Follows one trackpad gesture at a time. `wheel` reports how far a sideways
 * swipe has gone, for the arrow; `end` says where to navigate, if the swipe
 * still reaches the threshold when the gesture ends. `canStart` runs once the
 * direction is known: a swipe over something that can still scroll that way
 * belongs to it.
 */
export function createHistorySwipeTracker() {
  let phase: "idle" | "pending" | "tracking" | "ignored" = "idle";
  let x = 0;
  let y = 0;
  let direction: HistorySwipeDirection = "back";
  let lastTimeStamp = Number.NEGATIVE_INFINITY;

  const travel = () => (direction === "back" ? -x : x);
  const reset = () => {
    phase = "idle";
    x = 0;
    y = 0;
  };

  return {
    wheel(
      wheel: HistorySwipeWheel,
      canStart: (direction: HistorySwipeDirection) => boolean,
    ): HistorySwipeProgress | null {
      if (wheel.timeStamp - lastTimeStamp > HISTORY_SWIPE_IDLE_END_MS) reset();
      lastTimeStamp = wheel.timeStamp;
      if (phase === "idle") phase = "pending";
      if (wheel.blocked) phase = "ignored";
      if (phase === "ignored") return null;

      x += wheel.deltaX;
      y += wheel.deltaY;
      if (phase === "pending") {
        if (Math.abs(x) + Math.abs(y) < HISTORY_SWIPE_AXIS_PX) return null;
        direction = x < 0 ? "back" : "forward";
        phase = Math.abs(x) > 1.5 * Math.abs(y) && canStart(direction) ? "tracking" : "ignored";
        if (phase === "ignored") return null;
      }
      // Like a browser's overscroll: scrolling further left than the page goes is back.
      return { direction, progress: Math.max(0, travel()) / HISTORY_SWIPE_NAVIGATE_PX };
    },
    end(): HistorySwipeDirection | null {
      const target =
        phase === "tracking" && travel() >= HISTORY_SWIPE_NAVIGATE_PX ? direction : null;
      reset();
      return target;
    },
  };
}
