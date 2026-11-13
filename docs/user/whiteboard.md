# Whiteboard

Each thread has a whiteboard: an [Excalidraw](https://excalidraw.com) board that you and the thread's agent both draw on. Use it to work out an architecture, a flow, or a layout together instead of describing it in words.

Open it from the right panel's **+** menu (**Whiteboard**) or the command palette (**Open whiteboard**) once the thread has its first message. The board saves to the environment as you draw, so every window connected to it shows the same board.

Click the board and the keyboard is Excalidraw's: `R` draws a rectangle, `A` an arrow, and Cmd/Ctrl with `D`, `K`, or `Z` duplicates a shape, adds a link, or undoes a stroke. A T3 Code shortcut on the same keys, such as the command palette on Cmd/Ctrl+`K`, the diff on Cmd/Ctrl+`D`, or thread find on Cmd/Ctrl+`F`, works again once you click outside the board. Shortcuts Excalidraw has no use for, such as the sidebar or the terminal, work from the board as usual, and F6 moves the keyboard out of it.

To move around, drag with the right mouse button; Space-drag, the middle button, and two-finger scrolling work as well. A right click without dragging opens Excalidraw's menu.

Ask the agent to draw ("sketch on the whiteboard how a request reaches the worker") and its shapes appear as it works. If the tab is closed, it opens. When you change the board, the agent is told what you added, changed, and removed along with your next message, so "what about the box I just added?" needs no explanation.

An agent reads shapes, text, and arrows as data. Freehand strokes and pasted images it can only see in a picture, which an open Whiteboard tab draws for it, so keep the tab open when you want the agent to look at a sketch.

## Limits

- The note about your changes reaches Claude and Codex agents. Agents on other providers see your changes when they read the board, so ask them to look.
- An image over 4 MB stays on the device where you pasted it.
- Forks and side chats are threads of their own, each with its own board.
- Switching to another tab keeps the board's view and pen, but its undo history starts over.
- On macOS, Excalidraw's Cmd+Option+`[` and `]` for sending a shape to the back or front do nothing in this Excalidraw version. Use the right-click menu or the Layers buttons.
- Mobile has no Whiteboard tab yet. Agents can still read and draw on the board from a thread you run on mobile.
