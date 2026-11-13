# Whiteboard

Each thread has a whiteboard: an [Excalidraw](https://excalidraw.com) board that you and the thread's agent both draw on. Use it to work out an architecture, a flow, or a layout together instead of describing it in words.

Open it from the right panel's **+** menu (**Whiteboard**) or the command palette (**Open whiteboard**) once the thread has its first message. The board saves to the environment as you draw, so every window connected to it shows the same board.

Click the board and the keyboard is Excalidraw's: `R` draws a rectangle, `A` an arrow, and Cmd/Ctrl with `D`, `K`, or `Z` duplicates a shape, adds a link, or undoes a stroke. A T3 Code shortcut on the same keys, such as the command palette on Cmd/Ctrl+`K`, the diff on Cmd/Ctrl+`D`, or thread find on Cmd/Ctrl+`F`, works again once you click outside the board. Shortcuts Excalidraw has no use for, such as the sidebar or the terminal, work from the board as usual, and F6 moves the keyboard out of it.

To move around, drag with the right mouse button; Space-drag, the middle button, and two-finger scrolling work as well. A right click without dragging opens Excalidraw's menu.

Ask the agent to draw ("sketch on the whiteboard how a request reaches the worker") and its shapes appear as it works. If the tab is closed, it opens. When you change the board, the agent is told what you added, changed, and removed along with your next message, so "what about the box I just added?" needs no explanation.

## Shared boards

A thread's Whiteboard tab starts on that thread's own board. The menu at the top of the tab switches it to a shared board, which every thread on the same T3 Code server can open: use one to keep a drawing across threads, or several to keep drawings apart.

- **New shared board** starts an empty one, and **Copy this board to a shared board** saves the board you are looking at under a name. Either way the tab moves to the new board.
- A shared board is one board wherever it is open. A change made in one thread shows in every other thread and window on it, and so does a rename or a delete. Deleting a board returns the threads that showed it to their own.
- Agents work on the board their thread's tab shows. Ask for another by name ("add this to the Architecture board", "sketch it on a new board called Rollout") and the agent draws there; the tab follows it, so you see the drawing.
- An agent hears about changes to a shared board only while its thread's tab shows that board. Those changes can be yours or another thread's agent's.

To bring in a drawing saved with **Save to…**, drop the file on the board. Its shapes are added to what is already there.

An agent reads shapes, text, and arrows as data. Freehand strokes and pasted images it can only see in a picture, which an open Whiteboard tab draws for it, so keep the tab open when you want the agent to look at a sketch.

## Limits

- The note about your changes reaches Claude and Codex agents. Agents on other providers see your changes when they read the board, so ask them to look.
- An image over 4 MB stays on the device where you pasted it.
- Forks and side chats are threads of their own, each with its own board. Shared boards are open to them as to any thread.
- Undo history, zoom, and the pen survive switching tabs or boards, closing the panel, and visiting other threads. They start over when you reload the app, and for the board you used longest ago once you have had more than five open; the drawing itself is always saved.
- A thread that used the whiteboard before shared boards existed may not know it can name a board. Tell it to read the whiteboard again, or use a new thread.
- On macOS, Excalidraw's Cmd+Option+`[` and `]` for sending a shape to the back or front do nothing in this Excalidraw version. Use the right-click menu or the Layers buttons.
- Mobile has no Whiteboard tab yet. Agents can still read and draw on the board from a thread you run on mobile.
