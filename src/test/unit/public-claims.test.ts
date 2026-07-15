import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";

describe("public product claims", () => {
  it("describes observable memory operations without claiming hidden reasoning access", () => {
    const publicMetadata = JSON.stringify(metadata);

    expect(metadata.title).toBe("Engram - Memory reliability for AI agents");
    expect(publicMetadata).toContain("memory-dependent failures");
    expect(publicMetadata).not.toMatch(/see your ai think/i);
    expect(publicMetadata).not.toMatch(/hidden reasoning|chain.of.thought/i);
  });

  it("advertises only implemented chat providers in the environment template", () => {
    const environmentTemplate = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

    expect(environmentTemplate).toContain("Implemented providers: demo, openai.");
    expect(environmentTemplate).not.toMatch(/anthropic/i);
  });
});
