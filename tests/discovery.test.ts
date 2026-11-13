import { it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Policy } from "../src/security/policy.js";
import { analyzeProject } from "../src/services/discovery.js";
let temporary: string;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
it("reports real HTML pages and links rather than app helpers or styles as routes", async () => {
  const fixture = await analyzeProject(
    new Policy([process.cwd()]),
    path.join(process.cwd(), "examples/demo"),
  );
  expect(fixture.routes.map((route) => route.route)).toEqual([
    "/",
    "/projects",
  ]);
  expect(fixture.links.some((link) => link.href === "/projects/")).toBe(true);
  temporary = await mkdtemp(path.join(os.tmpdir(), "motionforge-discovery-"));
  await mkdir(path.join(temporary, "app", "(marketing)"), { recursive: true });
  await writeFile(
    path.join(temporary, "package.json"),
    JSON.stringify({
      name: "real-next-app",
      dependencies: { next: "16.0.0", react: "19.2.0" },
    }),
  );
  await writeFile(
    path.join(temporary, "app", "(marketing)", "page.tsx"),
    "<h1>A real page</h1>",
  );
  await writeFile(
    path.join(temporary, "app", "layout.tsx"),
    "export default Layout",
  );
  await writeFile(
    path.join(temporary, "app", "styles.css"),
    "body{color:#102030}",
  );
  const result = await analyzeProject(new Policy([temporary]), temporary);
  expect(result.frameworks).toContain("next");
  expect(result.routes).toEqual([
    {
      source: "app/(marketing)/page.tsx",
      route: "/",
      confidence: "filesystem-inference",
    },
  ]);
});
