import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : undefined;
const repositoryRoot = modulePath ? path.dirname(path.dirname(modulePath)) : process.cwd();

export const PUBLIC_WEB_ASSETS = Object.freeze([
  "engram-icon.png",
  "engram-og.png",
  "lobes_of_the_cerebrum.glb"
]);

export async function syncPublicAssets({
  sourceDirectory = path.join(repositoryRoot, "public"),
  targetDirectory = path.join(repositoryRoot, "apps", "web", "public"),
  assets = PUBLIC_WEB_ASSETS
} = {}) {
  await rm(targetDirectory, { recursive: true, force: true });
  await mkdir(targetDirectory, { recursive: true });

  for (const asset of assets) {
    if (path.basename(asset) !== asset) throw new Error(`Public asset must be a file name: ${asset}`);
    await copyFile(path.join(sourceDirectory, asset), path.join(targetDirectory, asset));
  }

  return (await readdir(targetDirectory)).sort();
}

if (modulePath && process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const assets = await syncPublicAssets();
  process.stdout.write(`Synced ${assets.length} public web assets: ${assets.join(", ")}\n`);
}
