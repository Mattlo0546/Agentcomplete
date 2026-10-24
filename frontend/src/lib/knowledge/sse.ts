export type SseMessage = { event: string; data: string };

/**
 * Incremental parser for `text/event-stream` (WHATWG SSE framing). Chunks may split anywhere,
 * including inside a CRLF pair. Comments and unknown fields are ignored.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let lastWasCr = false;

  const dispatch = () => {
    if (data.length > 0) onMessage({ event, data: data.join("\n") });
    event = "message";
    data = [];
  };

  const handleLine = (line: string) => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  return {
    push(chunk: string) {
      if (lastWasCr && chunk.startsWith("\n")) chunk = chunk.slice(1);
      if (chunk === "") return;
      lastWasCr = chunk.endsWith("\r");
      const lines = (buffer + chunk).split(/\r\n|\n|\r/);
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    },
    /** Flush a trailing, unterminated message when the stream ends. */
    flush() {
      if (buffer !== "") handleLine(buffer);
      buffer = "";
      dispatch();
    },
  };
}

/** Reads an SSE response body (a POST can't use EventSource) and yields each message. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: SseMessage[] = [];
  const parser = createSseParser((message) => queue.push(message));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      while (queue.length) yield queue.shift()!;
    }
    parser.push(decoder.decode());
    parser.flush();
    while (queue.length) yield queue.shift()!;
  } finally {
    reader.cancel().catch(() => {});
  }
}
