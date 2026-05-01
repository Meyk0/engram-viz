import { describe, expect, it } from "vitest";
import {
  formatMemoryEvalReport,
  memoryConsolidationEvalFixtures,
  memoryConversationEvalFixtures,
  memoryRetrievalEvalFixtures,
  runConsolidationEvalFixture,
  runConversationEvalFixture,
  runMemoryEvalReport,
  runRetrievalEvalFixture
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

  memoryRetrievalEvalFixtures.forEach((fixture) => {
    it(fixture.name, () => {
      const result = runRetrievalEvalFixture(fixture);

      expect(result.failures, result.failures.join("\n")).toEqual([]);
    });
  });

  it("produces a green report", () => {
    const report = runMemoryEvalReport();

    expect(report.failed, formatMemoryEvalReport(report)).toBe(0);
    expect(report.total).toBe(
      memoryConversationEvalFixtures.length +
        memoryRetrievalEvalFixtures.length +
        memoryConsolidationEvalFixtures.length
    );
  });

  it("formats suite totals for quick CLI inspection", () => {
    const report = runMemoryEvalReport();
    const formatted = formatMemoryEvalReport(report);

    expect(formatted).toContain(`conversation: ${report.bySuite.conversation.passed}/${report.bySuite.conversation.total} passed`);
    expect(formatted).toContain(`retrieval: ${report.bySuite.retrieval.passed}/${report.bySuite.retrieval.total} passed`);
    expect(formatted).toContain(`consolidation: ${report.bySuite.consolidation.passed}/${report.bySuite.consolidation.total} passed`);
  });
});
