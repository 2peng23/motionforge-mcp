import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Policy, processMedia } from "../src/security/policy.js";
import { timelineSchema } from "../src/schemas/timeline.js";
import { detectClipping } from "../src/services/layout-qa.js";

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

it.skipIf(!process.env.MOTIONFORGE_BROWSER_PATH)(
  "measures actual text bounds, detects overflowing product text, and renders a held local clip",
  async () => {
    temporary = await mkdtemp(
      path.join(os.tmpdir(), "motionforge-layout-test-"),
    );
    const policy = new Policy([temporary]);
    const footage = path.join(temporary, "recording.mp4");
    await processMedia("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=640x360:r=30:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      footage,
    ]);
    const normal = timelineSchema.parse({
      product: "Demo",
      width: 1280,
      height: 720,
      fps: 30,
      shots: [
        {
          title: "Plan real work",
          description: "A captured product task.",
          duration: 3,
          evidence: "Synthetic local fixture",
          asset: footage,
        },
      ],
    });
    const normalPath = await policy.write(
      path.join(temporary, "normal.json"),
      JSON.stringify(normal),
    );
    const normalReport = await detectClipping(policy, normalPath);
    expect(normalReport.sampledFrames).toHaveLength(1);
    const title = normalReport.sampledFrames[0]!.elements.find(
      (element) => element.role === "title",
    );
    expect(title!.bounds.right).toBeGreaterThan(title!.bounds.left);
    expect(title!.fontSize).toBeGreaterThan(10);
    expect(
      normalReport.issues.filter((issue) => issue.role === "title"),
    ).toEqual([]);
    const overflow = timelineSchema.parse({
      product: "UnbrokenProductName".repeat(4),
      width: 320,
      height: 320,
      fps: 24,
      shots: [
        {
          title: "Measured overflow",
          duration: 2,
          evidence: "Synthetic long-name regression fixture",
        },
      ],
    });
    const overflowPath = await policy.write(
      path.join(temporary, "overflow.json"),
      JSON.stringify(overflow),
    );
    const overflowReport = await detectClipping(policy, overflowPath);
    expect(overflowReport.validAtSampledFrames).toBe(false);
    expect(
      overflowReport.issues.some(
        (issue) =>
          issue.role === "product" && issue.kind === "safe-area-overflow",
      ),
    ).toBe(true);
    expect(
      (await readdir(temporary)).some((name) =>
        name.startsWith(".motionforge-layout-"),
      ),
    ).toBe(false);
  },
  120_000,
);
