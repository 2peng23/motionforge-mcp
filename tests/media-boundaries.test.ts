import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  link,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Policy, processMedia } from "../src/security/policy.js";
import {
  mediaInput,
  probe,
  exportProject,
  validateExport,
} from "../src/services/video.js";
import { timelineSchema } from "../src/schemas/timeline.js";

let temporary: string;
let project: string;
let policy: Policy;
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "motionforge-boundary-"));
  project = path.join(temporary, "project");
  await mkdir(project);
  policy = new Policy([project]);
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("authorized local artifacts", () => {
  it("blocks traversal, outside symlinks, and symlinks to protected credentials", async () => {
    const outside = path.join(temporary, "outside.txt");
    await writeFile(outside, "outside");
    await expect(
      policy.text(path.join(project, "..", "outside.txt")),
    ).rejects.toThrow(/outside authorized/);
    await symlink(outside, path.join(project, "escape.txt"));
    await expect(policy.text(path.join(project, "escape.txt"))).rejects.toThrow(
      /outside authorized/,
    );
    await writeFile(path.join(project, ".env"), "TOKEN=synthetic");
    await symlink(
      path.join(project, ".env"),
      path.join(project, "innocent.txt"),
    );
    await expect(
      policy.text(path.join(project, "innocent.txt")),
    ).rejects.toThrow(/Credential/);
  });
  it("creates nested artifacts exclusively and never truncates a hard-linked destination", async () => {
    const file = path.join(project, "nested", "artifact.json");
    await policy.write(file, '{"valid":true}');
    await expect(policy.write(file, "changed")).rejects.toThrow();
    const linked = path.join(project, "linked.json");
    await link(file, linked);
    await expect(policy.write(linked, "changed", true)).rejects.toThrow(
      /hard links/,
    );
    expect(await readFile(file, "utf8")).toBe('{"valid":true}');
  });
  it("rejects replacing authorized roots and writing through escaping parents", async () => {
    await expect(policy.write(project, "replace")).rejects.toThrow(
      /authorized root/,
    );
    const external = path.join(temporary, "external");
    await mkdir(external);
    await symlink(external, path.join(project, "escape"));
    await expect(
      policy.write(path.join(project, "escape", "new.json"), "{}"),
    ).rejects.toThrow(/outside authorized/);
  });
});

describe("bounded real media operations", () => {
  it("does not autodetect a playlist disguised as video", async () => {
    const disguised = path.join(project, "disguised.mp4");
    await writeFile(disguised, "#EXTM3U\nhttp://127.0.0.1:1/private\n");
    await expect(probe(policy, disguised)).rejects.toThrow(/ffprobe failed/);
    await writeFile(path.join(project, "playlist.m3u8"), "#EXTM3U\n");
    await expect(
      mediaInput(policy, path.join(project, "playlist.m3u8")),
    ).rejects.toThrow(/playlists/);
  });
  it("probes and fully decodes a generated H.264 fixture and detects wrong output dimensions", async () => {
    const video = path.join(project, "fixture.mp4");
    await processMedia("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=320x320:r=12:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    expect(
      (
        await validateExport(policy, video, {
          width: 320,
          height: 320,
          fps: 12,
          durationSeconds: 1,
        })
      ).valid,
    ).toBe(true);
    const mismatch = await validateExport(policy, video, { width: 1080 });
    expect(mismatch.valid).toBe(false);
    expect(mismatch.issues).toContain("Incorrect width.");
  });
  it("rejects missing screenshot media before creating a partial editable project", async () => {
    const timeline = timelineSchema.parse({
      product: "Test",
      shots: [
        {
          title: "Evidence",
          evidence: "fixture",
          asset: path.join(project, "missing.png"),
        },
      ],
    });
    const destination = path.join(project, "editable");
    await expect(
      exportProject(policy, timeline, destination),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(destination, "timeline.json")),
    ).rejects.toThrow();
  });
  it("bounds encoding quality and presets at the public timeline boundary", () => {
    const basic = {
      product: "Test",
      shots: [{ title: "Evidence", evidence: "fixture" }],
    };
    expect(timelineSchema.parse(basic).crf).toBe(18);
    expect(timelineSchema.safeParse({ ...basic, crf: -1 }).success).toBe(false);
    expect(
      timelineSchema.safeParse({
        ...basic,
        encodingPreset: "arbitrary-command",
      }).success,
    ).toBe(false);
  });
  it("exports actual video footage with measured source duration and a local copied asset", async () => {
    const video = path.join(project, "interaction.mp4");
    await processMedia("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x320:r=12:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    const timeline = timelineSchema.parse({
      product: "Fixture",
      shots: [
        {
          title: "Recorded action",
          evidence: "real fixture",
          asset: video,
          assetDurationSeconds: 99,
        },
      ],
    });
    const exported = await exportProject(
      policy,
      timeline,
      path.join(project, "video-project"),
    );
    const manifest = JSON.parse(await readFile(exported.timeline, "utf8"));
    expect(manifest.shots[0].asset).toBe("shot-0.mp4");
    expect(manifest.shots[0].assetDurationSeconds).toBe(1);
    expect(
      await readFile(path.join(exported.project, "public", "shot-0.mp4")),
    ).toEqual(await readFile(video));
  });
});
