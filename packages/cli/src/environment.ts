export function formatShellEnvironment(environment: Record<string, string>) {
  return Object.entries(environment)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n") + "\n";
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
