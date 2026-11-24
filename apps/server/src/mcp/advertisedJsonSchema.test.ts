import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";

import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import { ThemeToolkit } from "./toolkits/theme/tools.ts";
import { WhiteboardToolkit } from "./toolkits/whiteboard/tools.ts";

const decodeWhiteboardEditInput = Schema.decodeUnknownSync(
  WhiteboardToolkit.tools.whiteboard_edit.parametersSchema,
);

it("drops JSON noise, merges tagged unions, and keeps null where it is required", () => {
  const Every = Schema.Struct({ ms: Schema.Int });
  const tool = Tool.make("example", {
    parameters: Schema.Struct({
      threadId: Schema.optional(Schema.NullOr(Schema.String)),
      beforeRunId: Schema.NullOr(Schema.String),
      limit: Schema.optional(Schema.Int),
      every: Schema.Union([Every, Schema.fromJsonString(Every)]),
      target: Schema.optional(
        Schema.NullOr(
          Schema.Union([
            Schema.Struct({ kind: Schema.Literal("url"), url: Schema.String }),
            Schema.Struct({ kind: Schema.Literal("number"), number: Schema.Int }),
          ]),
        ),
      ),
    }),
  });

  expect(advertisedJsonSchema(tool)).toEqual({
    type: "object",
    properties: {
      threadId: { type: "string" },
      beforeRunId: { anyOf: [{ type: "string" }, { type: "null" }] },
      limit: { type: "integer" },
      every: { type: "object", properties: { ms: { type: "integer" } }, required: ["ms"] },
      target: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["url", "number"] },
          url: { type: "string" },
          number: { type: "integer" },
        },
        required: ["kind"],
      },
    },
    required: ["beforeRunId", "every"],
  });
});

it("advertises only string enum values, which Gemini requires", () => {
  const enumValues: Array<unknown> = [];
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" && Array.isArray(value)) enumValues.push(...value);
      else collect(value);
    }
  };
  collect(advertisedJsonSchema(ThemeToolkit.tools.t3_theme_set));

  expect(enumValues.filter((value) => typeof value !== "string")).toEqual([]);
});

it("strips JSON-string fallbacks from delegate_task, create_threads, and whiteboard_edit while decoding them", () => {
  const delegateSchema = advertisedJsonSchema(OrchestratorToolkit.tools.delegate_task) as {
    properties: { target: { properties: { options: { anyOf?: Array<{ type?: string }> } } } };
  };
  const optionTypes = delegateSchema.properties.target.properties.options.anyOf?.map(
    (branch) => branch.type,
  );
  expect(optionTypes).toEqual(["array", "object"]);

  const whiteboardSchema = advertisedJsonSchema(WhiteboardToolkit.tools.whiteboard_edit) as {
    properties: {
      add: { items: { properties: { points: { type?: string; anyOf?: unknown } } } };
    };
  };
  expect(whiteboardSchema.properties.add.items.properties.points.type).toBe("array");
  expect(whiteboardSchema.properties.add.items.properties.points.anyOf).toBeUndefined();

  const decodedEdit = decodeWhiteboardEditInput({
    add: [{ type: "arrow", points: "[[0,0],[120,80]]" }],
  });
  expect(decodedEdit.add?.[0]?.points).toEqual([
    [0, 0],
    [120, 80],
  ]);
});
