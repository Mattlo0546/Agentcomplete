import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";

import { normalizeApiBase } from "../backend-url";
import { describeHealth, describeHealthError } from "../health";

describe("backend url", () => {
  it("accepts http(s) and strips trailing slashes", () => {
    expect(normalizeApiBase(" http://127.0.0.1:8000/ ")).toBe("http://127.0.0.1:8000");
    expect(normalizeApiBase("ftp://x")).toBeNull();
    expect(normalizeApiBase("not a url")).toBeNull();
  });
});

describe("health text", () => {
  it("formats healthy and degraded", () => {
    expect(describeHealth({ status: "ok", latency_ms: 23, db: "ok", gemini: "ok" })).toEqual({
      tone: "ok",
      text: "healthy · 23 ms · db ok · gemini ok",
    });
    expect(describeHealth({ status: "degraded", latency_ms: 9, db: "error", gemini: "unchecked" }).tone).toBe("warn");
  });
  it("formats errors", () => {
    expect(describeHealthError(new ApiError(0, "network_error", "Backend unreachable", null)).text).toBe(
      "Backend unreachable",
    );
    expect(describeHealthError(new ApiError(503, "x", "db down", null)).text).toBe("503 · db down");
  });
});
