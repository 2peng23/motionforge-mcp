import path from "node:path";
import { stat, mkdir, copyFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { mediaInput, probe } from "../services/video.js";
import { Policy, processMedia } from "../security/policy.js";
export async function importAudio(
  policy: Policy,
  input: string,
  output: string,
  license: string,
) {
  if (license.trim().length < 5)
    throw new Error("Provide license/authorization provenance");
  const media = await mediaInput(policy, input);
  const source = media.target;
  if (![".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(media.extension))
    throw new Error("Unsupported audio type");
  const metadata = await probe(policy, source);
  if (!metadata.streams.some((stream) => stream.codec_type === "audio"))
    throw new Error("Imported file has no valid audio stream");
  const target = await policy.resolve(output, true);
  if (path.extname(target).toLowerCase() !== media.extension)
    throw new Error(
      "Audio import preserves the file format; output extension must match source",
    );
  await policy.write(
    target,
    await import("node:fs/promises").then((files) => files.readFile(source)),
  );
  return { audio: target, license, source };
}
export async function generateVoiceover(
  policy: Policy,
  input: {
    text: string;
    voiceId: string;
    output: string;
    authorizeUpload: boolean;
  },
) {
  if (!input.authorizeUpload)
    throw new Error(
      "Explicit authorizeUpload is required: ElevenLabs receives the script and may charge the account",
    );
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key)
    throw new Error(
      "ELEVENLABS_API_KEY is missing; import local audio instead",
    );
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.voiceId))
    throw new Error("Invalid voice ID");
  const target = await policy.resolve(input.output, true);
  if (!target.endsWith(".mp3"))
    throw new Error("Voiceover output must end in .mp3");
  try {
    await stat(target);
    throw new Error(
      "Voiceover output exists; choose a new filename before authorizing a paid request",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: input.text,
        model_id: "eleven_multilingual_v2",
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw new Error(
      `ElevenLabs returned ${response.status}; check credentials, voice access and account credit`,
    );
  if (
    !response.body ||
    !response.headers.get("content-type")?.toLowerCase().includes("audio/")
  )
    throw new Error("ElevenLabs did not return an audio response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 20_000_000) {
        await reader.cancel();
        throw new Error("Voiceover exceeds 20 MB");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  await policy.write(target, Buffer.concat(chunks));
  return { audio: target, provider: "ElevenLabs", bytes, paidProvider: true };
}
export async function mixAudio(
  policy: Policy,
  tracks: { path: string; gain: number; delayMilliseconds: number }[],
  output: string,
  duration: number,
) {
  const target = await policy.resolve(output, true);
  if (!target.endsWith(".wav")) throw new Error("Mix output must be .wav");
  await mkdir(path.dirname(target), { recursive: true });
  await policy.resolve(path.dirname(target));
  const partial = path.join(path.dirname(target), `mix-${randomUUID()}.wav`);
  const argumentsList = ["-hide_banner", "-nostdin", "-n"];
  for (const track of tracks) {
    const source = await policy.resolve(track.path);
    if (!/\.(mp3|wav|m4a|ogg|flac)$/i.test(source))
      throw new Error("Unsupported track format");
    const media = await mediaInput(policy, source);
    argumentsList.push(...media.arguments);
  }
  const filters =
    tracks
      .map(
        (track, index) =>
          `[${index}:a]volume=${track.gain},adelay=${track.delayMilliseconds}:all=1[a${index}]`,
      )
      .join(";") +
    ";" +
    tracks.map((_, index) => `[a${index}]`).join("") +
    `amix=inputs=${tracks.length}:normalize=0,alimiter=limit=0.95,apad=whole_dur=${duration},atrim=duration=${duration}[mix]`;
  argumentsList.push(
    "-filter_complex",
    filters,
    "-map",
    "[mix]",
    "-t",
    String(duration),
    "-ar",
    "48000",
    "-ac",
    "2",
    partial,
  );
  try {
    await processMedia("ffmpeg", argumentsList);
    await policy.resolve(target, true);
    await copyFile(partial, target, constants.COPYFILE_EXCL);
  } finally {
    await rm(partial, { force: true });
  }
  return { audio: target, tracks: tracks.length, duration, limiter: 0.95 };
}
