import { afterEach, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Policy, processMedia } from "../src/security/policy.js";
import { mixAudio, generateVoiceover } from "../src/providers/audio.js";
import { inspectAudio, probe } from "../src/services/video.js";
let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
it("mixes actual local tracks with delay and inspects measured audio peak", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "motionforge-audio-"));
  const policy = new Policy([temporary]);
  const first = path.join(temporary, "first.wav");
  const second = path.join(temporary, "second.wav");
  for (const [frequency, output] of [
    [220, first],
    [440, second],
  ] as const)
    await processMedia("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=1`,
      output,
    ]);
  const output = path.join(temporary, "mixed.wav");
  await mixAudio(
    policy,
    [
      { path: first, gain: 0.5, delayMilliseconds: 0 },
      { path: second, gain: 0.5, delayMilliseconds: 250 },
    ],
    output,
    1.5,
  );
  const metadata = await probe(policy, output);
  expect(Number(metadata.format.duration)).toBeCloseTo(1.5, 1);
  const levels = await inspectAudio(policy, output);
  expect(levels.hasAudio).toBe(true);
  expect("clippingRisk" in levels && levels.clippingRisk).toBe(false);
  await expect(
    generateVoiceover(policy, {
      text: "No network authorization",
      voiceId: "example",
      output: path.join(temporary, "voice.mp3"),
      authorizeUpload: false,
    }),
  ).rejects.toThrow("authorizeUpload");
});

it("rejects mislabeled audio imports and preflights paid output collisions before any request", async () => {
  temporary = await mkdtemp(
    path.join(os.tmpdir(), "motionforge-audio-boundary-"),
  );
  const policy = new Policy([temporary]);
  const source = path.join(temporary, "source.wav");
  await processMedia("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=0.1",
    source,
  ]);
  const { importAudio } = await import("../src/providers/audio.js");
  await expect(
    importAudio(
      policy,
      source,
      path.join(temporary, "wrong.mp3"),
      "Synthetic test tone generated locally",
    ),
  ).rejects.toThrow("extension must match");
  const previous = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "dummy-test-not-a-secret";
  try {
    await policy.write(
      path.join(temporary, "voice.mp3"),
      Buffer.from("existing output"),
    );
    await expect(
      generateVoiceover(policy, {
        text: "Must not be uploaded",
        voiceId: "testVoice",
        output: path.join(temporary, "voice.mp3"),
        authorizeUpload: true,
      }),
    ).rejects.toThrow("output exists");
  } finally {
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
  }
});
