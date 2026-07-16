import { startStudio } from "../packages/studio/launcher.mjs";

const port = Number(process.env.PORT ?? 3100);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

await startStudio({
  port,
  hostname: "127.0.0.1",
  environment: {
    ...process.env,
    ENGRAM_LOCAL_MODE: "true"
  }
});
