import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Policy, redact } from "../security/policy.js";
const ignored = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".nuxt",
  "vendor",
  "coverage",
  "artifacts",
]);
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".svelte",
  ".html",
  ".css",
  ".scss",
  ".json",
  ".php",
]);
export async function inventory(policy: Policy, project: string) {
  const root = await policy.resolve(project);
  const files: { path: string; bytes: number }[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 10 || files.length >= 3000) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        ignored.has(entry.name)
      )
        continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, target),
          bytes: (await stat(target)).size,
        });
        if (files.length >= 3000) break;
      }
    }
  }
  await visit(root, 0);
  return { root, files, truncated: files.length >= 3000 };
}
export async function analyzeProject(policy: Policy, project: string) {
  const data = await inventory(policy, project);
  let manifest: Record<string, any> = {};
  if (data.files.some((file) => file.path === "package.json"))
    manifest = JSON.parse(
      await policy.text(path.join(data.root, "package.json")),
    );
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const frameworks = [
    "next",
    "nuxt",
    "@sveltejs/kit",
    "svelte",
    "vue",
    "react",
    "vite",
  ].filter((name) => dependencies[name]);
  const routes = data.files.flatMap((file) => {
    const source = file.path.replaceAll("\\", "/");
    let route: string | undefined;
    if (/\.html$/.test(source))
      route =
        "/" +
        source
          .replace(/(?:^|\/)index\.html$/, "")
          .replace(/\.html$/, "")
          .replace(/\/$/, "");
    else if (/(?:^|\/)app\/(?:.*\/)?page\.[jt]sx?$/.test(source))
      route =
        "/" +
        source
          .replace(/^(?:src\/)?app\//, "")
          .replace(/(?:^|\/)page\.[jt]sx?$/, "")
          .replace(/\([^/]+\)(?:\/|$)/g, "");
    else if (/(?:^|\/)routes\/(?:.*\/)?\+page\.svelte$/.test(source))
      route =
        "/" +
        source
          .replace(/^(?:src\/)?routes\//, "")
          .replace(/(?:^|\/)\+page\.svelte$/, "");
    else if (
      /^(?:src\/)?pages\/.*\.(?:vue|[jt]sx?)$/.test(source) &&
      !/(?:^|\/)(?:_app|_document|_error)\.[^.]+$/.test(source)
    )
      route =
        "/" +
        source
          .replace(/^(?:src\/)?pages\//, "")
          .replace(/(?:^|\/)index\.[^.]+$|\.[^.]+$/, "");
    if (route === undefined) return [];
    return [
      {
        source,
        route: route.replace(/\/+/g, "/") || "/",
        confidence: "filesystem-inference",
      },
    ];
  });
  const assets = data.files.filter((file) =>
    /\.(png|jpe?g|webp|svg|gif|mp4|webm|wav|mp3|woff2?)$/i.test(file.path),
  );
  const sources = data.files
    .filter(
      (file) =>
        textExtensions.has(path.extname(file.path)) && file.bytes < 100000,
    )
    .slice(0, 100);
  const links: { href: string; source: string }[] = [];
  const colors = new Set<string>();
  const fonts = new Set<string>();
  const headings: { text: string; source: string }[] = [];
  for (const file of sources) {
    const text = await policy.text(path.join(data.root, file.path));
    for (const link of text.matchAll(
      /(?:href|to)=[\"'](\/[^\"'#?]*)(?:[\"'])/g,
    ))
      links.push({ href: link[1]!, source: file.path });
    for (const color of text.match(/#[\da-fA-F]{3,8}\b/g) ?? [])
      colors.add(color);
    for (const font of text.matchAll(/font-family\s*:\s*([^;}]+)/g))
      fonts.add(font[1]!.trim());
    for (const heading of text.matchAll(/<h[12][^>]*>([^<{]+)</g))
      headings.push({ text: redact(heading[1]!.trim()), source: file.path });
  }
  return {
    ...data,
    name: manifest.name ?? path.basename(data.root),
    frameworks,
    commands: manifest.scripts ?? {},
    routes,
    links,
    assets,
    brand: {
      colors: [...colors].slice(0, 30),
      fonts: [...fonts].slice(0, 10),
      headings: headings.slice(0, 20),
    },
    limitations: [
      "Routes and features are static evidence, not proof of functioning behavior. Dynamic routes require client-provided URLs and browser verification.",
      "Only first 3000 files, depth 10, and first 100 eligible source files are inspected.",
    ],
  };
}
