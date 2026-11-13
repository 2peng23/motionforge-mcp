import http from "node:http";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { Policy } from "../src/security/policy.js";
import { analyzeProject } from "../src/services/discovery.js";
import { capture, captureSchema } from "../src/services/capture.js";
import { detectClipping } from "../src/services/layout-qa.js";
import { timelineSchema } from "../src/schemas/timeline.js";
import {
  renderVideo,
  validateExport,
  inspectFrames,
  inspectAudio,
} from "../src/services/video.js";
const root = process.cwd();
const fixture = path.join(root, "examples/demo");
const policy = new Policy([root]);
const output = path.join(root, "artifacts", `demo-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const relative =
      pathname === "/"
        ? "index.html"
        : pathname === "/projects/"
          ? "projects/index.html"
          : "";
    if (!relative) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(await readFile(path.join(fixture, relative)));
  } catch {
    response.statusCode = 500;
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
try {
  const project = await analyzeProject(policy, fixture);
  const overview = await capture(
    policy,
    captureSchema.parse({
      url: `http://127.0.0.1:${address.port}/`,
      output: path.join(output, "overview.png"),
      width: 1120,
      height: 760,
    }),
  );
  const active = await capture(
    policy,
    captureSchema.parse({
      url: `http://127.0.0.1:${address.port}/`,
      output: path.join(output, "active.png"),
      width: 1120,
      height: 760,
      actions: [
        { type: "move", x: 410, y: 398, steps: 20 },
        { type: "wait", milliseconds: 300 },
        { type: "click", selector: "#focus" },
        { type: "wait", milliseconds: 700 },
      ],
      allowInteractions: true,
      record: true,
    }),
  );
  const projects = await capture(
    policy,
    captureSchema.parse({
      url: `http://127.0.0.1:${address.port}/projects/`,
      output: path.join(output, "projects.png"),
      width: 1120,
      height: 760,
    }),
  );
  if (!active.video)
    throw new Error("The acceptance flow recording produced no video");
  const timeline = timelineSchema.parse({
    product: "fieldnote.",
    direction: "editorial",
    background: "#172d36",
    accent: "#b8ee78",
    width: 1920,
    height: 1080,
    fps: 30,
    shots: [
      {
        title: "Room for good work.",
        description: "A local demonstration of a focused team workspace.",
        kind: "typography",
        duration: 2,
        evidence: "examples/demo/index.html h1 and descriptive text",
        motion: "reveal",
      },
      {
        title: "Find the work in focus.",
        description: "Filter the project desk to its two active projects.",
        asset: active.video,
        duration: 3,
        kind: "device",
        motion: "push",
        transition: "wipe",
        evidence:
          "capture_user_flow clicked #focus; two non-active rows hidden",
      },
      {
        title: "One clear project desk.",
        description: "Explore four sample projects and their next steps.",
        asset: projects.screenshot,
        kind: "split",
        duration: 3,
        motion: "pan",
        evidence: "Actual /projects/ fixture page with four sample entries",
      },
      {
        title: "Make space for progress.",
        description: "Explore the editable local demo.",
        kind: "typography",
        duration: 2,
        motion: "reveal",
        evidence: "Call to action directs to this local demo only",
      },
    ],
  });
  await policy.write(
    path.join(output, "storyboard.json"),
    JSON.stringify(timeline, null, 2),
  );
  const layout = await detectClipping(
    policy,
    path.join(output, "storyboard.json"),
  );
  const rendered = await renderVideo(
    policy,
    timeline,
    path.join(output, "fieldnote.mp4"),
    (value) => console.error(`Render ${Math.round(value * 100)}%`),
  );
  const validation = await validateExport(policy, rendered.video, {
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 10,
  });
  const frames = await inspectFrames(
    policy,
    rendered.video,
    path.join(output, "frames"),
  );
  const report = {
    project,
    layout,
    overview,
    active,
    projects,
    rendered,
    validation,
    frames,
    audio: await inspectAudio(policy, rendered.video),
    limitations: [
      "No licensed soundtrack was supplied: this demo is intentionally silent.",
      "Automated metadata/decode and sampled frames do not establish professional aesthetic quality.",
      "Interaction clip continuously samples masked browser frames; frame timing depends on local screenshot performance.",
    ],
  };
  await policy.write(
    path.join(output, "acceptance-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        output,
        video: rendered.video,
        valid: validation.valid,
        editableProject: rendered.editableProject,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
