import { describe, expect, it } from "vite-plus/test";

import {
  createHistorySwipeTracker,
  HISTORY_SWIPE_GESTURE_GAP_MS,
  type HistorySwipeWheel,
} from "./trackpadHistorySwipe";

// Trackpads report a swipe as a burst of small wheel events about a frame apart.
function swipe(
  deltas: ReadonlyArray<readonly [number, number]>,
  start = 0,
  blocked: (index: number) => boolean = () => false,
): HistorySwipeWheel[] {
  return deltas.map(([deltaX, deltaY], index) => ({
    deltaX,
    deltaY,
    timeStamp: start + index * 16,
    blocked: blocked(index),
  }));
}

function run(
  track: ReturnType<typeof createHistorySwipeTracker>,
  wheels: ReadonlyArray<HistorySwipeWheel>,
  canStart = () => true,
) {
  return wheels.map((wheel) => track(wheel, canStart)).filter((direction) => direction !== null);
}

const left = Array.from({ length: 12 }, () => [-20, 1] as const);
const right = Array.from({ length: 12 }, () => [20, -1] as const);

describe("createHistorySwipeTracker", () => {
  it("goes back once per swipe, ignoring the momentum that follows", () => {
    const momentum = Array.from({ length: 20 }, () => [-15, 0] as const);
    expect(run(createHistorySwipeTracker(), swipe([...left, ...momentum]))).toEqual(["back"]);
  });

  it("goes forward on a swipe the other way", () => {
    expect(run(createHistorySwipeTracker(), swipe(right))).toEqual(["forward"]);
  });

  it("navigates again after the gesture pauses", () => {
    const track = createHistorySwipeTracker();
    const first = swipe(left);
    const second = swipe(left, first.at(-1)!.timeStamp + HISTORY_SWIPE_GESTURE_GAP_MS + 1);
    expect(run(track, [...first, ...second])).toEqual(["back", "back"]);
  });

  it("leaves a vertical scroll that drifts sideways alone", () => {
    const scroll = Array.from({ length: 30 }, () => [-8, 30] as const);
    expect(run(createHistorySwipeTracker(), swipe(scroll))).toEqual([]);
  });

  it("leaves a swipe that starts over something that scrolls sideways alone", () => {
    expect(run(createHistorySwipeTracker(), swipe(left), () => false)).toEqual([]);
  });

  it("drops a swipe once another handler takes one of its events", () => {
    const wheels = swipe(left, 0, (index) => index === 3);
    expect(run(createHistorySwipeTracker(), wheels)).toEqual([]);
  });
});
