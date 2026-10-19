import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadThumbnailPrompt,
  DEFAULT_THREAD_THUMBNAIL_PROMPT,
  isThumbnailableTitle,
  readThreadThumbnailJson,
  threadThumbnailRequestInit,
} from "./threadThumbnails.logic";

describe("buildThreadThumbnailPrompt", () => {
  it("puts the title where the template asks for it", () => {
    expect(buildThreadThumbnailPrompt("Icon for {title}, flat", "  Set up\n Slack  ")).toBe(
      "Icon for Set up Slack, flat",
    );
  });

  it("appends the title to a template without a placeholder", () => {
    expect(buildThreadThumbnailPrompt("Flat icon", "Plain inbox triage")).toBe(
      "Flat icon\n\nTask: Plain inbox triage",
    );
  });

  it("falls back to the default template when it is blank", () => {
    expect(buildThreadThumbnailPrompt("  ", "Deploy")).toBe(
      DEFAULT_THREAD_THUMBNAIL_PROMPT.replace("{title}", "Deploy"),
    );
  });
});

describe("isThumbnailableTitle", () => {
  it("skips threads that have no title yet", () => {
    expect(isThumbnailableTitle("New thread")).toBe(false);
    expect(isThumbnailableTitle("   ")).toBe(false);
    expect(isThumbnailableTitle("Create a Slack channel")).toBe(true);
  });
});

describe("threadThumbnailRequestInit", () => {
  it("sends a bearer token only when one is set", () => {
    const open = threadThumbnailRequestInit({ token: " " }, "p");
    const locked = threadThumbnailRequestInit({ token: "secret" }, "p");
    expect(open.headers).not.toHaveProperty("Authorization");
    expect(locked.headers).toHaveProperty("Authorization", "Bearer secret");
    expect(JSON.parse(String(locked.body))).toEqual({
      prompt: "p",
      n: 1,
      size: "512x512",
      response_format: "b64_json",
    });
  });
});

describe("readThreadThumbnailJson", () => {
  it("reads base64 and URL images from an OpenAI-style response", () => {
    expect(readThreadThumbnailJson({ data: [{ b64_json: "aGk=" }] })).toEqual({
      kind: "base64",
      data: "aGk=",
    });
    expect(readThreadThumbnailJson({ data: [{ url: "https://x/y.png" }] })).toEqual({
      kind: "url",
      url: "https://x/y.png",
    });
  });

  it("rejects responses without an image", () => {
    expect(readThreadThumbnailJson({ data: [] })).toBeNull();
    expect(readThreadThumbnailJson({ error: "nope" })).toBeNull();
    expect(readThreadThumbnailJson(null)).toBeNull();
  });
});
