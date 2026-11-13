import { constants } from "node:fs";
import { copyFile, mkdir, readFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bundle } from "@remotion/bundler";
import {
  selectComposition,
  renderMedia,
  makeCancelSignal,
} from "@remotion/renderer";
import { Policy, processMedia } from "../security/policy.js";
import {
  timelineSchema,
  timelineFacts,
  type Timeline,
} from "../schemas/timeline.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const actualRoot =
  path.basename(packageRoot) === "dist"
    ? path.dirname(packageRoot)
    : packageRoot;
const require = createRequire(import.meta.url);
const mediaFormats: Record<string, string> = {
  ".png": "png_pipe",
  ".jpg": "mjpeg",
  ".jpeg": "mjpeg",
  ".webp": "webp_pipe",
  ".mp4": "mov",
  ".m4a": "mov",
  ".mov": "mov",
  ".webm": "matroska",
  ".mp3": "mp3",
  ".wav": "wav",
  ".ogg": "ogg",
  ".flac": "flac",
};

/** Force the demuxer so a disguised playlist cannot read other local files. */
export async function mediaInput(policy: Policy, input: string) {
  const target = await policy.resolve(input);
  const information = await stat(target);
  const extension = path.extname(target).toLowerCase();
  const format = mediaFormats[extension];
  if (!information.isFile() || !format)
    throw new Error(
      "Expected a supported local image, video, or audio file; playlists are excluded.",
    );
  const maximumBytes = [".mp4", ".mov", ".webm"].includes(extension)
    ? 512_000_000
    : 64_000_000;
  if (information.size > maximumBytes)
    throw new Error(`Media exceeds its ${maximumBytes / 1_000_000} MB limit.`);
  return {
    target,
    extension,
    information,
    arguments: ["-protocol_whitelist", "file,pipe", "-f", format, "-i", target],
  };
}

export async function loadTimeline(policy: Policy, input: string) {
  return timelineSchema.parse(JSON.parse(await policy.text(input)));
}

export async function exportProject(
  policy: Policy,
  inputTimeline: Timeline,
  destination: string,
) {
  const timeline = timelineSchema.parse(inputTimeline);
  const output = await policy.resolve(destination, true);
  // Validate assets before creating the export directory; failed validation leaves no partial project.
  const assets: (Awaited<ReturnType<typeof mediaInput>> | undefined)[] = [];
  const videoDurations: (number | undefined)[] = [];
  for (const shot of timeline.shots) {
    if (!shot.asset) {
      assets.push(undefined);
      videoDurations.push(undefined);
      continue;
    }
    const media = await mediaInput(policy, shot.asset);
    const videoAsset = [".mp4", ".webm"].includes(media.extension);
    if (
      !videoAsset &&
      ![".png", ".jpg", ".jpeg", ".webp"].includes(media.extension)
    )
      throw new Error(
        "Scene assets must be local PNG/JPEG/WebP images or MP4/WebM video.",
      );
    if (!videoAsset && media.information.size > 30_000_000)
      throw new Error("Image exceeds 30 MB.");
    const metadata = await probe(policy, media.target);
    const visual = metadata.streams.find(
      (stream) => stream.codec_type === "video",
    );
    const pixels = Number(visual?.width) * Number(visual?.height);
    if (
      !visual ||
      !Number.isFinite(pixels) ||
      pixels <= 0 ||
      pixels > (videoAsset ? 16_000_000 : 40_000_000)
    )
      throw new Error(
        "Visual asset is invalid or exceeds its pixel limit (16 MP video / 40 MP images).",
      );
    let sourceDuration: number | undefined;
    if (videoAsset) {
      sourceDuration = Number(metadata.format.duration);
      if (
        !Number.isFinite(sourceDuration) ||
        sourceDuration <= 0 ||
        sourceDuration > 180
      )
        throw new Error(
          "Video scene assets require a finite duration of at most 180 seconds.",
        );
      if (!["h264", "vp8", "vp9", "av1"].includes(String(visual.codec_name)))
        throw new Error(
          "Scene video requires H.264, VP8, VP9, or AV1 encoding.",
        );
    }
    assets.push(media);
    videoDurations.push(sourceDuration);
  }
  const audio = timeline.audio
    ? await mediaInput(policy, timeline.audio)
    : undefined;
  if (
    audio &&
    ![".mp3", ".wav", ".ogg", ".m4a", ".flac"].includes(audio.extension)
  )
    throw new Error("Unsupported audio extension.");
  await mkdir(path.dirname(output), { recursive: true });
  await policy.resolve(path.dirname(output));
  await mkdir(output, { recursive: false });
  const publicDirectory = path.join(output, "public");
  await mkdir(publicDirectory);
  const editable = structuredClone(timeline);
  for (let index = 0; index < editable.shots.length; index++) {
    const media = assets[index];
    if (!media) continue;
    const name = `shot-${index}${media.extension}`;
    await copyFile(
      media.target,
      path.join(publicDirectory, name),
      constants.COPYFILE_EXCL,
    );
    editable.shots[index]!.asset = name;
    editable.shots[index]!.assetDurationSeconds = videoDurations[index];
  }
  if (audio) {
    const name = "audio" + audio.extension;
    await copyFile(
      audio.target,
      path.join(publicDirectory, name),
      constants.COPYFILE_EXCL,
    );
    editable.audio = name;
  }
  await policy.write(
    path.join(output, "timeline.json"),
    JSON.stringify(editable, null, 2),
  );
  const source = await readFile(
    path.join(actualRoot, "compositions", "Root.tsx"),
    "utf8",
  );
  await policy.write(path.join(output, "Root.tsx"), source);
  await policy.write(
    path.join(output, "package.json"),
    JSON.stringify(
      {
        name: "motionforge-editable-video",
        private: true,
        type: "module",
        scripts: {
          studio: "remotion studio Root.tsx",
          render: `remotion render Root.tsx MotionForge video.mp4 --crf=${timeline.crf} --x264-preset=${timeline.encodingPreset}`,
        },
        dependencies: {
          "@remotion/cli": "4.0.543",
          remotion: "4.0.543",
          react: "19.2.0",
          "react-dom": "19.2.0",
        },
      },
      null,
      2,
    ),
  );
  await policy.write(
    path.join(output, "README.md"),
    "# Editable MotionForge composition\n\nRun `npm install`, then `npm run studio` or `npm run render`. Edit timeline.json, Root.tsx and public/ assets. The MCP renderer uses its own trusted source; exported TSX edits are only executed by the editor or CLI you launch explicitly. Remotion licensing applies: https://www.remotion.dev/docs/license\n",
  );
  return {
    project: output,
    entry: path.join(output, "Root.tsx"),
    timeline: path.join(output, "timeline.json"),
    ...timelineFacts(timeline),
  };
}

let rendering = false;
let activeCancel: (() => void) | undefined;
export function cancelActiveRender() {
  activeCancel?.();
}

export async function renderVideo(
  policy: Policy,
  inputTimeline: Timeline,
  destination: string,
  onProgress?: (value: number) => void,
  signal?: AbortSignal,
) {
  if (rendering)
    throw new Error(
      "A render is already running. Only one concurrent render is permitted.",
    );
  const timeline = timelineSchema.parse(inputTimeline);
  const configuredSeconds = Number(
    process.env.MOTIONFORGE_RENDER_TIMEOUT_SECONDS ?? 600,
  );
  if (
    !Number.isFinite(configuredSeconds) ||
    configuredSeconds < 10 ||
    configuredSeconds > 1800
  )
    throw new Error(
      "MOTIONFORGE_RENDER_TIMEOUT_SECONDS must be between 10 and 1800.",
    );
  rendering = true;
  const { cancelSignal, cancel } = makeCancelSignal();
  let cancelled = signal?.aborted ?? false;
  const requestCancellation = () => {
    cancelled = true;
    cancel();
  };
  activeCancel = requestCancellation;
  signal?.addEventListener("abort", requestCancellation, { once: true });
  const timer = setTimeout(requestCancellation, configuredSeconds * 1000);
  let partialOutput: string | undefined;
  const checkCancellation = () => {
    if (cancelled)
      throw new Error("Render cancelled or exceeded its configured deadline.");
  };
  try {
    checkCancellation();
    const output = await policy.resolve(destination, true);
    if (path.extname(output).toLowerCase() !== ".mp4")
      throw new Error("Render output must end in .mp4.");
    try {
      await stat(output);
      throw new Error("Output exists; choose a new filename.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const projectDirectory = path.join(
      path.dirname(output),
      `composition-${randomUUID()}`,
    );
    const exported = await exportProject(policy, timeline, projectDirectory);
    checkCancellation();
    const serveUrl = await bundle({
      entryPoint: exported.entry,
      publicDir: path.join(projectDirectory, "public"),
      outDir: path.join(projectDirectory, "bundle"),
      onProgress: checkCancellation,
      enableCaching: false,
      webpackOverride: (configuration) => ({
        ...configuration,
        resolve: {
          ...configuration.resolve,
          modules: [
            path.dirname(path.dirname(require.resolve("react/package.json"))),
            "node_modules",
          ],
        },
      }),
    });
    checkCancellation();
    const browserExecutable = process.env.MOTIONFORGE_BROWSER_PATH;
    const composition = await selectComposition({
      serveUrl,
      id: "MotionForge",
      browserExecutable,
      logLevel: "error",
      timeoutInMilliseconds: 30_000,
    });
    checkCancellation();
    const logs: { progress: number; at: string }[] = [];
    // Render to an unguessable sibling then copy exclusively: a concurrent writer is never overwritten.
    partialOutput = path.join(
      path.dirname(output),
      `.motionforge-${randomUUID()}.mp4`,
    );
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: partialOutput,
      overwrite: false,
      browserExecutable,
      concurrency: 2,
      crf: timeline.crf,
      x264Preset: timeline.encodingPreset,
      pixelFormat: "yuv420p",
      logLevel: "error",
      timeoutInMilliseconds: 30_000,
      cancelSignal,
      offthreadVideoCacheSizeInBytes: 128_000_000,
      onProgress: ({ progress }) => {
        if (
          logs.length === 0 ||
          progress - logs[logs.length - 1]!.progress >= 0.1 ||
          progress === 1
        ) {
          logs.push({ progress, at: new Date().toISOString() });
          onProgress?.(progress);
        }
      },
    });
    checkCancellation();
    await policy.resolve(output, true);
    await copyFile(partialOutput, output, constants.COPYFILE_EXCL);
    const log = await policy.write(
      output + ".render.json",
      JSON.stringify(
        {
          logs,
          crf: timeline.crf,
          encodingPreset: timeline.encodingPreset,
          ...timelineFacts(timeline),
        },
        null,
        2,
      ),
    );
    return {
      video: output,
      editableProject: projectDirectory,
      log,
      metadata: await probe(policy, output),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", requestCancellation);
    activeCancel = undefined;
    if (partialOutput) await rm(partialOutput, { force: true }).catch(() => {});
    rendering = false;
  }
}

export async function probe(policy: Policy, input: string) {
  const media = await mediaInput(policy, input);
  const result = await processMedia("ffprobe", [
    "-v",
    "error",
    ...media.arguments,
    "-show_format",
    "-show_streams",
    "-of",
    "json",
  ]);
  return JSON.parse(result.stdout) as {
    streams: Record<string, any>[];
    format: Record<string, any>;
  };
}

async function boundedMedia(policy: Policy, input: string) {
  const media = await mediaInput(policy, input);
  const metadata = await probe(policy, media.target);
  const duration = Number(metadata.format.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180)
    throw new Error(
      "Media analysis requires a finite duration between 0 and 180 seconds.",
    );
  return { media, metadata };
}

export async function inspectFrames(
  policy: Policy,
  input: string,
  outputDirectory: string,
) {
  const { media } = await boundedMedia(policy, input);
  const output = await policy.resolve(outputDirectory, true);
  await mkdir(path.dirname(output), { recursive: true });
  await policy.resolve(path.dirname(output));
  await mkdir(output, { recursive: false });
  const result = await processMedia("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    ...media.arguments,
    "-vf",
    "blackdetect=d=0.3:pix_th=0.05,freezedetect=n=-60dB:d=2,fps=1/2,scale=480:-2",
    "-frames:v",
    "90",
    path.join(output, "frame-%03d.png"),
  ]);
  return {
    directory: output,
    diagnostics: result.stderr
      .split("\n")
      .filter((line) => /black_start|freeze_start|freeze_end/.test(line)),
    sampling:
      "One frame per two seconds; black/freeze filters inspect decoded frames. Intentional holds/fades may be flagged. Human review required.",
  };
}

export async function inspectAudio(policy: Policy, input: string) {
  const { media, metadata } = await boundedMedia(policy, input);
  if (!metadata.streams.some((stream) => stream.codec_type === "audio"))
    return { hasAudio: false, clipping: null, limitation: "No audio stream." };
  const result = await processMedia("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    ...media.arguments,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const peak = result.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return {
    hasAudio: true,
    peakDb: peak ? Number(peak[1]) : null,
    clippingRisk: peak ? Number(peak[1]) >= 0 : null,
    diagnostics: result.stderr
      .split("\n")
      .filter((line) => /mean_volume|max_volume/.test(line)),
    limitation:
      "Peak measurement indicates risk; it cannot prove audible distortion or mix quality.",
  };
}

export async function validateExport(
  policy: Policy,
  input: string,
  expected?: {
    width?: number;
    height?: number;
    fps?: number;
    durationSeconds?: number;
  },
) {
  const { media, metadata } = await boundedMedia(policy, input);
  const video = metadata.streams.find(
    (stream) => stream.codec_type === "video",
  );
  const issues: string[] = [];
  if (!video) issues.push("Missing video stream.");
  if (video?.codec_name !== "h264") issues.push("Expected H.264 codec.");
  if (expected?.width && video?.width !== expected.width)
    issues.push("Incorrect width.");
  if (expected?.height && video?.height !== expected.height)
    issues.push("Incorrect height.");
  const [numerator, denominator] = String(video?.avg_frame_rate ?? "0/1")
    .split("/")
    .map(Number);
  const fps = numerator! / denominator!;
  if (expected?.fps && Math.abs(fps - expected.fps) > 0.001)
    issues.push("Incorrect frame rate.");
  if (
    expected?.durationSeconds &&
    Math.abs(Number(metadata.format.duration) - expected.durationSeconds) >
      1 / (fps || 30) + 0.05
  )
    issues.push("Incorrect duration.");
  await processMedia("ffmpeg", [
    "-v",
    "error",
    "-xerror",
    "-nostdin",
    ...media.arguments,
    "-f",
    "null",
    "-",
  ]);
  return {
    valid: issues.length === 0,
    issues,
    metadata,
    decode:
      "Entire media stream decoded with FFmpeg -xerror; no decode failures.",
    aestheticAssessment: "Not automated.",
  };
}
