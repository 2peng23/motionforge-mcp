import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  openBrowser,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { z } from "zod";
import { Policy } from "../security/policy.js";
import { timelineFacts } from "../schemas/timeline.js";
import { exportProject, loadTimeline } from "./video.js";

const require = createRequire(import.meta.url);
const prefix = "MOTIONFORGE_LAYOUT_QA:";
const rectangleSchema = z.object({
  left: z.number().finite(),
  top: z.number().finite(),
  right: z.number().finite(),
  bottom: z.number().finite(),
});
const measurementSchema = z.object({
  sceneIndex: z.number().int().min(0).max(29),
  frame: z.number().int().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  elements: z
    .array(
      z.object({
        role: z.string().max(40),
        bounds: rectangleSchema,
        lineBoxes: z.number().int().min(0),
        fontSize: z.number().finite(),
        clippingAncestors: z.array(rectangleSchema).max(10),
      }),
    )
    .max(20),
});
type Rectangle = z.infer<typeof rectangleSchema>;
type Measurement = z.infer<typeof measurementSchema>;

function outside(bounds: Rectangle, container: Rectangle) {
  const tolerance = 1;
  return (
    bounds.left < container.left - tolerance ||
    bounds.top < container.top - tolerance ||
    bounds.right > container.right + tolerance ||
    bounds.bottom > container.bottom + tolerance
  );
}

let checking = false;

/** Measure trusted, generated composition text in Chrome; never accepts arbitrary source. */
export async function detectClipping(
  policy: Policy,
  timelinePath: string,
  signal?: AbortSignal,
) {
  if (checking)
    throw new Error("A composition layout check is already running.");
  checking = true;
  let temporary: string | undefined;
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  const { cancel, cancelSignal } = makeCancelSignal();
  let cancelled = signal?.aborted ?? false;
  const stop = () => {
    cancelled = true;
    cancel();
    void browser?.close({ silent: true }).catch(() => {});
  };
  signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, 120_000);
  const ensureActive = () => {
    if (cancelled)
      throw new Error(
        "Composition layout check cancelled or exceeded its 120-second deadline.",
      );
  };
  try {
    ensureActive();
    const source = await policy.resolve(timelinePath);
    const timeline = await loadTimeline(policy, source);
    const facts = timelineFacts(timeline);
    temporary = await policy.resolve(
      path.join(path.dirname(source), `.motionforge-layout-${randomUUID()}`),
      true,
    );
    const exported = await exportProject(policy, timeline, temporary);
    ensureActive();
    const serveUrl = await bundle({
      entryPoint: exported.entry,
      publicDir: path.join(temporary, "public"),
      outDir: path.join(temporary, "bundle"),
      enableCaching: false,
      onProgress: ensureActive,
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
    ensureActive();
    browser = await openBrowser("chrome", {
      browserExecutable: process.env.MOTIONFORGE_BROWSER_PATH,
      logLevel: "error",
    });
    ensureActive();
    const composition = await selectComposition({
      serveUrl,
      id: "MotionForge",
      inputProps: { layoutQa: true },
      puppeteerInstance: browser,
      logLevel: "error",
      timeoutInMilliseconds: 15_000,
    });
    const safeArea = {
      left: timeline.width * 0.06,
      top: timeline.height * 0.03,
      right: timeline.width * 0.94,
      bottom: timeline.height * 0.97,
    };
    const samples: {
      sceneIndex: number;
      globalFrame: number;
      measurement: Measurement;
    }[] = [];
    for (let sceneIndex = 0; sceneIndex < facts.scenes.length; sceneIndex++) {
      ensureActive();
      const scene = facts.scenes[sceneIndex]!;
      // Midpoint excludes intentional entry/exit reveals; no all-frame guarantee is implied.
      const localFrame = Math.floor(scene.frames / 2);
      let measured: Measurement | undefined;
      await renderStill({
        composition,
        serveUrl,
        frame: scene.start + localFrame,
        inputProps: { layoutQa: true },
        puppeteerInstance: browser,
        output: path.join(temporary, `sample-${sceneIndex}.png`),
        imageFormat: "png",
        logLevel: "error",
        timeoutInMilliseconds: 15_000,
        cancelSignal,
        onBrowserLog: (message) => {
          if (!message.text.startsWith(prefix) || message.text.length > 100_000)
            return;
          try {
            const parsed = measurementSchema.safeParse(
              JSON.parse(message.text.slice(prefix.length)),
            );
            if (
              parsed.success &&
              parsed.data.sceneIndex === sceneIndex &&
              parsed.data.frame === localFrame
            )
              measured = parsed.data;
          } catch {
            /* Unrelated browser logs are not layout evidence. */
          }
        },
      });
      ensureActive();
      if (!measured || !measured.elements.length)
        throw new Error(
          `No DOM layout evidence received for scene ${sceneIndex + 1}; no clipping result can be claimed.`,
        );
      samples.push({
        sceneIndex,
        globalFrame: scene.start + localFrame,
        measurement: measured,
      });
    }
    const issues = samples.flatMap((sample) =>
      sample.measurement.elements.flatMap((element) => {
        if (!element.lineBoxes) return [];
        const evidence = {
          sceneIndex: sample.sceneIndex,
          frame: sample.globalFrame,
          role: element.role,
          bounds: element.bounds,
        };
        return [
          ...(outside(element.bounds, safeArea)
            ? [
                {
                  ...evidence,
                  kind: "safe-area-overflow" as const,
                  container: safeArea,
                },
              ]
            : []),
          ...element.clippingAncestors
            .filter((container) => outside(element.bounds, container))
            .slice(0, 1)
            .map((container) => ({
              ...evidence,
              kind: "ancestor-clipping" as const,
              container,
            })),
        ];
      }),
    );
    return {
      validAtSampledFrames: issues.length === 0,
      issues,
      safeArea,
      sampledFrames: samples.map((sample) => ({
        sceneIndex: sample.sceneIndex,
        frame: sample.globalFrame,
        elements: sample.measurement.elements,
      })),
      method:
        "Chrome DOM TextRange bounds at one midpoint per scene; 1px tolerance; composition-authored text only.",
      limits: [
        "Does not OCR text inside captured screenshots or video.",
        "Does not inspect every animation frame or interpret clip-path masks.",
        "Safe area uses 6% horizontal and 3% vertical margins; typography readability and intentional framing need visual review.",
        "Temporary sample images and editable QA project are removed after measurement.",
      ],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    try {
      await browser?.close({ silent: true }).catch(() => {});
      if (temporary) await rm(temporary, { recursive: true, force: true });
    } finally {
      checking = false;
    }
  }
}
