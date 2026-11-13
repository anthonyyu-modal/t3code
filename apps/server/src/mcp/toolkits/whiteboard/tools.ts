import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Whiteboards from "../../../whiteboard/Whiteboards.ts";
import { WHITEBOARD_ADD_TYPES } from "../../../whiteboard/whiteboardScene.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Whiteboards.Whiteboards,
  ],
};

const Point = Schema.Tuple([Schema.Number, Schema.Number]);

const Style = {
  strokeColor: Schema.optional(Schema.String),
  backgroundColor: Schema.optional(Schema.String),
  strokeStyle: Schema.optional(Schema.Literals(["solid", "dashed", "dotted"])),
  fontSize: Schema.optional(Schema.Number),
};

const Box = {
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
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
  strokeStyle: Schema.optional(Schema.String),
});

const WhiteboardReadTool = Tool.make("whiteboard_read", {
  ...shared,
  failureMode: "return",
  description:
    "Read this thread's whiteboard, an Excalidraw board in the user's right panel that you both draw on. Returns every element (id, type, box, text, arrow ends) and what the user changed since you last looked. Freehand strokes and images are only listed; whiteboard_view shows them.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    revision: Schema.Int,
    elements: Schema.Array(ElementView),
    userChanges: Schema.NullOr(
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
  .annotate(Tool.OpenWorld, false);

// The board belongs to the thread, not the workspace, so read-only sandboxes and plan mode may draw.
const WhiteboardEditTool = Tool.make("whiteboard_edit", {
  ...shared,
  failureMode: "return",
  description:
    "Draw on this thread's whiteboard. The user sees it at once and their Whiteboard tab opens. One call may clear, remove, update and add, in that order; if any part is invalid nothing changes. Units are canvas pixels with y downward. Leave 80 between shapes, and 220 where a labelled arrow runs between them. Call whiteboard_read first and build around what the user drew.",
  parameters: Schema.Struct({
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
              description: "A text element's content, or the centred label of a shape or arrow.",
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
          description: "Shapes and text need x and y. A label wraps inside its shape's width.",
        }),
      ),
    ),
  }),
  success: Schema.Struct({
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
  .annotate(Tool.OpenWorld, false);

export const WhiteboardViewTool = Tool.make("whiteboard_view", {
  ...shared,
  description:
    "See this thread's whiteboard as a PNG, as the user sees it, including freehand strokes and pasted images. Needs the user's Whiteboard tab to be open.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
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
  .annotate(Tool.OpenWorld, false);

export const WhiteboardDataToolkit = Toolkit.make(WhiteboardReadTool, WhiteboardEditTool);

export const WhiteboardViewToolkit = Toolkit.make(WhiteboardViewTool);

export const WhiteboardToolkit = Toolkit.make(
  WhiteboardReadTool,
  WhiteboardEditTool,
  WhiteboardViewTool,
);
