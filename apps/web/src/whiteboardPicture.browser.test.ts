import { expect, it } from "vite-plus/test";

import { drawWhiteboard } from "./whiteboardPicture";

const rectangle = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  type: "rectangle",
  x,
  y,
  width,
  height,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
});

// The server calls this page with what it has stored and hands the result to the agent as is.
it("draws a stored board as a white PNG whose longest edge is 1568 px", async () => {
  expect(window).toHaveProperty("drawWhiteboard", drawWhiteboard);
  const small = await drawWhiteboard({ elements: [rectangle("a", 40, 40, 100, 50)], files: {} });
  // The shape plus 24 px of padding on every side, at full size.
  expect([small.mimeType, small.width, small.height]).toEqual(["image/png", 148, 98]);

  const wide = await drawWhiteboard({
    elements: [rectangle("a", 0, 0, 3952, 152), rectangle("b", 100, 20, 60, 60)],
    files: {},
  });
  expect([wide.width, wide.height]).toEqual([1568, 78]);
  const bitmap = await createImageBitmap(
    await (await fetch(`data:${wide.mimeType};base64,${wide.data}`)).blob(),
  );
  expect([bitmap.width, bitmap.height]).toEqual([1568, 78]);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  // The padding is white whatever theme the page runs in, and the shape's outline is not.
  expect([...context.getImageData(2, 2, 1, 1).data]).toEqual([255, 255, 255, 255]);
  const row = context.getImageData(0, 39, bitmap.width, 1).data;
  expect(row.some((channel, index) => index % 4 === 0 && channel < 128)).toBe(true);
});

it("draws native tldraw records on the same server picture page", async () => {
  const picture = await drawWhiteboard({
    engine: "tldraw",
    elements: [
      {
        id: "document:document",
        typeName: "document",
        gridSize: 10,
        name: "",
        meta: {},
        version: 1,
      },
      { id: "page:page", typeName: "page", name: "Page 1", index: "a1", meta: {}, version: 1 },
      {
        id: "shape:box",
        typeName: "shape",
        type: "geo",
        x: 40,
        y: 40,
        rotation: 0,
        index: "a1",
        parentId: "page:page",
        isLocked: false,
        opacity: 1,
        meta: {},
        version: 1,
        props: {
          w: 100,
          h: 50,
          geo: "rectangle",
          dash: "solid",
          growY: 0,
          url: "",
          scale: 1,
          flipX: false,
          flipY: false,
          color: "black",
          labelColor: "black",
          fill: "none",
          size: "m",
          font: "draw",
          align: "middle",
          verticalAlign: "middle",
          richText: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Native tldraw" }] }],
          },
        },
      },
    ],
    files: {},
  });
  expect(picture.mimeType).toBe("image/png");
  expect(picture.width).toBeGreaterThan(100);
  expect(picture.height).toBeGreaterThan(50);
  const bitmap = await createImageBitmap(
    await (await fetch(`data:${picture.mimeType};base64,${picture.data}`)).blob(),
  );
  expect([bitmap.width, bitmap.height]).toEqual([picture.width, picture.height]);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  const background = [...context.getImageData(2, 2, 1, 1).data];
  expect(background.every((channel) => channel >= 249)).toBe(true);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  expect(pixels.some((channel, index) => index % 4 === 0 && channel < 128)).toBe(true);
});
