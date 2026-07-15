import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const target = path.join(root, "packages", "studio", "dist");

await access(path.join(standalone, "server.js"));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(standalone, target, { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(target, ".next", "static"), { recursive: true });
await cp(path.join(root, "public"), path.join(target, "public"), { recursive: true });

// Engram does not use next/image. Removing Sharp keeps the packed server
// platform-neutral instead of embedding the build machine's native binary.
await rm(path.join(target, "node_modules", "sharp"), { recursive: true, force: true });
await rm(path.join(target, "node_modules", "@img"), { recursive: true, force: true });

process.stdout.write(`Prepared standalone Studio at ${target}\n`);
