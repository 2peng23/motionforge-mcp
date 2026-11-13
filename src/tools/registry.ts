import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import path from "node:path";
import { stat, copyFile, mkdir, readdir } from "node:fs/promises";
import { Policy, redact } from "../security/policy.js";
import { analyzeProject } from "../services/discovery.js";
import { capture, captureSchema } from "../services/capture.js";
import { detectClipping } from "../services/layout-qa.js";
import {
  timelineSchema,
  shotSchema,
  timelineFacts,
  type Timeline,
} from "../schemas/timeline.js";
import {
  exportProject,
  renderVideo,
  loadTimeline,
  probe,
  inspectFrames,
  inspectAudio,
  validateExport,
} from "../services/video.js";
import {
  importAudio,
  generateVoiceover,
  mixAudio,
} from "../providers/audio.js";
export const toolCatalog: { name: string; description: string }[] = [];
export function createServer(policy: Policy) {
  const server = new McpServer({ name: "motionforge-mcp", version: "0.1.0" });
  function tool<Schema extends z.ZodObject>(
    name: string,
    description: string,
    schema: Schema,
    handler: (
      input: z.output<Schema>,
      signal: AbortSignal,
    ) => Promise<unknown> | unknown,
    readOnly = true,
  ) {
    toolCatalog.push({ name, description });
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema as z.ZodObject,
        outputSchema: z.object({ result: z.unknown() }),
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: readOnly,
          openWorldHint: name === "generate_voiceover",
        },
      },
      async (input, context) => {
        try {
          const result = JSON.parse(
            redact(
              JSON.stringify(
                await handler(input as z.output<Schema>, context.mcpReq.signal),
              ),
            ),
          );
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result, null, 2) },
            ],
            structuredContent: { result },
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: redact(
                  error instanceof Error ? error.message : String(error),
                ),
              },
            ],
          };
        }
      },
    );
  }
  const projectSchema = z.object({ project: z.string() });
  tool(
    "analyze_project",
    "Inspect bounded source inventory, framework, scripts, route evidence, assets and branding.",
    projectSchema,
    (input) => analyzeProject(policy, input.project),
  );
  tool(
    "discover_routes",
    "Find filesystem route candidates with source paths and explicit inference confidence.",
    projectSchema,
    async (input) => (await analyzeProject(policy, input.project)).routes,
  );
  tool(
    "detect_brand_identity",
    "Extract existing source colors, font declarations and real headings without inventing branding.",
    projectSchema,
    async (input) => (await analyzeProject(policy, input.project)).brand,
  );
  tool(
    "analyze_user_flows",
    "Return actual route evidence for a client to author flows. Static scanning cannot verify runtime journeys.",
    projectSchema,
    async (input) => {
      const project = await analyzeProject(policy, input.project);
      return {
        routes: project.routes,
        links: project.links,
        headings: project.brand.headings,
        unverifiedTransitions: true,
        verification:
          "Use capture_user_flow with explicit actions to verify a journey.",
      };
    },
  );
  tool(
    "inspect_media_assets",
    "Inventory local image, font, video and audio assets and byte sizes.",
    projectSchema,
    async (input) => (await analyzeProject(policy, input.project)).assets,
  );
  tool(
    "prepare_capture_environment",
    "Check project commands and capture URL; does not execute arbitrary project scripts or start a server.",
    projectSchema,
    async (input) => {
      const project = await analyzeProject(policy, input.project);
      return {
        frameworks: project.frameworks,
        commands: project.commands,
        serverStarted: false,
        instruction:
          "Ask the user before running a development command in their project. Start it outside this server; provide its authorized localhost URL to capture_page.",
        browserExecutable:
          process.env.MOTIONFORGE_BROWSER_PATH ??
          "Playwright installed Chromium (npx playwright install chromium)",
        roots: policy.roots,
      };
    },
  );
  tool(
    "capture_page",
    "Capture authentic screenshot in isolated browser; fields/private elements masked and third-party requests blocked.",
    captureSchema,
    (input) => capture(policy, input),
    false,
  );
  tool(
    "capture_user_flow",
    "Execute explicitly authorized bounded actions and capture the final real page state.",
    captureSchema,
    (input) => capture(policy, input),
    false,
  );
  tool(
    "record_browser_interaction",
    "Record real browser interactions through continuously masked screenshots, cursor choreography and measured frame timing; exports local MP4.",
    captureSchema,
    (input) => capture(policy, { ...input, record: true }),
    false,
  );
  tool(
    "capture_responsive_screens",
    "Capture an explicitly chosen responsive viewport matrix.",
    z.object({
      url: z.string().url(),
      outputDirectory: z.string(),
      widths: z
        .array(z.number().int().min(320).max(3840))
        .min(1)
        .max(10)
        .default([390, 768, 1440]),
      height: z.number().int().min(320).max(2160).default(900),
    }),
    async (input) => {
      const output = await policy.resolve(input.outputDirectory, true);
      await mkdir(output, { recursive: true });
      const screenshots = [];
      for (const width of input.widths)
        screenshots.push(
          await capture(
            policy,
            captureSchema.parse({
              url: input.url,
              width,
              height: input.height,
              output: path.join(output, `${width}.png`),
            }),
          ),
        );
      return { screenshots };
    },
    false,
  );
  tool(
    "inspect_animation_opportunities",
    "Inspect actual headings, links, overflow and Web Animations timing for motion planning; writes evidence screenshot.",
    captureSchema,
    (input) => capture(policy, input),
    false,
  );
  const briefSchema = z.object({
    project: z.string(),
    audience: z.string().min(1).max(500),
    goal: z.string().min(1).max(500),
    direction: timelineSchema.shape.direction,
    language: z.enum(["English", "Filipino", "Taglish"]).default("English"),
  });
  tool(
    "generate_creative_brief",
    "Build an evidence-grounded creative brief from source identity, actual routes and explicit audience/goal.",
    briefSchema,
    async (input) => {
      const project = await analyzeProject(policy, input.project);
      return {
        product: project.name,
        audience: input.audience,
        goal: input.goal,
        direction: input.direction,
        language: input.language,
        identity: project.brand,
        evidence: project.routes,
        narrative: [
          "Establish identity",
          "Demonstrate a verified workflow",
          "End with user-supplied call to action",
        ],
        motion: {
          minimal: "Long holds, precise reveal, restrained camera",
          cinematic: "Measured push-ins and controlled contrast",
          futuristic: "Perspective interface reveal and crisp typography",
          energetic: "Shorter readable holds and directional wipes",
          editorial: "Typographic hierarchy and deliberate cuts",
          elegant: "Subtle pans and generous negative space",
          gaming: "Confident cuts and layered screen movement",
          corporate: "Clear hierarchy and steady demonstration",
        }[input.direction],
        requiresClientDirection: true,
        limitation:
          "No autonomous claims of shipped capabilities; client must verify route behavior and author final copy.",
      };
    },
  );
  tool(
    "generate_storyboard",
    "Validate evidence-bound shots and persist a real renderable timeline. Client supplies product claims and screenshots.",
    z.object({ timeline: timelineSchema, output: z.string() }),
    async (input) => ({
      timeline: await policy.write(
        input.output,
        JSON.stringify(input.timeline, null, 2),
      ),
      ...timelineFacts(input.timeline),
    }),
    false,
  );
  const timelineInput = z.object({ timeline: z.string() });
  tool(
    "create_scene_plan",
    "Calculate exact scene frame ranges from a validated timeline.",
    timelineInput,
    async (input) => timelineFacts(await loadTimeline(policy, input.timeline)),
  );
  tool(
    "analyze_visual_rhythm",
    "Measure shot lengths, repetition and readability timing without inventing aesthetic scores.",
    timelineInput,
    async (input) => {
      const timeline = await loadTimeline(policy, input.timeline);
      const durations = timeline.shots.map((shot) => shot.duration);
      return {
        durations,
        mean:
          durations.reduce((sum, value) => sum + value, 0) / durations.length,
        warnings: timeline.shots.flatMap((shot, index) => {
          const warnings: string[] = [];
          if (shot.title.split(/\s+/).length / 3 > shot.duration - 0.8)
            warnings.push(
              `Shot ${index + 1}: title may exceed 180 words/min readable hold`,
            );
          if (
            index > 1 &&
            shot.motion === timeline.shots[index - 1]?.motion &&
            shot.motion === timeline.shots[index - 2]?.motion
          )
            warnings.push(
              `Shot ${index + 1}: three repeated camera treatments`,
            );
          return warnings;
        }),
        subjectiveReviewRequired: true,
      };
    },
  );
  tool(
    "plan_transitions",
    "Return implemented transition types with their timeline positions; no random transition assignment.",
    timelineInput,
    async (input) => {
      const timeline = await loadTimeline(policy, input.timeline);
      return timelineFacts(timeline).scenes.map((scene) => ({
        start: scene.start,
        type: scene.transition,
        frames: scene.transition === "cut" ? 0 : Math.round(timeline.fps * 0.5),
      }));
    },
  );
  tool(
    "generate_remotion_project",
    "Export actual editable React/Remotion source, validated timeline and local assets.",
    z.object({ timeline: z.string(), outputDirectory: z.string() }),
    async (input) =>
      exportProject(
        policy,
        await loadTimeline(policy, input.timeline),
        input.outputDirectory,
      ),
    false,
  );
  tool(
    "create_motion_scene",
    "Validate and append a real shot to a new timeline file; no destructive overwrite.",
    z.object({ timeline: z.string(), shot: shotSchema, output: z.string() }),
    async (input) => {
      const timeline = await loadTimeline(policy, input.timeline);
      timeline.shots.push(input.shot);
      const valid = timelineSchema.parse(timeline);
      return {
        timeline: await policy.write(
          input.output,
          JSON.stringify(valid, null, 2),
        ),
        ...timelineFacts(valid),
      };
    },
    false,
  );
  const modifySchema = z.object({
    timeline: z.string(),
    shotIndex: z.number().int().min(0).max(29),
    output: z.string(),
  });
  async function modify(
    input: z.infer<typeof modifySchema>,
    patch: Record<string, unknown>,
  ) {
    const timeline = await loadTimeline(policy, input.timeline);
    if (!timeline.shots[input.shotIndex])
      throw new Error("Shot index does not exist");
    Object.assign(timeline.shots[input.shotIndex]!, patch);
    const valid = timelineSchema.parse(timeline);
    return {
      timeline: await policy.write(
        input.output,
        JSON.stringify(valid, null, 2),
      ),
      shot: valid.shots[input.shotIndex],
    };
  }
  tool(
    "animate_product_interface",
    "Set implemented push, pan, reveal or hold choreography on a real timeline shot.",
    modifySchema.extend({ motion: shotSchema.shape.motion }),
    (input) => modify(input, { motion: input.motion }),
    false,
  );
  tool(
    "create_typography_animation",
    "Create frame-driven typography reveal on a selected shot.",
    modifySchema,
    (input) => modify(input, { kind: "typography", motion: "reveal" }),
    false,
  );
  tool(
    "create_camera_movement",
    "Apply deterministic camera motion to an existing scene.",
    modifySchema.extend({ motion: shotSchema.shape.motion }),
    (input) => modify(input, { motion: input.motion }),
    false,
  );
  tool(
    "create_transition",
    "Apply a supported fade, wipe or cut transition in a new timeline.",
    modifySchema.extend({ transition: shotSchema.shape.transition }),
    (input) => modify(input, { transition: input.transition }),
    false,
  );
  tool(
    "generate_device_mockup",
    "Frame an actual screenshot with an animated device border; no stock device download.",
    modifySchema,
    (input) => modify(input, { kind: "device" }),
    false,
  );
  tool(
    "generate_3d_scene",
    "Apply deterministic CSS perspective rotation to a product screen. No mesh/Three.js scene generation.",
    modifySchema,
    (input) => modify(input, { kind: "perspective" }),
    false,
  );
  tool(
    "generate_voiceover_script",
    "Create a timed script from client-authored evidence-bound scene copy; preserves provided language.",
    timelineInput,
    async (input) => {
      const timeline = await loadTimeline(policy, input.timeline);
      return {
        segments: timelineFacts(timeline).scenes.map((scene) => ({
          startSeconds: scene.start / timeline.fps,
          endSeconds: (scene.start + scene.frames) / timeline.fps,
          text: [scene.title, scene.description].filter(Boolean).join(". "),
          evidence: scene.evidence,
        })),
        language:
          "Preserved from user-authored scene text. No automatic translation.",
        reviewRequired: true,
      };
    },
  );
  tool(
    "generate_voiceover",
    "Optionally synthesize supplied text with ElevenLabs. Explicit upload permission and paid account credentials required.",
    z.object({
      text: z.string().min(1).max(5000),
      voiceId: z.string(),
      output: z.string(),
      authorizeUpload: z.boolean().default(false),
    }),
    (input) => generateVoiceover(policy, input),
    false,
  );
  tool(
    "import_audio",
    "Copy a local authorized music/voice track with license provenance.",
    z.object({
      input: z.string(),
      output: z.string(),
      license: z.string().min(5).max(2000),
    }),
    (input) => importAudio(policy, input.input, input.output, input.license),
    false,
  );
  tool(
    "plan_sound_design",
    "Calculate scene boundaries and audio cue windows from actual timeline without downloading music.",
    timelineInput,
    async (input) => {
      const timeline = await loadTimeline(policy, input.timeline);
      return {
        cues: timelineFacts(timeline).scenes.map((scene) => ({
          time: scene.start / timeline.fps,
          role:
            scene.transition === "cut"
              ? "Optional restrained cut accent"
              : "Optional transition texture",
          duration: 0.3,
        })),
        voicePriority: true,
        music: timeline.audio ?? null,
        authorization: "Only use tracks whose license you have verified.",
      };
    },
  );
  tool(
    "sync_audio_timeline",
    "Attach an authorized local audio file to an exported timeline.",
    z.object({ timeline: z.string(), audio: z.string(), output: z.string() }),
    async (input) => {
      await probe(policy, input.audio);
      const timeline = await loadTimeline(policy, input.timeline);
      timeline.audio = await policy.resolve(input.audio);
      return {
        timeline: await policy.write(
          input.output,
          JSON.stringify(timeline, null, 2),
        ),
        duration: timelineFacts(timeline).durationSeconds,
      };
    },
    false,
  );
  tool(
    "mix_audio",
    "Mix real local tracks with bounded gain/delay and output limiter via FFmpeg.",
    z.object({
      tracks: z
        .array(
          z.object({
            path: z.string(),
            gain: z.number().min(0).max(2).default(1),
            delayMilliseconds: z.number().int().min(0).max(180000).default(0),
          }),
        )
        .min(1)
        .max(8),
      output: z.string(),
      duration: z.number().min(1).max(180),
    }),
    (input) => mixAudio(policy, input.tracks, input.output, input.duration),
    false,
  );
  tool(
    "configure_render",
    "Validate and save dimensions, frame rate, duration and encoding configuration as a renderable timeline.",
    z.object({ timeline: timelineSchema, output: z.string() }),
    async (input) => ({
      timeline: await policy.write(
        input.output,
        JSON.stringify(input.timeline, null, 2),
      ),
      ...timelineFacts(input.timeline),
    }),
    false,
  );
  tool(
    "render_video",
    "Render a bounded real H.264 MP4 with Remotion and retain editable project and progress log.",
    z.object({ timeline: z.string(), output: z.string() }),
    async (input, signal) =>
      renderVideo(
        policy,
        await loadTimeline(policy, input.timeline),
        input.output,
        (value) => console.error(`[render] ${Math.round(value * 100)}%`),
        signal,
      ),
    false,
  );
  tool(
    "inspect_render",
    "Read actual FFprobe streams and container metadata.",
    z.object({ input: z.string() }),
    (input) => probe(policy, input.input),
  );
  tool(
    "export_project",
    "Export a standalone editable Remotion project with source assets and npm manifest.",
    z.object({ timeline: z.string(), outputDirectory: z.string() }),
    async (input) =>
      exportProject(
        policy,
        await loadTimeline(policy, input.timeline),
        input.outputDirectory,
      ),
    false,
  );
  tool(
    "export_video",
    "Validate the complete video stream before copying a local MP4 artifact.",
    z.object({ input: z.string(), output: z.string() }),
    async (input) => {
      const valid = await validateExport(policy, input.input);
      if (!valid.valid) throw new Error(valid.issues.join("; "));
      const source = await policy.resolve(input.input);
      const target = await policy.resolve(input.output, true);
      await policy.write(
        target,
        await import("node:fs/promises").then((files) =>
          files.readFile(source),
        ),
      );
      return { video: target, validation: valid };
    },
    false,
  );
  tool(
    "validate_timeline",
    "Validate schema, timings, local assets and bounds before rendering.",
    timelineInput,
    async (input) => {
      const timeline = await loadTimeline(policy, input.timeline);
      for (const shot of timeline.shots)
        if (shot.asset) await policy.resolve(shot.asset);
      if (timeline.audio) await policy.resolve(timeline.audio);
      return { valid: true, ...timelineFacts(timeline) };
    },
  );
  tool(
    "analyze_rendered_frames",
    "Decode the video; run black/freeze detection and export sampled thumbnails for human review.",
    z.object({ input: z.string(), outputDirectory: z.string() }),
    (input) => inspectFrames(policy, input.input, input.outputDirectory),
    false,
  );
  tool(
    "detect_clipping",
    "Measure actual composition text bounds and clipping ancestors in Chrome at each scene midpoint; excludes text inside screenshots/video. Temporary QA files are cleaned up.",
    timelineInput,
    (input, signal) => detectClipping(policy, input.timeline, signal),
    false,
  );
  tool(
    "inspect_audio_levels",
    "Measure actual FFmpeg peak/mean levels and report clipping risk.",
    z.object({ input: z.string() }),
    (input) => inspectAudio(policy, input.input),
  );
  tool(
    "validate_export",
    "Fully decode exported media and verify codec and optional dimensions.",
    z.object({
      input: z.string(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      fps: z.number().optional(),
      durationSeconds: z.number().optional(),
    }),
    (input) =>
      validateExport(policy, input.input, {
        width: input.width,
        height: input.height,
        fps: input.fps,
        durationSeconds: input.durationSeconds,
      }),
  );
  tool(
    "generate_quality_report",
    "Persist measured decode/stream/audio checks and explicit manual review requirements.",
    z.object({ input: z.string(), output: z.string() }),
    async (input) => {
      const result = {
        validation: await validateExport(policy, input.input),
        audio: await inspectAudio(policy, input.input),
        manualReview: [
          "Review all typography and authentic product claims",
          "Watch transitions and movement continuously",
          "Listen to voice/music balance and verify rights",
          "Check personal information in captures",
        ],
        professionalQualityClaim: false,
      };
      await policy.write(input.output, JSON.stringify(result, null, 2));
      return { report: input.output, ...result };
    },
    false,
  );
  return server;
}
