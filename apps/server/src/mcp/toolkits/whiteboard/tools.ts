import { OrchestratorMcpFailure, WhiteboardEngine } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WhiteboardPictures from "../../../whiteboard/WhiteboardPictures.ts";
import * as Whiteboards from "../../../whiteboard/Whiteboards.ts";
import {
  WHITEBOARD_ADD_TYPES,
  WHITEBOARD_ARROWHEADS,
  WHITEBOARD_FILL_STYLES,
  WHITEBOARD_FONT_FAMILIES,
  WHITEBOARD_ROUGHNESS,
  WHITEBOARD_ROUNDNESS,
  WHITEBOARD_STROKE_STYLES,
  WHITEBOARD_TEXT_ALIGNS,
  WHITEBOARD_VERTICAL_ALIGNS,
} from "../../../whiteboard/whiteboardScene.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Whiteboards.Whiteboards,
  ],
};

const Point = Schema.Tuple([Schema.Finite, Schema.Finite]);
const Arrowhead = Schema.Literals(WHITEBOARD_ARROWHEADS);

const Style = {
  strokeColor: Schema.optional(Schema.String),
  backgroundColor: Schema.optional(Schema.String),
  fillStyle: Schema.optional(Schema.Literals(WHITEBOARD_FILL_STYLES)),
  strokeWidth: Schema.optional(Schema.Finite),
  strokeStyle: Schema.optional(Schema.Literals(WHITEBOARD_STROKE_STYLES)),
  roughness: Schema.optional(Schema.Literals(WHITEBOARD_ROUGHNESS)),
  roundness: Schema.optional(Schema.Literals(WHITEBOARD_ROUNDNESS)),
  opacity: Schema.optional(Schema.Finite),
  group: Schema.optional(Schema.String),
  textColor: Schema.optional(Schema.String),
  fontSize: Schema.optional(Schema.Finite),
  fontFamily: Schema.optional(Schema.Literals(WHITEBOARD_FONT_FAMILIES)),
  textAlign: Schema.optional(Schema.Literals(WHITEBOARD_TEXT_ALIGNS)),
  verticalAlign: Schema.optional(Schema.Literals(WHITEBOARD_VERTICAL_ALIGNS)),
  startArrowhead: Schema.optional(Arrowhead),
  endArrowhead: Schema.optional(Arrowhead),
};

const Box = {
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  width: Schema.optional(Schema.Finite),
  height: Schema.optional(Schema.Finite),
};

const ElementView = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  text: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  start: Schema.optional(Point),
  end: Schema.optional(Point),
  strokeColor: Schema.optional(Schema.String),
  backgroundColor: Schema.optional(Schema.String),
  fillStyle: Schema.optional(Schema.String),
  strokeWidth: Schema.optional(Schema.Number),
  strokeStyle: Schema.optional(Schema.String),
  roughness: Schema.optional(Schema.Number),
  roundness: Schema.optional(Schema.String),
  opacity: Schema.optional(Schema.Number),
  group: Schema.optional(Schema.String),
  textColor: Schema.optional(Schema.String),
  fontSize: Schema.optional(Schema.Number),
  fontFamily: Schema.optional(Schema.String),
  textAlign: Schema.optional(Schema.String),
  verticalAlign: Schema.optional(Schema.String),
  startArrowhead: Schema.optional(Schema.String),
  endArrowhead: Schema.optional(Schema.String),
});

// Every tool acts on the board the thread's Whiteboard tab shows, unless the agent names another.
const Board = {
  board: Schema.optional(
    Schema.String.annotate({
      description:
        "A name from whiteboard_read's boards. Omit for the board this thread's tab shows.",
    }),
  ),
};

const WhiteboardReadTool = Tool.make("whiteboard_read", {
  ...shared,
  failureMode: "return",
  description:
    "Read the whiteboard in the user's right panel that you both draw on. Boards use Excalidraw or tldraw; engine says which. Returns every element (id, type, box, text, arrow ends) and what changed since you last looked. Freehand strokes and images are only listed; whiteboard_view shows them. boards names every board; all threads share them. board is null while this thread's tab shows none.",
  parameters: Schema.Struct(Board),
  success: Schema.Struct({
    board: Schema.NullOr(Schema.String),
    engine: Schema.NullOr(WhiteboardEngine),
    boards: Schema.Array(Schema.String),
    revision: Schema.Int,
    elements: Schema.Array(ElementView),
    changes: Schema.NullOr(
      Schema.Struct({
        added: Schema.Array(Schema.String),
        changed: Schema.Array(Schema.String),
        removed: Schema.Array(Schema.String),
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Read whiteboard")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  // Each acts as the calling thread, so only T3's own agents are offered it.
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

// A board is no part of the workspace, so read-only sandboxes and plan mode may draw.
const WhiteboardEditTool = Tool.make("whiteboard_edit", {
  ...shared,
  failureMode: "return",
  description:
    "Draw on the whiteboard. The user sees it at once: their Whiteboard tab opens and shows the board you drew on. One call may clear, remove, update and add, in that order; if any part is invalid nothing changes. Units are canvas pixels with y downward. Leave 80 between shapes, and 220 where a labelled arrow runs between them. Call whiteboard_read first and build around what is there. While this thread's tab shows no board, pass newBoard; new boards use tldraw. Existing boards keep their engine. Defaults: strokeWidth 2 (1 thin, 4 thick), roughness 1 (0 crisp, 2 rough), opacity 100 (0-100). textColor colours a shape's label; group joins elements to drag together (empty ungroups on update). On tldraw boards, colours use the nearest native palette colour, sharp arrows become native elbow arrows, and rich text added later by the user is preserved unless you replace text.",
  parameters: Schema.Struct({
    ...Board,
    newBoard: Schema.optional(
      Schema.String.annotate({
        description:
          "Instead of board: start a board with this name, a few words for the drawing, and draw on it.",
      }),
    ),
    clear: Schema.optional(Schema.Boolean.annotate({ description: "Remove everything first." })),
    remove: Schema.optional(Schema.Array(Schema.String).annotate({ description: "Element ids." })),
    update: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          ...Box,
          text: Schema.optional(
            Schema.String.annotate({ description: "New text or label. Empty removes a label." }),
          ),
          ...Style,
        }),
      ),
    ),
    add: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.Literals(WHITEBOARD_ADD_TYPES),
          id: Schema.optional(
            Schema.String.annotate({ description: "Your own id, to use in from and to." }),
          ),
          ...Box,
          text: Schema.optional(
            Schema.String.annotate({
              description: "A text element's content, or the label of a shape or arrow.",
            }),
          ),
          from: Schema.optional(
            Schema.String.annotate({
              description:
                "Arrow or line: the element id it starts at. With to, the path is worked out and follows the shapes when they move.",
            }),
          ),
          to: Schema.optional(Schema.String),
          points: Schema.optional(
            Schema.Array(Point).annotate({
              description: "Arrow or line with free ends: absolute [x, y] points.",
            }),
          ),
          ...Style,
        }).annotate({
          description:
            "Shapes and text need x and y. Text with width wraps inside it; without width, textAlign anchors x.",
        }),
      ),
    ),
  }),
  success: Schema.Struct({
    board: Schema.String,
    revision: Schema.Int,
    addedIds: Schema.Array(Schema.String),
    layoutWarnings: Schema.Array(Schema.String),
    message: Schema.String,
  }),
})
  .annotate(Tool.Title, "Draw on whiteboard")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  // Each acts as the calling thread, so only T3's own agents are offered it.
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const WhiteboardViewTool = Tool.make("whiteboard_view", {
  ...shared,
  dependencies: [...shared.dependencies, WhiteboardPictures.WhiteboardPictures],
  description:
    "See the whiteboard as a PNG, as the user sees it, including freehand strokes and pasted images. Works whether or not a window has the board open.",
  parameters: Schema.Struct(Board),
  success: Schema.Struct({
    board: Schema.String,
    revision: Schema.Int,
    screenshot: Schema.Struct({
      mimeType: Schema.Literal("image/png"),
      data: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
    }),
  }),
})
  .annotate(Tool.Title, "View whiteboard")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  // Each acts as the calling thread, so only T3's own agents are offered it.
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const WhiteboardDataToolkit = Toolkit.make(WhiteboardReadTool, WhiteboardEditTool);

export const WhiteboardViewToolkit = Toolkit.make(WhiteboardViewTool);

export const WhiteboardToolkit = Toolkit.make(
  WhiteboardReadTool,
  WhiteboardEditTool,
  WhiteboardViewTool,
);
