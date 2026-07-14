import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEngramLexicalRegressionExecutor } from "@/lib/regressions/engram-executor";
import {
  parseMemoryRegressionArtifact,
  runMemoryRegressionArtifact
} from "@/lib/regressions";

const regressionDirectory = path.join(process.cwd(), "regressions");
const filenames = (await readdir(regressionDirectory))
  .filter((name) => name.endsWith(".engram-test.json"))
  .sort();

describe("portable memory regressions", () => {
  it("contains at least one checked-in regression", () => {
    expect(filenames.length).toBeGreaterThan(0);
  });

  for (const filename of filenames) {
    it(filename, async () => {
      const serialized = await readFile(path.join(regressionDirectory, filename), "utf8");
      const artifact = parseMemoryRegressionArtifact(serialized);
      const report = await runMemoryRegressionArtifact(
        artifact,
        createEngramLexicalRegressionExecutor({
          limit: artifact.assertions.retrieval.maxLoaded ?? 5
        })
      );

      expect(report.pass, report.findings
        .filter((finding) => !finding.pass)
        .map((finding) => finding.message)
        .join("\n")).toBe(true);
    });
  }
});
