import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function studioRuntimePath() {
  return fileURLToPath(new URL("./dist", import.meta.url));
}

export async function isStudioRuntimeReady() {
  try {
    await access(path.join(studioRuntimePath(), "server.js"));
    return true;
  } catch {
    return false;
  }
}

export async function startStudio(options = {}) {
  const runtime = studioRuntimePath();
  const server = path.join(runtime, "server.js");
  await access(server);
  const port = options.port ?? 3100;
  const hostname = options.hostname ?? "127.0.0.1";

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], {
      cwd: runtime,
      env: {
        ...process.env,
        ...options.environment,
        HOSTNAME: hostname,
        PORT: String(port)
      },
      stdio: options.stdio ?? "inherit"
    });
    const forwardInterrupt = () => child.kill("SIGINT");
    const forwardTermination = () => child.kill("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", forwardInterrupt);
      process.off("SIGTERM", forwardTermination);
    };
    process.once("SIGINT", forwardInterrupt);
    process.once("SIGTERM", forwardTermination);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolve();
      else reject(new Error(`Engram Studio exited with code ${code ?? signal}.`));
    });
  });
}
