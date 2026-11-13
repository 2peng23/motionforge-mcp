import { z } from "zod";
export const shotSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  asset: z.string().optional(),
  assetDurationSeconds: z.number().positive().max(180).optional(),
  kind: z
    .enum(["interface", "typography", "split", "device", "perspective"])
    .default("interface"),
  duration: z.number().min(1).max(30).default(3),
  motion: z.enum(["push", "pan", "reveal", "hold"]).default("push"),
  transition: z.enum(["fade", "wipe", "cut"]).default("fade"),
  evidence: z.string().min(1).max(1000),
});
export const timelineSchema = z
  .object({
    product: z.string().min(1).max(80),
    direction: z
      .enum([
        "cinematic",
        "minimal",
        "futuristic",
        "energetic",
        "editorial",
        "elegant",
        "gaming",
        "corporate",
      ])
      .default("minimal"),
    width: z.number().int().min(320).max(3840).default(1920),
    height: z.number().int().min(320).max(3840).default(1080),
    fps: z.number().int().min(12).max(60).default(30),
    crf: z.number().int().min(0).max(40).default(18),
    encodingPreset: z
      .enum(["ultrafast", "veryfast", "fast", "medium", "slow"])
      .default("medium"),
    background: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#101922"),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#b8ee78"),
    audio: z.string().optional(),
    shots: z.array(shotSchema).min(1).max(30),
  })
  .superRefine((timeline, context) => {
    if (timeline.shots.reduce((sum, shot) => sum + shot.duration, 0) > 180)
      context.addIssue({
        code: "custom",
        message: "Timeline exceeds 180 seconds",
      });
    if (timeline.width % 2 || timeline.height % 2)
      context.addIssue({
        code: "custom",
        message: "H.264 dimensions must be even",
      });
  });
export type Timeline = z.infer<typeof timelineSchema>;
export type Shot = z.infer<typeof shotSchema>;
export function timelineFacts(timeline: Timeline) {
  let frame = 0;
  const scenes = timeline.shots.map((shot) => {
    const start = frame;
    const frames = Math.round(shot.duration * timeline.fps);
    frame += frames;
    return { ...shot, start, frames };
  });
  return {
    scenes,
    durationInFrames: frame,
    durationSeconds: frame / timeline.fps,
    dimensions: [timeline.width, timeline.height],
    fps: timeline.fps,
  };
}
