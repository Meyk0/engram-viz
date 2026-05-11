import { describe, expect, it } from "vitest";
import {
  formatMemoryEvalReport,
  memoryConsolidationEvalFixtures,
  memoryConversationEvalFixtures,
  memoryDreamEvalFixtures,
  memoryRetrievalEvalFixtures,
  memoryScenarioEvalFixtures,
  runConsolidationEvalFixture,
  runConversationEvalFixture,
  runDreamEvalFixture,
  runMemoryEvalReport,
  runMemoryScenarioEvalFixture,
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

  memoryScenarioEvalFixtures.forEach((fixture) => {
    it(fixture.name, () => {
      const result = runMemoryScenarioEvalFixture(fixture);

      expect(result.failures, result.failures.join("\n")).toEqual([]);
    });
  });

  memoryDreamEvalFixtures.forEach((fixture) => {
    it(fixture.name, () => {
      const result = runDreamEvalFixture(fixture);

      expect(result.failures, result.failures.join("\n")).toEqual([]);
    });
  });

  it("produces a green report", () => {
    const report = runMemoryEvalReport();

    expect(report.failed, formatMemoryEvalReport(report)).toBe(0);
    expect(report.total).toBe(
      memoryConversationEvalFixtures.length +
        memoryRetrievalEvalFixtures.length +
        memoryConsolidationEvalFixtures.length +
        memoryScenarioEvalFixtures.length +
        memoryDreamEvalFixtures.length
    );
  });

  it("formats suite totals for quick CLI inspection", () => {
    const report = runMemoryEvalReport();
    const formatted = formatMemoryEvalReport(report);

    expect(formatted).toContain(`conversation: ${report.bySuite.conversation.passed}/${report.bySuite.conversation.total} passed`);
    expect(formatted).toContain(`retrieval: ${report.bySuite.retrieval.passed}/${report.bySuite.retrieval.total} passed`);
    expect(formatted).toContain(`consolidation: ${report.bySuite.consolidation.passed}/${report.bySuite.consolidation.total} passed`);
    expect(formatted).toContain(`scenario: ${report.bySuite.scenario.passed}/${report.bySuite.scenario.total} passed`);
    expect(formatted).toContain(`dream: ${report.bySuite.dream.passed}/${report.bySuite.dream.total} passed`);
  });
});
