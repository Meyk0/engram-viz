export type MemoryCandidate = {
  shouldStore: boolean;
  text: string;
  importance: number;
  topic?: string;
  reason:
    | "empty"
    | "too-short"
    | "trivial-question"
    | "transient"
    | "explicit-memory"
    | "preference"
    | "personal-fact"
    | "project-fact";
};

const TRANSIENT_PATTERNS = [
  /\b(thanks|thank you|ok|okay|cool|great|nice|hello|hi|hey)\b/i,
  /\b(can you|could you|please|help me|show me|explain|summarize|write|make|build|fix)\b/i
];

const TRIVIAL_QUESTION_PATTERNS = [
  /^(what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will)\b/i,
  /\?$/
];

const EXPLICIT_MEMORY_PATTERN = /\b(remember|note that|keep in mind|don't forget|do not forget)\b/i;
const PREFERENCE_PATTERN =
  /\b(i|we)\s+(prefer|like|love|hate|dislike|want|need|care about|value|favor)\b|\b(my|our)\s+favorite\b|\bpreference\b/i;
const PERSONAL_FACT_PATTERN =
  /\b(i am|i'm|i work|i live|i use|i have|my name is|my role is|my company is|my project is|we use|we are|our project is)\b/i;
const PROJECT_FACT_PATTERN =
  /\b(project|app|repo|stack|framework|api|database|deployment|design system|architecture|deadline|requirement)\b/i;

export function evaluateMemoryCandidate(message: string): MemoryCandidate {
  const text = normalizeMemoryText(message);
  const normalized = text.toLowerCase();

  if (!text) {
    return reject(text, "empty");
  }

  if (wordCount(text) < 3) {
    return reject(text, "too-short");
  }

  const question = isQuestion(text);
  if (question) {
    return reject(text, "trivial-question");
  }

  const explicitMemory = EXPLICIT_MEMORY_PATTERN.test(text);
  const preference = PREFERENCE_PATTERN.test(text);
  const personalFact = PERSONAL_FACT_PATTERN.test(text);
  const projectFact = PROJECT_FACT_PATTERN.test(text) && hasDeclarativeCue(text);

  if (!explicitMemory && !preference && !personalFact && !projectFact) {
    if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) return reject(text, "transient");
    return reject(text, "transient");
  }

  const reason = explicitMemory
    ? "explicit-memory"
    : preference
      ? "preference"
      : personalFact
        ? "personal-fact"
        : "project-fact";

  return {
    shouldStore: true,
    text,
    importance: inferMemoryImportance(normalized, reason),
    topic: inferMemoryTopic(normalized),
    reason
  };
}

export function inferMemoryImportance(
  normalizedMessage: string,
  reason: MemoryCandidate["reason"] = "transient"
): number {
  let importance = 0.58;

  if (reason === "explicit-memory") importance = 0.84;
  if (reason === "preference") importance = 0.78;
  if (reason === "personal-fact") importance = 0.72;
  if (reason === "project-fact") importance = 0.68;

  if (/\b(always|never|must|critical|important|requirement)\b/.test(normalizedMessage)) {
    importance += 0.1;
  }

  return Math.min(0.95, importance);
}

export function inferMemoryTopic(normalizedMessage: string): string | undefined {
  if (/\b(design|visual|ui|interface|color|brain|cyberpunk|medical)\b/.test(normalizedMessage)) {
    return "design";
  }
  if (/\b(work|job|company|project|repo|deadline|requirement)\b/.test(normalizedMessage)) {
    return "work";
  }
  if (/\b(api|database|stack|framework|next\.?js|react|three|typescript|deployment|vercel)\b/.test(normalizedMessage)) {
    return "technical";
  }
  if (/\b(like|prefer|favorite|want|need|value|hate|dislike)\b/.test(normalizedMessage)) {
    return "preference";
  }
  return undefined;
}

function reject(text: string, reason: MemoryCandidate["reason"]): MemoryCandidate {
  return {
    shouldStore: false,
    text,
    importance: 0,
    reason
  };
}

function normalizeMemoryText(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function isQuestion(text: string): boolean {
  return TRIVIAL_QUESTION_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function hasDeclarativeCue(text: string): boolean {
  return /\b(is|are|uses|use|runs|requires|needs|must|should|will|has|have)\b/i.test(text);
}
