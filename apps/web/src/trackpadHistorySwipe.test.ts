import { describe, expect, it } from "vite-plus/test";

import {
  createHistorySwipeTracker,
  HISTORY_SWIPE_IDLE_END_MS,
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
  tracker: ReturnType<typeof createHistorySwipeTracker>,
  wheels: ReadonlyArray<HistorySwipeWheel>,
  canStart: () => boolean = () => true,
) {
  return wheels.map((wheel) => tracker.wheel(wheel, canStart));
}

const repeat = (count: number, delta: readonly [number, number]) =>
  Array.from({ length: count }, () => delta);

describe("createHistorySwipeTracker", () => {
  it("shows progress while swiping and goes back once the gesture ends past the threshold", () => {
    const tracker = createHistorySwipeTracker();
    const progress = run(tracker, swipe(repeat(10, [-20, 1])));
    expect(progress.at(0)).toEqual({ direction: "back", progress: 20 / 140 });
    expect(progress.at(-1)?.progress).toBeGreaterThan(1);
    expect(tracker.end()).toBe("back");
  });

  it("goes forward on a swipe the other way", () => {
    const tracker = createHistorySwipeTracker();
    run(tracker, swipe(repeat(10, [20, -1])));
    expect(tracker.end()).toBe("forward");
  });

  it("cancels a swipe that ends short of the threshold", () => {
    const tracker = createHistorySwipeTracker();
    run(tracker, swipe(repeat(5, [-20, 0])));
    expect(tracker.end()).toBeNull();
  });

  it("cancels a swipe pulled back below the threshold before it ends", () => {
    const tracker = createHistorySwipeTracker();
    const progress = run(tracker, swipe([...repeat(10, [-20, 0]), ...repeat(5, [20, 0])]));
    expect(progress.at(-1)?.progress).toBeLessThan(1);
    expect(tracker.end()).toBeNull();
  });

  it("leaves a vertical scroll that drifts sideways alone", () => {
    const tracker = createHistorySwipeTracker();
    expect(run(tracker, swipe(repeat(30, [-8, 30]))).every((progress) => progress === null)).toBe(
      true,
    );
    expect(tracker.end()).toBeNull();
  });

  it("leaves a swipe over something that can still scroll that way alone", () => {
    const tracker = createHistorySwipeTracker();
    run(tracker, swipe(repeat(10, [-20, 0])), () => false);
    expect(tracker.end()).toBeNull();
  });

  it("drops a swipe once another handler takes one of its events", () => {
    const tracker = createHistorySwipeTracker();
    run(
      tracker,
      swipe(repeat(10, [-20, 0]), 0, (index) => index === 3),
    );
    expect(tracker.end()).toBeNull();
  });

  it("starts a new gesture after a pause even without an end signal", () => {
    const tracker = createHistorySwipeTracker();
    const scroll = swipe(repeat(10, [0, 30]));
    const next = swipe(
      repeat(10, [-20, 0]),
      scroll.at(-1)!.timeStamp + HISTORY_SWIPE_IDLE_END_MS + 1,
    );
    run(tracker, [...scroll, ...next]);
    expect(tracker.end()).toBe("back");
  });
});
