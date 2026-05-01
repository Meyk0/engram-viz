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

type RetrievalExpectation = {
  retrievedMemoryIds?: string[];
  excludedRetrievedMemoryIds?: string[];
  topMemoryId?: string;
  minResults?: number;
  maxResults?: number;
};

export type MemoryEvalSuite = "conversation" | "retrieval" | "consolidation";

export type MemoryConversationEvalFixture = {
  name: string;
  message: string;
  existingMemories?: EvalMemoryInput[];
  storedMemoryId?: string;
  expected: {
    shouldStore: boolean;
    reason?: MemoryCandidate["reason"];
  } & RetrievalExpectation;
};

export type MemoryRetrievalEvalFixture = {
  name: string;
  query: string;
  memories: EvalMemoryInput[];
  limit?: number;
  expected: RetrievalExpectation;
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
  suite: MemoryEvalSuite;
  fixtureName: string;
  failures: string[];
};

export type MemoryEvalSuiteSummary = {
  total: number;
  passed: number;
  failed: number;
};

export type MemoryEvalReport = {
  total: number;
  passed: number;
  failed: number;
  bySuite: Record<MemoryEvalSuite, MemoryEvalSuiteSummary>;
  results: MemoryEvalResult[];
};

const MEMORY_EVAL_SUITES: MemoryEvalSuite[] = ["conversation", "retrieval", "consolidation"];
const BASE_TIME = Date.parse("2026-04-29T17:00:00.000Z");

const retrievalMemoryBank: EvalMemoryInput[] = [
  {
    id: "color-blue",
    text: "I like the color blue",
    importance: 0.82,
    topic: "preference",
    access_count: 2
  },
  {
    id: "ocean",
    text: "I like the ocean",
    importance: 0.74,
    topic: "preference"
  },
  {
    id: "red-ui",
    text: "I prefer red interface accents",
    importance: 0.78,
    topic: "design"
  },
  {
    id: "clinical-cyberpunk",
    text: "I prefer calm clinical cyberpunk interfaces",
    importance: 0.8,
    topic: "design"
  },
  {
    id: "stack-react-three",
    text: "The Engram project stack uses Next.js, React Three Fiber, and TypeScript",
    importance: 0.72,
    topic: "technical"
  },
  {
    id: "semantic-design",
    text: "User has recurring design memories: red interface accents; restrained medical UI",
    importance: 0.82,
    topic: "design",
    region: "temporal",
    access_count: 3
  }
];

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
        topic: "preference"
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
        topic: "preference"
      }
    ],
    expected: {
      shouldStore: false,
      reason: "trivial-question",
      retrievedMemoryIds: ["color-blue"]
    }
  },
  {
    name: "stores durable personal fact",
    message: "My name is Joscha",
    storedMemoryId: "name-joscha",
    expected: {
      shouldStore: true,
      reason: "personal-fact",
      retrievedMemoryIds: ["name-joscha"]
    }
  },
  {
    name: "stores project stack fact",
    message: "The app uses React Three Fiber and TypeScript",
    storedMemoryId: "project-stack",
    expected: {
      shouldStore: true,
      reason: "project-fact",
      retrievedMemoryIds: ["project-stack"]
    }
  },
  {
    name: "stores explicit memory inside polite question",
    message: "Can you remember that I prefer red accents for Engram?",
    storedMemoryId: "explicit-red",
    expected: {
      shouldStore: true,
      reason: "explicit-memory",
      retrievedMemoryIds: ["explicit-red"]
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
  },
  {
    name: "ignores social acknowledgement",
    message: "Thanks, this is helpful",
    expected: {
      shouldStore: false,
      reason: "transient"
    }
  }
];

export const memoryRetrievalEvalFixtures: MemoryRetrievalEvalFixture[] = [
  {
    name: "retrieves color preference as top result",
    query: "What color do I love?",
    memories: retrievalMemoryBank,
    expected: {
      topMemoryId: "color-blue",
      retrievedMemoryIds: ["color-blue"]
    }
  },
  {
    name: "does not confuse ocean preference with blue preference",
    query: "I like the ocean",
    memories: retrievalMemoryBank,
    expected: {
      retrievedMemoryIds: ["ocean"],
      excludedRetrievedMemoryIds: ["color-blue"]
    }
  },
  {
    name: "retrieves interface design memories",
    query: "What interface style should the app use?",
    memories: retrievalMemoryBank,
    expected: {
      retrievedMemoryIds: ["clinical-cyberpunk", "red-ui"]
    }
  },
  {
    name: "retrieves technical stack memories",
    query: "What React stack are we using?",
    memories: retrievalMemoryBank,
    expected: {
      retrievedMemoryIds: ["stack-react-three"]
    }
  },
  {
    name: "retrieves temporal semantic memory",
    query: "What stable design knowledge do we have?",
    memories: retrievalMemoryBank,
    expected: {
      retrievedMemoryIds: ["semantic-design"]
    }
  },
  {
    name: "respects retrieval limit",
    query: "interface design",
    memories: retrievalMemoryBank,
    limit: 1,
    expected: {
      maxResults: 1,
      minResults: 1
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
  },
  {
    name: "skips singleton topics",
    memories: [
      {
        id: "design-red",
        text: "I prefer red interface accents",
        topic: "design"
      },
      {
        id: "ocean",
        text: "I like the ocean",
        topic: "preference"
      }
    ],
    expected: {
      ids: null
    }
  },
  {
    name: "skips temporal memories",
    memories: [
      {
        id: "semantic-design",
        text: "User has recurring design memories: red accents; clinical UI",
        topic: "design",
        region: "temporal"
      },
      {
        id: "semantic-design-2",
        text: "User has recurring design memories: dim brain colors; visible grid",
        topic: "design",
        region: "temporal"
      }
    ],
    expected: {
      ids: null
    }
  },
  {
    name: "skips memories without topics",
    memories: [
      {
        id: "untagged-1",
        text: "I like the ocean"
      },
      {
        id: "untagged-2",
        text: "I like the color blue"
      }
    ],
    expected: {
      ids: null
    }
  },
  {
    name: "selects oldest three memories in an eligible topic",
    memories: [
      {
        id: "design-1",
        text: "I prefer red accents",
        topic: "design"
      },
      {
        id: "design-2",
        text: "I prefer dim brain regions",
        topic: "design"
      },
      {
        id: "design-3",
        text: "I prefer visible wireframes",
        topic: "design"
      },
      {
        id: "design-4",
        text: "I prefer minimal labels",
        topic: "design"
      }
    ],
    expected: {
      ids: ["design-1", "design-2", "design-3"],
      textIncludes: ["red accents", "dim brain regions", "visible wireframes"]
    }
  },
  {
    name: "chooses largest eligible topic group",
    memories: [
      {
        id: "design-1",
        text: "I prefer red accents",
        topic: "design"
      },
      {
        id: "design-2",
        text: "I prefer dim brain regions",
        topic: "design"
      },
      {
        id: "technical-1",
        text: "The app uses React Three Fiber",
        topic: "technical"
      },
      {
        id: "technical-2",
        text: "The app uses TypeScript",
        topic: "technical"
      },
      {
        id: "technical-3",
        text: "The app deploys on Vercel",
        topic: "technical"
      }
    ],
    expected: {
      ids: ["technical-1", "technical-2", "technical-3"],
      textIncludes: ["React Three Fiber", "TypeScript", "Vercel"]
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

  failures.push(...assertRetrievalExpectation(fixture.expected, retrievedIds));

  return { suite: "conversation", fixtureName: fixture.name, failures };
}

export function runRetrievalEvalFixture(fixture: MemoryRetrievalEvalFixture): MemoryEvalResult {
  const retrievedIds = retrieveMemories(
    fixture.memories.map(toEngramMemory),
    fixture.query,
    fixture.limit
  ).map((result) => result.memory.id);
  const failures = assertRetrievalExpectation(fixture.expected, retrievedIds);

  return { suite: "retrieval", fixtureName: fixture.name, failures };
}

export function runConsolidationEvalFixture(
  fixture: MemoryConsolidationEvalFixture
): MemoryEvalResult {
  const candidate = findConsolidationCandidate(fixture.memories.map(toEngramMemory));
  const failures: string[] = [];

  if (fixture.expected.ids === null) {
    if (candidate !== null) failures.push(`expected no consolidation candidate, got ${candidate.ids.join(", ")}`);
    return { suite: "consolidation", fixtureName: fixture.name, failures };
  }

  if (!candidate) {
    failures.push(`expected consolidation ids ${fixture.expected.ids.join(", ")}, got none`);
    return { suite: "consolidation", fixtureName: fixture.name, failures };
  }

  if (!sameItems(candidate.ids, fixture.expected.ids)) {
    failures.push(`expected consolidation ids ${fixture.expected.ids.join(", ")}, got ${candidate.ids.join(", ")}`);
  }

  fixture.expected.textIncludes?.forEach((text) => {
    if (!candidate.consolidatedText.includes(text)) {
      failures.push(`expected consolidated text to include "${text}", got "${candidate.consolidatedText}"`);
    }
  });

  return { suite: "consolidation", fixtureName: fixture.name, failures };
}

export function runMemoryEvalReport(): MemoryEvalReport {
  const results = [
    ...memoryConversationEvalFixtures.map(runConversationEvalFixture),
    ...memoryRetrievalEvalFixtures.map(runRetrievalEvalFixture),
    ...memoryConsolidationEvalFixtures.map(runConsolidationEvalFixture)
  ];
  const bySuite = createEmptySuiteSummary();

  results.forEach((result) => {
    const suite = bySuite[result.suite];
    suite.total += 1;
    if (result.failures.length === 0) {
      suite.passed += 1;
    } else {
      suite.failed += 1;
    }
  });

  const failed = results.filter((result) => result.failures.length > 0).length;

  return {
    total: results.length,
    passed: results.length - failed,
    failed,
    bySuite,
    results
  };
}

export function formatMemoryEvalReport(report: MemoryEvalReport): string {
  const lines = [`Memory evals: ${report.passed}/${report.total} passed`];

  MEMORY_EVAL_SUITES.forEach((suite) => {
    const summary = report.bySuite[suite];
    lines.push(`${suite}: ${summary.passed}/${summary.total} passed`);
  });

  const failures = report.results.filter((result) => result.failures.length > 0);
  if (failures.length > 0) {
    lines.push("");
    failures.forEach((result) => {
      lines.push(`[${result.suite}] ${result.fixtureName}`);
      result.failures.forEach((failure) => lines.push(`- ${failure}`));
    });
  }

  return lines.join("\n");
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
  expected: RetrievalExpectation,
  retrievedIds: string[]
): string[] {
  const failures: string[] = [];

  expected.retrievedMemoryIds?.forEach((id) => {
    if (!retrievedIds.includes(id)) {
      failures.push(`expected retrieval to include "${id}", got ${formatIds(retrievedIds)}`);
    }
  });

  expected.excludedRetrievedMemoryIds?.forEach((id) => {
    if (retrievedIds.includes(id)) {
      failures.push(`expected retrieval to exclude "${id}", got ${formatIds(retrievedIds)}`);
    }
  });

  if (expected.topMemoryId && retrievedIds[0] !== expected.topMemoryId) {
    failures.push(`expected top retrieval "${expected.topMemoryId}", got ${retrievedIds[0] ?? "none"}`);
  }

  if (expected.minResults !== undefined && retrievedIds.length < expected.minResults) {
    failures.push(`expected at least ${expected.minResults} retrievals, got ${retrievedIds.length}`);
  }

  if (expected.maxResults !== undefined && retrievedIds.length > expected.maxResults) {
    failures.push(`expected at most ${expected.maxResults} retrievals, got ${retrievedIds.length}`);
  }

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

function createEmptySuiteSummary(): Record<MemoryEvalSuite, MemoryEvalSuiteSummary> {
  return {
    conversation: createEmptySummary(),
    retrieval: createEmptySummary(),
    consolidation: createEmptySummary()
  };
}

function createEmptySummary(): MemoryEvalSuiteSummary {
  return {
    total: 0,
    passed: 0,
    failed: 0
  };
}

function sameItems(actual: string[], expected: string[]) {
  return actual.length === expected.length && expected.every((id) => actual.includes(id));
}

function formatIds(ids: string[]) {
  return ids.length === 0 ? "[]" : ids.join(", ");
}
