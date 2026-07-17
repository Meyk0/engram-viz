import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Release utilities are intentionally plain Node ESM scripts.
import { syncPublicAssets } from "../../../scripts/sync-public-assets.mjs";
// @ts-expect-error Release utilities are intentionally plain Node ESM scripts.
import { verifyPublicWeb } from "../../../scripts/verify-public-web.mjs";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("public web release boundary", () => {
  it("fails closed when Vercel targets the Studio repository root", async () => {
    const config = JSON.parse(await readFile(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      buildCommand?: string;
    };
    const rootPackage = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const webPackage = JSON.parse(
      await readFile(path.join(process.cwd(), "apps", "web", "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
    };
    const guard = await readFile(path.join(process.cwd(), "scripts", "reject-root-vercel-deploy.mjs"), "utf8");

    expect(config.buildCommand).toBe("npm run vercel-build");
    expect(rootPackage.scripts?.["vercel-build"]).toBe("node scripts/reject-root-vercel-deploy.mjs");
    expect(webPackage.scripts?.["vercel-build"]).toBe("npm run build");
    expect(guard).toContain("Set the Vercel project Root Directory to apps/web");
    expect(guard).toContain("process.exitCode = 1");
  });

  it("syncs public assets from the app-root build path and starts Studio through the local launcher", async () => {
    const webPackage = JSON.parse(await readFile(path.join(process.cwd(), "apps", "web", "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const rootPackage = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(webPackage.scripts?.prebuild).toBe("node ../../scripts/sync-public-assets.mjs");
    expect(webPackage.scripts?.predev).toBe("node ../../scripts/sync-public-assets.mjs");
    expect(rootPackage.scripts?.start).toContain("scripts/start-local-studio.mjs");
  });


  it("rebuilds the public directory from an explicit asset allowlist", async () => {
    const root = await temporaryDirectory();
    const sourceDirectory = path.join(root, "source");
    const targetDirectory = path.join(root, "target");
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    await writeFile(path.join(sourceDirectory, "icon.png"), "canonical");
    await writeFile(path.join(sourceDirectory, "private.txt"), "do not copy");
    await writeFile(path.join(targetDirectory, "stale.txt"), "remove me");

    const files = await syncPublicAssets({ sourceDirectory, targetDirectory, assets: ["icon.png"] });

    expect(files).toEqual(["icon.png"]);
    expect(await readdir(targetDirectory)).toEqual(["icon.png"]);
    expect(await readFile(path.join(targetDirectory, "icon.png"), "utf8")).toBe("canonical");
  });

  it("accepts the public routes plus Next's internal error routes", async () => {
    const webRoot = await publicBuildFixture(["/", "/_global-error", "/_not-found", "/demo", "/docs"]);

    const result = await verifyPublicWeb({ webRoot, environment: {} });

    expect(result.failures).toEqual([]);
    expect(result.routes).toEqual(["/", "/_global-error", "/_not-found", "/demo", "/docs"]);
    expect(result.scannedFiles).toBeGreaterThan(0);
  });

  it("reports API routes, missing public routes, and server-secret markers", async () => {
    const webRoot = await publicBuildFixture(["/", "/api/local/traces"]);
    await writeFile(path.join(webRoot, ".next", "static", "app.js"), "const key = 'SUPABASE_SECRET_KEY';");

    const result = await verifyPublicWeb({ webRoot, environment: {} });

    expect(result.failures).toContain("public route manifest is missing /demo");
    expect(result.failures).toContain("public route manifest is missing /docs");
    expect(result.failures).toContain("public route manifest contains unexpected route /api/local/traces");
    expect(result.failures).toContain(
      "public output contains forbidden marker SUPABASE_SECRET_KEY: .next/static/app.js"
    );
  });

  it("rejects any extra public page", async () => {
    const webRoot = await publicBuildFixture(["/", "/demo", "/docs", "/studio"]);

    const result = await verifyPublicWeb({ webRoot, environment: {} });

    expect(result.failures).toContain("public route manifest contains unexpected route /studio");
  });

  it("rejects Studio API callers from the generated public artifact", async () => {
    const webRoot = await publicBuildFixture(["/", "/demo", "/docs"]);
    await writeFile(path.join(webRoot, ".next", "static", "app.js"), "fetch('/api/lab/replay')");

    const result = await verifyPublicWeb({ webRoot, environment: {} });

    expect(result.failures).toContain(
      "public output contains forbidden marker Studio client /api/lab/replay: .next/static/app.js"
    );
  });
});

async function publicBuildFixture(routes: string[]) {
  const webRoot = await temporaryDirectory();
  await mkdir(path.join(webRoot, ".next", "static"), { recursive: true });
  await writeFile(path.join(webRoot, ".next", "routes-manifest.json"), JSON.stringify({
    staticRoutes: routes.map((page) => ({ page })),
    dynamicRoutes: []
  }));
  await writeFile(path.join(webRoot, ".next", "static", "app.js"), "console.log('public web');");
  return webRoot;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "engram-public-web-"));
  directories.push(directory);
  return directory;
}
