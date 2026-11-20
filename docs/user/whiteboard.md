# Whiteboard

A whiteboard is a [tldraw](https://tldraw.dev) or [Excalidraw](https://excalidraw.com) board that you and a thread's agent both draw on. Use it to work out an architecture, a flow, or a layout together instead of describing it in words. New boards use tldraw, including its rich text, frames, notes, elbow arrows, pages, and native import/export. Existing Excalidraw boards stay Excalidraw, so their drawings keep working. Boards belong to the T3 Code server, not to one thread: every thread can open every board.

Open the Whiteboard tab from the right panel's **+** menu (**Whiteboard**) or the command palette (**Open whiteboard**) once the thread has its first message. Until the thread has a board, the tab offers **New board**, which starts one named after the thread, and lists the boards you already have. A board saves to the environment as you draw, so every window connected to it shows the same board.

Click the board and the keyboard belongs to its editor: `R` draws a rectangle, `A` an arrow, and Cmd/Ctrl with `D`, `K`, or `Z` duplicates a shape, adds a link, or undoes a stroke. A T3 Code shortcut on the same keys, such as the command palette on Cmd/Ctrl+`K`, the diff on Cmd/Ctrl+`D`, or thread find on Cmd/Ctrl+`F`, works again once you click outside the board. Excalidraw still leaves shortcuts it does not use, such as the sidebar or terminal, to T3 Code; tldraw uses its full editing shortcut map. F6 always moves the keyboard out of the board.

To move around, drag with the right mouse button; Space-drag, the middle button, and two-finger scrolling work as well. On Excalidraw, a right click without dragging opens its menu. On tldraw, use the **Actions** menu for shape actions.

Ask the agent to draw ("sketch on the whiteboard how a request reaches the worker") and its shapes appear as it works. If the tab is closed, it opens, and if the thread has no board yet, the agent starts one. When you change the board, the agent is told what you added, changed, and removed along with your next message, so "what about the box I just added?" needs no explanation.

## Boards

The menu at the top of the tab names the board the thread shows and lists every board on the server. Pick one to switch the tab to it: use one board to keep a drawing across threads, or several to keep drawings apart.

- **New board** starts an empty tldraw board, and **Duplicate this board** copies the board you are looking at under a new name with the same editor. Either way the tab moves to the new board. **Rename** and **Delete** act on the board you are looking at.
- A board is one board wherever it is open. A change made in one thread shows in every other thread and window on it, and so does a rename or a delete. Deleting a board leaves the threads that showed it without one until they open or start another.
- Agents work on the board their thread's tab shows. Ask for another by name ("add this to the Architecture board", "sketch it on a new board called Rollout") and the agent draws there; the tab follows it, so you see the drawing.
- An agent hears about changes to a board only while its thread's tab shows that board. Those changes can be yours or another thread's agent's.

Boards drawn while each thread still kept one to itself are in the list too, each under its thread's title, and their threads still open on them.

To bring in an Excalidraw drawing saved with **Save to…**, drop the file on an Excalidraw board. Its shapes are added to what is already there. On a tldraw board, use tldraw's native file import/export menu.

An agent reads shapes, text, and arrows as data, including styles such as colours, alignment, fonts, stroke width, arrowheads, opacity, fill style, roughness, sharp corners, and groups, and can set or change all of them when drawing. On tldraw boards, custom colours map to the nearest native palette colour and sharp arrows become native elbow arrows; rich text formatting is preserved unless the agent replaces the text. Freehand strokes and pasted images it sees in a picture of the board. A window that has the board open draws that picture; when none has, the server draws it, so an agent can look at a sketch, or check its own drawing, while the app is closed.

## Limits

- Excalidraw 0.18.1 has no bold text weight; for heavier headings on an Excalidraw board use the `Lilita One` display font or a larger size. Tldraw boards support bold and other rich-text marks natively.
- The note about your changes reaches Claude and Codex agents. Agents on other providers see your changes when they read the board, so ask them to look.
- An image over 4 MB stays on the device where you pasted it.
- The server draws a board with the headless browser T3 Code installs for itself, the same one behind agents' browser tools. The first picture after an install or update can ask the agent to try again in a minute while that browser downloads. On a host where it cannot run, the agent is told what the host lacks, usually with a `t3 browser setup` command to run there, and gets a picture only while a window has the board open.
- A picture the server draws uses the server's fonts for emoji and for Chinese, Japanese, and Korean text. They can look different from your window, and come out as empty boxes on a server that has no such fonts.
- Forks and side chats are threads of their own: each starts without a board and can open any.
- Undo history, zoom, and the pen survive switching tabs or boards, closing the panel, and visiting other threads. They start over when you reload the app, and for the board you used longest ago once you have had more than five open; the drawing itself is always saved.
- A thread that used the whiteboard while each thread kept its own board may still ask for a board called "This thread". Tell it to read the whiteboard again, or use a new thread.
- On macOS, Excalidraw's Cmd+Option+`[` and `]` for sending a shape to the back or front do nothing in this Excalidraw version. Use the right-click menu or the Layers buttons.
- Mobile has no Whiteboard tab yet. Agents can still read and draw on the board from a thread you run on mobile.
