import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Policy } from "../src/security/policy.js";
import { capture, captureSchema } from "../src/services/capture.js";
import { validateExport } from "../src/services/video.js";

let server: Server | undefined;
let temporary: string | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

it.skipIf(!process.env.MOTIONFORGE_BROWSER_PATH)(
  "records actual cursor/form/navigation motion with masked continuous frames and exclusive artifacts",
  async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "motionforge-capture-"));
    server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<!doctype html><html lang="en"><title>Motion test person@example.test</title><body><h1>${request.url?.startsWith("/next") ? "Next screen" : "Real browser flow"}</h1><p>person@example.test</p><input id="search" aria-label="Search"><button id="run" onclick="document.querySelector('h1').textContent='Filtered result'">Filter</button><a id="credential" href="https://user:synthetic-secret@localhost/path">Credential link</a><a id="next" href="/next?token=synthetic">Next</a><div data-private>synthetic private content</div></body></html>`,
      );
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture server address");
    const input = captureSchema.parse({
      url: `http://127.0.0.1:${address.port}`,
      output: path.join(temporary, "capture.png"),
      width: 640,
      height: 480,
      record: true,
      allowInteractions: true,
      actions: [
        { type: "move", x: 150, y: 100, steps: 5 },
        { type: "fill", selector: "#search", value: "Synthetic project" },
        { type: "click", selector: "#run" },
        { type: "wait", milliseconds: 300 },
        { type: "click", selector: "#next" },
        { type: "wait", milliseconds: 300 },
      ],
    });
    const policy = new Policy([temporary]);
    const result = await capture(policy, input);
    expect(result.recording!.sampledFrames).toBeGreaterThan(4);
    expect(JSON.stringify(result.evidence)).not.toContain(
      "person@example.test",
    );
    expect(result.evidence.url).not.toContain("token=");
    expect(JSON.stringify(result.evidence)).not.toContain("synthetic-secret");
    expect(result.video).toBeDefined();
    expect(
      (
        await validateExport(policy, result.video!, {
          width: 640,
          height: 480,
          fps: 30,
        })
      ).valid,
    ).toBe(true);
    expect((await readFile(result.screenshot)).length).toBeGreaterThan(100);
    expect(
      (await readdir(temporary)).some((name) =>
        name.startsWith(".motionforge-frames-"),
      ),
    ).toBe(false);
    await expect(capture(policy, input)).rejects.toThrow(/output exists/);
  },
  30000,
);
