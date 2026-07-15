const STOP_WORDS = new Set([
  "a", "an", "and", "answer", "be", "currently", "does", "i", "in", "is", "it",
  "my", "of", "say", "should", "the", "to", "user", "what", "you", "your"
]);

export function expectedAnswerFragments(expected: string): string[] {
  const rawTokens = expected.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
  const meaningful = rawTokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token.toLocaleLowerCase()));
  return [...new Set(meaningful.length > 0 ? meaningful : rawTokens)].slice(0, 8);
}

export function answerSupportsExpectation(answer: string, expected: string) {
  const normalizedAnswer = answer.toLocaleLowerCase();
  const normalizedExpected = expected.trim().toLocaleLowerCase();
  if (!normalizedExpected) return false;
  if (normalizedAnswer.includes(normalizedExpected)) return true;
  const fragments = expectedAnswerFragments(expected);
  return fragments.length > 0 && fragments.every((fragment) =>
    normalizedAnswer.includes(fragment.toLocaleLowerCase())
  );
}
