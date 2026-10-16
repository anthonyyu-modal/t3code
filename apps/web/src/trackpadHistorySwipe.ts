// Fork: macOS browsers go back and forward on a two-finger horizontal swipe.
// Electron does not (its BrowserWindow "swipe" event only fires for
// three-finger swipes), so the desktop app reads the swipe from the trackpad's
// wheel events instead.

export type HistorySwipeDirection = "back" | "forward";

export interface HistorySwipeWheel {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly timeStamp: number;
  /** Something else handled this event, or it is not a plain trackpad scroll. */
  readonly blocked: boolean;
}

/** A pause this long ends a gesture. Momentum events keep it alive after the fingers lift. */
export const HISTORY_SWIPE_GESTURE_GAP_MS = 200;
/** Travel before a gesture commits to an axis, so a vertical scroll that drifts sideways stays a scroll. */
export const HISTORY_SWIPE_AXIS_PX = 12;
/** Horizontal travel that navigates. */
export const HISTORY_SWIPE_NAVIGATE_PX = 160;

/**
 * Turns a stream of wheel events into at most one navigation per gesture.
 * `canStart` runs once at the start of each gesture: a gesture that begins
 * over something that scrolls sideways belongs to that element.
 */
export function createHistorySwipeTracker() {
  let gesture: {
    phase: "pending" | "horizontal" | "ignored" | "done";
    x: number;
    y: number;
    lastTimeStamp: number;
  } | null = null;

  return (wheel: HistorySwipeWheel, canStart: () => boolean): HistorySwipeDirection | null => {
    if (
      gesture === null ||
      wheel.timeStamp - gesture.lastTimeStamp > HISTORY_SWIPE_GESTURE_GAP_MS
    ) {
      gesture = {
        phase: !wheel.blocked && canStart() ? "pending" : "ignored",
        x: 0,
        y: 0,
        lastTimeStamp: wheel.timeStamp,
      };
    }
    gesture.lastTimeStamp = wheel.timeStamp;
    if (wheel.blocked) gesture.phase = "ignored";
    if (gesture.phase === "ignored" || gesture.phase === "done") return null;

    gesture.x += wheel.deltaX;
    gesture.y += wheel.deltaY;
    if (gesture.phase === "pending") {
      if (Math.abs(gesture.x) + Math.abs(gesture.y) < HISTORY_SWIPE_AXIS_PX) return null;
      gesture.phase = Math.abs(gesture.x) > 2 * Math.abs(gesture.y) ? "horizontal" : "ignored";
      if (gesture.phase === "ignored") return null;
    }
    if (Math.abs(gesture.x) < HISTORY_SWIPE_NAVIGATE_PX) return null;
    gesture.phase = "done";
    // Like a browser's overscroll: scrolling further left than the page goes is back.
    return gesture.x < 0 ? "back" : "forward";
  };
}
