import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const docsRoot = path.join(root, "docs");
const config = JSON.parse(await readFile(path.join(docsRoot, "docs.json"), "utf8"));
const failures = [];

for (const field of ["theme", "name", "colors", "navigation"]) {
  if (!config[field]) failures.push(`docs.json is missing required field "${field}"`);
}

const navigationPages = collectPages(config.navigation);
const duplicatePages = navigationPages.filter((page, index) => navigationPages.indexOf(page) !== index);
for (const page of new Set(duplicatePages)) failures.push(`navigation contains duplicate page "${page}"`);

const mdxFiles = await walkMdx(docsRoot);
const navigatedFiles = new Set(navigationPages.map((page) => `${page}.mdx`));

for (const page of navigationPages) {
  const file = `${page}.mdx`;
  if (!mdxFiles.includes(file)) failures.push(`navigation page "${page}" has no ${file}`);
}

for (const file of mdxFiles) {
  if (!navigatedFiles.has(file)) failures.push(`${file} is not present in docs.json navigation`);
  const content = await readFile(path.join(docsRoot, file), "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    failures.push(`${file} is missing YAML frontmatter`);
    continue;
  }
  if (!/^title:\s*.+$/m.test(frontmatter[1])) failures.push(`${file} frontmatter is missing title`);
  if (!/^description:\s*.+$/m.test(frontmatter[1])) failures.push(`${file} frontmatter is missing description`);

  const internalLinks = [
    ...content.matchAll(/\]\(\/([^#?)\s]+)(?:#[^)]*)?\)/g),
    ...content.matchAll(/href="\/([^"#?]+)(?:#[^"]*)?"/g)
  ].map((match) => match[1].replace(/\/$/, ""));

  for (const target of internalLinks) {
    if (!target) continue;
    const targetFile = `${target}.mdx`;
    if (!mdxFiles.includes(targetFile)) failures.push(`${file} links to missing page "/${target}"`);
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL  ${failure}`));
  process.exit(1);
}

console.log(`PASS  docs.json references ${navigationPages.length} unique MDX pages`);
console.log("PASS  every page has title and description frontmatter");
console.log("PASS  internal documentation links resolve");

function collectPages(value) {
  if (Array.isArray(value)) return value.flatMap(collectPages);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === "pages" && Array.isArray(child)) {
      return child.flatMap((page) => typeof page === "string" ? [page] : collectPages(page));
    }
    return collectPages(child);
  });
}

async function walkMdx(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walkMdx(path.join(directory, entry.name), relative));
    if (entry.isFile() && entry.name.endsWith(".mdx")) files.push(relative);
  }
  return files.sort();
}
