import {
  isMacPlatform,
  matchesKeybindingShortcut,
  parseKeybindingShortcut,
  type ShortcutEventLike,
} from "@t3tools/shared/keybindings";

// The modifier chords Excalidraw 0.18 acts on, from the key tests of its actions and its keydown
// handler. Check this list against them when the Excalidraw version changes.
const CHORDS = [
  "mod+a",
  "mod+c",
  "mod+x",
  "mod+v",
  "mod+shift+v",
  "mod+z",
  "mod+shift+z",
  "mod+d",
  "mod+g",
  "mod+shift+g",
  "mod+k",
  "mod+f",
  "mod+shift+l",
  "mod+shift+e",
  "mod+'",
  "mod+[",
  "mod+]",
  "mod+alt+c",
  "mod+alt+v",
  "mod+=",
  "mod+shift+=",
  "mod+-",
  "mod+0",
  "mod+shift+,",
  "mod+shift+.",
  "mod+arrowup",
  "mod+arrowdown",
  "mod+arrowleft",
  "mod+arrowright",
  "mod+shift+arrowup",
  "mod+shift+arrowdown",
  "mod+shift+arrowleft",
  "mod+shift+arrowright",
  "mod+enter",
  "mod+backspace",
  "mod+delete",
];
// Excalidraw moves a shape to the front or back with a different modifier on macOS.
const MAC_CHORDS = ["mod+alt+[", "mod+alt+]"];
const OTHER_CHORDS = ["mod+shift+[", "mod+shift+]"];

const compile = (chords: ReadonlyArray<string>) =>
  chords.flatMap((chord) => parseKeybindingShortcut(chord) ?? []);
const SHORTCUTS = compile(CHORDS);
const MAC_SHORTCUTS = compile(MAC_CHORDS);
const OTHER_SHORTCUTS = compile(OTHER_CHORDS);

export function isWhiteboardTarget(target: EventTarget | null | undefined): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest("[data-whiteboard-keys]") !== null
  );
}

/**
 * Whether a key pressed in the whiteboard is Excalidraw's to handle. T3's own shortcuts leave
 * these alone, so `mod+d` duplicates a shape there instead of opening the diff. Function keys stay
 * with T3, because F6 is how the keyboard leaves the board.
 */
export function isWhiteboardKey(
  event: ShortcutEventLike & { readonly target?: EventTarget | null },
  platform: string,
): boolean {
  if (!isWhiteboardTarget(event.target)) return false;
  if (!event.metaKey && !event.ctrlKey) return !/^f\d+$/i.test(event.key);
  const platformShortcuts = isMacPlatform(platform) ? MAC_SHORTCUTS : OTHER_SHORTCUTS;
  return [...SHORTCUTS, ...platformShortcuts].some((shortcut) =>
    matchesKeybindingShortcut(event, shortcut, platform),
  );
}
