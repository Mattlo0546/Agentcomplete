import { describe, expect, it } from "vitest";

import { parseIngestMessage } from "../api";
import { createSseParser, readSse, type SseMessage } from "../sse";

function collect(chunks: string[]): SseMessage[] {
  const out: SseMessage[] = [];
  const parser = createSseParser((m) => out.push(m));
  chunks.forEach((c) => parser.push(c));
  parser.flush();
  return out;
}

describe("createSseParser", () => {
  it("parses event and data frames", () => {
    expect(collect(['event: step\ndata: {"step":"tag"}\n\n', 'event: done\ndata: {"a":1}\n\n'])).toEqual([
      { event: "step", data: '{"step":"tag"}' },
      { event: "done", data: '{"a":1}' },
    ]);
  });

  it("handles frames split across arbitrary chunks and CRLF", () => {
    const text = 'event: step\r\ndata: {"step":"embed"}\r\n\r\n';
    for (let i = 1; i < text.length; i++) {
      expect(collect([text.slice(0, i), text.slice(i)])).toEqual([{ event: "step", data: '{"step":"embed"}' }]);
    }
  });

  it("joins multi-line data, defaults event to message and skips comments", () => {
    expect(collect([": keep-alive\n\ndata: a\ndata: b\n\n"])).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("flushes a final unterminated frame", () => {
    expect(collect(["event: error\ndata: x"])).toEqual([{ event: "error", data: "x" }]);
  });
});

describe("readSse", () => {
  it("decodes a byte stream, including multi-byte characters split between chunks", async () => {
    const bytes = new TextEncoder().encode('event: step\ndata: "é"\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 22));
        controller.enqueue(bytes.slice(22));
        controller.close();
      },
    });
    const out: SseMessage[] = [];
    for await (const m of readSse(stream)) out.push(m);
    expect(out).toEqual([{ event: "step", data: '"é"' }]);
  });
});

describe("parseIngestMessage", () => {
  it("maps contract events and ignores unknown ones", () => {
    expect(parseIngestMessage({ event: "step", data: '{"step":"save","status":"done"}' })).toEqual({
      type: "step",
      step: "save",
    });
    expect(parseIngestMessage({ event: "error", data: '{"code":"upstream_error","message":"boom"}' })).toEqual({
      type: "error",
      code: "upstream_error",
      message: "boom",
    });
    expect(parseIngestMessage({ event: "step", data: '{"step":"nope"}' })).toBeNull();
    expect(parseIngestMessage({ event: "step", data: "not json" })).toBeNull();
  });
});
