process.stderr.write(
  "Refusing to deploy the repository root: it is local Engram Studio and contains API routes. " +
  "Set the Vercel project Root Directory to apps/web.\n"
);
process.exitCode = 1;
