#!/usr/bin/env node
import { runCli } from "../dist/index.js";

runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`engram: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
