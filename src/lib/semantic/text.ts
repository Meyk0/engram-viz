import type { SemanticMemoryDescriptor } from "@/lib/semantic/types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your"
]);

export type TfIdfVectorSet = {
  vocabulary: string[];
  vectors: Map<string, number[]>;
};

export function semanticMemoryText(memory: SemanticMemoryDescriptor): string {
  return [
    memory.text,
    memory.topic ? `Topic: ${memory.topic}` : undefined,
    memory.kind ? `Kind: ${memory.kind}` : undefined,
    memory.entities?.length ? `Entities: ${memory.entities.join(", ")}` : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function tokenizeSemanticText(value: string): string[] {
  return (value
    .normalize("NFKD")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(stemToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function createTfIdfVectors(memories: readonly SemanticMemoryDescriptor[]): TfIdfVectorSet {
  const ordered = [...memories].sort(compareMemories);
  const documents = ordered.map((memory) => weightedMemoryTokens(memory));
  const documentFrequency = new Map<string, number>();

  documents.forEach((tokens) => {
    new Set(tokens).forEach((token) => {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    });
  });

  const vocabulary = [...documentFrequency.keys()].sort();
  const vectors = new Map<string, number[]>();

  ordered.forEach((memory, documentIndex) => {
    const tokens = documents[documentIndex] ?? [];
    const termFrequency = new Map<string, number>();
    tokens.forEach((token) => termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1));

    const vector = vocabulary.map((term) => {
      const count = termFrequency.get(term) ?? 0;
      if (count === 0) return 0;

      const tf = 1 + Math.log(count);
      const idf = Math.log((ordered.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
      return tf * idf;
    });

    vectors.set(memory.id, normalizeVector(vector));
  });

  return { vocabulary, vectors };
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index] ?? 0;
    const valueB = b[index] ?? 0;
    dot += valueA * valueB;
    magnitudeA += valueA * valueA;
    magnitudeB += valueB * valueB;
  }

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dot / Math.sqrt(magnitudeA * magnitudeB);
}

function weightedMemoryTokens(memory: SemanticMemoryDescriptor): string[] {
  const tokens = [
    ...tokenizeSemanticText(memory.text),
    ...repeatTokens(memory.topic, 3),
    ...repeatTokens(memory.kind, 2),
    ...(memory.entities ?? []).flatMap((entity) => repeatTokens(entity, 3))
  ];

  return tokens.length > 0 ? tokens : [`memory-${memory.id.toLowerCase()}`];
}

function repeatTokens(value: string | undefined, count: number): string[] {
  if (!value) return [];
  const tokens = tokenizeSemanticText(value);
  return Array.from({ length: count }, () => tokens).flat();
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function compareMemories(a: SemanticMemoryDescriptor, b: SemanticMemoryDescriptor): number {
  return a.id.localeCompare(b.id);
}
