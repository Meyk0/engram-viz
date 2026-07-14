import { describe, expect, it } from "vitest";
import { readBoundedJson, RequestBodyError } from "@/lib/http";

describe("readBoundedJson", () => {
  it("parses JSON within the byte limit", async () => {
    await expect(readBoundedJson(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ ok: true })
    }), 64)).resolves.toEqual({ ok: true });
  });

  it("checks actual UTF-8 bytes when content-length is absent", async () => {
    await expect(readBoundedJson(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ value: "éééé" })
    }), 8)).rejects.toMatchObject({ status: 413 } satisfies Partial<RequestBodyError>);
  });

  it("rejects invalid JSON with a typed 400 error", async () => {
    await expect(readBoundedJson(new Request("http://localhost", {
      method: "POST",
      body: "not-json"
    }), 64)).rejects.toMatchObject({ status: 400 } satisfies Partial<RequestBodyError>);
  });
});
