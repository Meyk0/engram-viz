import { describe, expect, it } from "vitest";
import {
  memoryConsolidationEvalFixtures,
  memoryConversationEvalFixtures,
  runConsolidationEvalFixture,
  runConversationEvalFixture
} from "@/lib/memory/evals";

describe("memory eval fixtures", () => {
  memoryConversationEvalFixtures.forEach((fixture) => {
    it(fixture.name, () => {
      const result = runConversationEvalFixture(fixture);

      expect(result.failures, result.failures.join("\n")).toEqual([]);
    });
  });

  memoryConsolidationEvalFixtures.forEach((fixture) => {
    it(fixture.name, () => {
      const result = runConsolidationEvalFixture(fixture);

      expect(result.failures, result.failures.join("\n")).toEqual([]);
    });
  });
});
