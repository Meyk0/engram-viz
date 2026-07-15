import { describe, expect, it } from "vitest";
import { answerSupportsExpectation, expectedAnswerFragments } from "@/lib/incidents/expectations";

describe("incident answer evidence", () => {
  it("accepts paraphrased answers that contain the meaningful expected evidence", () => {
    expect(answerSupportsExpectation(
      "Based on the retrieved memory: User lives in Oakland now.",
      "You live in Oakland."
    )).toBe(true);
    expect(expectedAnswerFragments("You live in Oakland.")).toEqual(["live", "Oakland"]);
  });

  it("rejects answers missing a meaningful fragment", () => {
    expect(answerSupportsExpectation("You previously lived in San Francisco.", "You live in Oakland.")).toBe(false);
  });
});
