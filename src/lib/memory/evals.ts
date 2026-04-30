import type { EngramMemory } from "@/types";
import { findConsolidationCandidate } from "@/lib/memory/consolidationPolicy";
import { evaluateMemoryCandidate, type MemoryCandidate } from "@/lib/memory/rules";
import { retrieveMemories } from "@/lib/memory/retrieve";

type EvalMemoryInput = {
  id: string;
  text: string;
  importance?: number;
  topic?: string;
  region?: EngramMemory["region"];
  created_at?: string;
  access_count?: number;
};

export type MemoryConversationEvalFixture = {
  name: string;
  message: string;
  existingMemories?: EvalMemoryInput[];
  storedMemoryId?: string;
  expected: {
    shouldStore: boolean;
    reason?: MemoryCandidate["reason"];
    retrievedMemoryIds?: string[];
    excludedRetrievedMemoryIds?: string[];
  };
};

export type MemoryConsolidationEvalFixture = {
  name: string;
  memories: EvalMemoryInput[];
  expected: {
    ids: string[] | null;
    textIncludes?: string[];
  };
};

export type MemoryEvalResult = {
  fixtureName: string;
  failures: string[];
};

const BASE_TIME = Date.parse("2026-04-29T17:00:00.000Z");

export const memoryConversationEvalFixtures: MemoryConversationEvalFixture[] = [
  {
    name: "stores explicit color preference",
    message: "I like the color blue",
    storedMemoryId: "color-blue",
    expected: {
      shouldStore: true,
      reason: "preference",
      retrievedMemoryIds: ["color-blue"]
    }
  },
  {
    name: "stores ocean preference without retrieving blue",
    message: "I like the ocean",
    existingMemories: [
      {
        id: "color-blue",
        text: "I like the color blue",
        importance: 0.78,
        topic: "design"
      }
    ],
    storedMemoryId: "ocean",
    expected: {
      shouldStore: true,
      reason: "preference",
      retrievedMemoryIds: ["ocean"],
      excludedRetrievedMemoryIds: ["color-blue"]
    }
  },
  {
    name: "retrieves favorite color without storing question",
    message: "What is my favorite color?",
    existingMemories: [
      {
        id: "color-blue",
        text: "I like the color blue",
        importance: 0.78,
        topic: "design"
      }
    ],
    expected: {
      shouldStore: false,
      reason: "trivial-question",
      retrievedMemoryIds: ["color-blue"]
    }
  },
  {
    name: "ignores transient command",
    message: "Please summarize this paragraph for me.",
    expected: {
      shouldStore: false,
      reason: "transient"
    }
  },
  {
    name: "ignores transient factual question",
    message: "What is the weather today?",
    expected: {
      shouldStore: false,
      reason: "trivial-question"
    }
  }
];

export const memoryConsolidationEvalFixtures: MemoryConsolidationEvalFixture[] = [
  {
    name: "consolidates repeated related design preferences",
    memories: [
      {
        id: "design-red",
        text: "I prefer red interface accents",
        importance: 0.78,
        topic: "design"
      },
      {
        id: "design-medical",
        text: "I like restrained medical UI",
        importance: 0.78,
        topic: "design"
      },
      {
        id: "ocean",
        text: "I like the ocean",
        importance: 0.78,
        topic: "preference"
      }
    ],
    expected: {
      ids: ["design-red", "design-medical"],
      textIncludes: ["recurring design memories", "red interface", "restrained medical UI"]
    }
  }
];

export function runConversationEvalFixture(
  fixture: MemoryConversationEvalFixture
): MemoryEvalResult {
  const candidate = evaluateMemoryCandidate(fixture.message);
  const failures = assertStorageExpectation(fixture, candidate);
  const memories = [
    ...(fixture.existingMemories ?? []).map(toEngramMemory),
    ...candidateToMemories(fixture, candidate)
  ];
  const retrievedIds = retrieveMemories(memories, fixture.message).map((result) => result.memory.id);

  failures.push(...assertRetrievalExpectation(fixture, retrievedIds));

  return { fixtureName: fixture.name, failures };
}

export function runConsolidationEvalFixture(
  fixture: MemoryConsolidationEvalFixture
): MemoryEvalResult {
  const candidate = findConsolidationCandidate(fixture.memories.map(toEngramMemory));
  const failures: string[] = [];

  if (fixture.expected.ids === null) {
    if (candidate !== null) failures.push(`expected no consolidation candidate, got ${candidate.ids.join(", ")}`);
    return { fixtureName: fixture.name, failures };
  }

  if (!candidate) {
    failures.push(`expected consolidation ids ${fixture.expected.ids.join(", ")}, got none`);
    return { fixtureName: fixture.name, failures };
  }

  if (!sameItems(candidate.ids, fixture.expected.ids)) {
    failures.push(`expected consolidation ids ${fixture.expected.ids.join(", ")}, got ${candidate.ids.join(", ")}`);
  }

  fixture.expected.textIncludes?.forEach((text) => {
    if (!candidate.consolidatedText.includes(text)) {
      failures.push(`expected consolidated text to include "${text}", got "${candidate.consolidatedText}"`);
    }
  });

  return { fixtureName: fixture.name, failures };
}

function assertStorageExpectation(
  fixture: MemoryConversationEvalFixture,
  candidate: MemoryCandidate
): string[] {
  const failures: string[] = [];

  if (candidate.shouldStore !== fixture.expected.shouldStore) {
    failures.push(`expected shouldStore ${fixture.expected.shouldStore}, got ${candidate.shouldStore}`);
  }

  if (fixture.expected.reason && candidate.reason !== fixture.expected.reason) {
    failures.push(`expected reason "${fixture.expected.reason}", got "${candidate.reason}"`);
  }

  return failures;
}

function assertRetrievalExpectation(
  fixture: MemoryConversationEvalFixture,
  retrievedIds: string[]
): string[] {
  const failures: string[] = [];

  fixture.expected.retrievedMemoryIds?.forEach((id) => {
    if (!retrievedIds.includes(id)) {
      failures.push(`expected retrieval to include "${id}", got ${formatIds(retrievedIds)}`);
    }
  });

  fixture.expected.excludedRetrievedMemoryIds?.forEach((id) => {
    if (retrievedIds.includes(id)) {
      failures.push(`expected retrieval to exclude "${id}", got ${formatIds(retrievedIds)}`);
    }
  });

  return failures;
}

function candidateToMemories(
  fixture: MemoryConversationEvalFixture,
  candidate: MemoryCandidate
): EngramMemory[] {
  if (!candidate.shouldStore) return [];

  return [
    toEngramMemory({
      id: fixture.storedMemoryId ?? "stored-turn",
      text: candidate.text,
      importance: candidate.importance,
      topic: candidate.topic
    })
  ];
}

function toEngramMemory(input: EvalMemoryInput, index = 0): EngramMemory {
  return {
    id: input.id,
    text: input.text,
    importance: input.importance ?? 0.78,
    topic: input.topic,
    region: input.region ?? "hippocampus",
    created_at: input.created_at ?? new Date(BASE_TIME + index * 60_000).toISOString(),
    access_count: input.access_count ?? 0
  };
}

function sameItems(actual: string[], expected: string[]) {
  return actual.length === expected.length && expected.every((id) => actual.includes(id));
}

function formatIds(ids: string[]) {
  return ids.length === 0 ? "[]" : ids.join(", ");
}
