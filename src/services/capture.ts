import { chromium, type Page } from "playwright";
import { mkdir, rm, stat, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { Policy, processMedia, redact } from "../security/policy.js";
import { z } from "zod";

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: z.string().min(1).max(300) }),
  z.object({ type: z.literal("hover"), selector: z.string().min(1).max(300) }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().min(1).max(300),
    value: z.string().max(500),
  }),
  z.object({
    type: z.literal("move"),
    x: z.number().min(0).max(3840),
    y: z.number().min(0).max(2160),
    steps: z.number().int().min(1).max(60).default(20),
  }),
  z.object({
    type: z.literal("scroll"),
    y: z.number().int().min(0).max(30000),
  }),
  z.object({
    type: z.literal("wait"),
    milliseconds: z.number().int().min(0).max(5000),
  }),
]);

export const captureSchema = z.object({
  url: z.string().url(),
  output: z.string(),
  width: z.number().int().min(320).max(3840).default(1440),
  height: z.number().int().min(320).max(2160).default(900),
  fullPage: z.boolean().default(false),
  waitMilliseconds: z.number().int().min(0).max(5000).default(200),
  actions: z.array(actionSchema).max(30).default([]),
  allowInteractions: z.boolean().default(false),
  record: z.boolean().default(false),
  recordFps: z.number().int().min(6).max(24).default(12),
  recordMaxSeconds: z.number().int().min(2).max(30).default(30),
  showCursor: z.boolean().default(true),
});
export type CaptureInput = z.infer<typeof captureSchema>;

function allowedHost(url: URL): boolean {
  const hosts = (
    process.env.MOTIONFORGE_ALLOWED_HOSTS ?? "localhost,127.0.0.1,[::1]"
  )
    .split(",")
    .map((value) => value.trim());
  return (
    ["http:", "https:"].includes(url.protocol) &&
    hosts.includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}

function safeUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return "[non-http link]";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return redact(url.href);
  } catch {
    return "[invalid URL]";
  }
}

async function sanitize(page: Page) {
  await page.evaluate(() => {
    if (!document.body) return;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest("script,style")) continue;
      const before = node.textContent ?? "";
      const after = before
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
        .replace(
          /(?:Bearer\s+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*)[\w.+/=-]+/gi,
          "[redacted secret]",
        )
        .replace(/\bsk[-_][a-z0-9_-]{12,}\b/gi, "[redacted secret]");
      if (before !== after) node.textContent = after;
    }
  });
}

async function installCursor(page: Page) {
  await page.evaluate(() => {
    if (document.querySelector("[data-motionforge-cursor]")) return;
    const cursor = document.createElement("div");
    cursor.dataset.motionforgeCursor = "true";
    cursor.style.cssText =
      "position:fixed;left:24px;top:24px;width:20px;height:28px;z-index:2147483647;pointer-events:none;background:white;filter:drop-shadow(1px 2px 2px #0008);clip-path:polygon(0 0,0 88%,24% 66%,42% 100%,58% 92%,40% 58%,80% 58%);";
    document.documentElement.append(cursor);
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    });
  });
}

async function assertNewArtifact(policy: Policy, destination: string) {
  const target = await policy.resolve(destination, true);
  try {
    await stat(target);
    throw new Error("Capture output exists; choose a new filename.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

const maskSelector =
  "input,textarea,select,[contenteditable],[data-private],[data-sensitive],iframe,frame";
let capturing = false;
let activeBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
export function cancelActiveCapture(): void {
  void activeBrowser?.close();
}

export async function capture(policy: Policy, suppliedInput: CaptureInput) {
  if (capturing)
    throw new Error("A capture is already running; retry after it finishes.");
  capturing = true;
  try {
    return await performCapture(policy, suppliedInput);
  } finally {
    capturing = false;
    activeBrowser = undefined;
  }
}

async function performCapture(policy: Policy, suppliedInput: CaptureInput) {
  const input = captureSchema.parse(suppliedInput);
  const url = new URL(input.url);
  if (!allowedHost(url))
    throw new Error(
      "Capture host is not authorized. Localhost is allowed; explicitly configure any other host in MOTIONFORGE_ALLOWED_HOSTS.",
    );
  if (input.actions.length && !input.allowInteractions)
    throw new Error(
      "Set allowInteractions only after authorizing these browser actions.",
    );
  if (input.record && input.width * input.height > 4_000_000)
    throw new Error("Recording is limited to a viewport of four megapixels.");
  const output = await assertNewArtifact(policy, input.output);
  if (path.extname(output).toLowerCase() !== ".png")
    throw new Error("Screenshot output must end in .png.");
  const videoOutput = input.record
    ? await assertNewArtifact(policy, output.replace(/\.png$/i, ".mp4"))
    : undefined;
  await mkdir(path.dirname(output), { recursive: true });
  await policy.resolve(path.dirname(output));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let frameDirectory: string | undefined;
  let sampler: Promise<void> | undefined;
  let stopSampling = false;
  let samplingError: unknown;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    stopSampling = true;
    void browser?.close().catch(() => {});
  }, 90_000);
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.MOTIONFORGE_BROWSER_PATH
        ? { executablePath: process.env.MOTIONFORGE_BROWSER_PATH }
        : {}),
    });
    activeBrowser = browser;
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: input.record ? "no-preference" : "reduce",
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", (route) => {
      try {
        const destination = new URL(route.request().url());
        return allowedHost(destination) && destination.origin === url.origin
          ? route.continue()
          : route.abort();
      } catch {
        return route.abort();
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("dialog", (dialog) => {
      void dialog.dismiss();
    });
    page.on("popup", (popup) => {
      void popup.close();
    });
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(input.waitMilliseconds);
    await sanitize(page);
    if (input.record && input.showCursor) {
      await installCursor(page);
    }
    const samples: { name: string; at: number }[] = [];
    let frameBytes = 0;
    const recordingStart = performance.now();
    if (input.record) {
      frameDirectory = await policy.resolve(
        path.join(path.dirname(output), `.motionforge-frames-${randomUUID()}`),
        true,
      );
      await mkdir(frameDirectory);
      const directory = frameDirectory;
      sampler = (async () => {
        while (!stopSampling) {
          const started = performance.now();
          if (
            started - recordingStart > input.recordMaxSeconds * 1000 ||
            samples.length >= 480 ||
            frameBytes > 512_000_000
          ) {
            throw new Error(
              "Recording reached its time, frame, or disk limit. Reduce the flow or viewport.",
            );
          }
          let pixels: Buffer;
          try {
            await sanitize(page);
            if (input.showCursor) await installCursor(page);
            pixels = await page.screenshot({
              animations: "allow",
              mask: [page.locator(maskSelector)],
              maskColor: "#343d42",
            });
          } catch (error) {
            if (
              !page.isClosed() &&
              /navigation|execution context|frame was detached/i.test(
                String(error),
              )
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              continue;
            }
            throw error;
          }
          const name = `frame-${String(samples.length).padStart(6, "0")}.png`;
          await policy.write(path.join(directory, name), pixels);
          samples.push({ name, at: started - recordingStart });
          frameBytes += pixels.length;
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.max(
                1,
                1000 / input.recordFps - (performance.now() - started),
              ),
            ),
          );
        }
      })().catch((error) => {
        samplingError = error;
        stopSampling = true;
      });
    }
    for (const action of input.actions) {
      if (samplingError) throw samplingError;
      if (action.type === "move") {
        if (action.x > input.width || action.y > input.height)
          throw new Error("Cursor coordinates exceed the capture viewport.");
        await page.mouse.move(action.x, action.y, { steps: action.steps });
      } else if (action.type === "scroll")
        await page.evaluate(
          (y) => scrollTo({ top: y, behavior: "smooth" }),
          action.y,
        );
      else if (action.type === "wait")
        await page.waitForTimeout(action.milliseconds);
      else {
        const locator = page.locator(action.selector);
        if (action.type === "fill") {
          if (
            /@|(?:\d[ -]?){10,}|password|secret|token|sk[_-]/i.test(
              action.value,
            )
          )
            throw new Error(
              "Sensitive-looking form values are prohibited. Use synthetic demo data.",
            );
          const description = await locator.evaluate((element) =>
            [
              element.tagName,
              element.getAttribute("type"),
              element.getAttribute("name"),
              element.getAttribute("id"),
              element.getAttribute("autocomplete"),
            ].join(" "),
          );
          if (
            /password|email|tel|credit|card|cc-|token|secret|ssn/i.test(
              description,
            )
          )
            throw new Error("Sensitive fields cannot be filled for capture.");
          await locator.fill(action.value);
        } else if (action.type === "click") await locator.click();
        else await locator.hover();
      }
    }
    if (input.record) await page.waitForTimeout(600);
    stopSampling = true;
    await sampler;
    if (samplingError) throw samplingError;
    await sanitize(page);
    if (input.fullPage) {
      const area = await page.evaluate(
        () =>
          document.documentElement.scrollWidth *
          document.documentElement.scrollHeight,
      );
      if (area > 40_000_000)
        throw new Error(
          "Full-page capture exceeds the 40-megapixel limit. Capture a viewport instead.",
        );
    }
    const screenshot = await page.screenshot({
      fullPage: input.fullPage,
      animations: "disabled",
      mask: [page.locator(maskSelector)],
      maskColor: "#343d42",
    });
    await policy.write(output, screenshot);
    const evidence = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      headings: Array.from(document.querySelectorAll("h1,h2"))
        .map((element) => element.textContent?.trim())
        .slice(0, 30),
      links: Array.from(document.querySelectorAll("a[href]"))
        .map((element) => ({
          text: element.textContent?.trim(),
          href: element.getAttribute("href"),
        }))
        .slice(0, 50),
      overflow: document.documentElement.scrollWidth > innerWidth,
      animations: document
        .getAnimations()
        .slice(0, 100)
        .map((animation) => ({
          playState: animation.playState,
          timing: animation.effect?.getComputedTiming(),
        })),
    }));
    const safeEvidence = JSON.parse(
      redact(
        JSON.stringify({
          ...evidence,
          url: safeUrl(evidence.url, url.href),
          links: evidence.links.map((link) => ({
            ...link,
            href: safeUrl(link.href ?? "", url.href),
          })),
        }),
      ),
    );
    await context.close();
    let recording:
      | {
          requestedFps: number;
          sampledFrames: number;
          durationSeconds: number;
          timing: string;
        }
      | undefined;
    if (frameDirectory && videoOutput && samples.length) {
      const duration = samples[samples.length - 1]!.at + 1000 / input.recordFps;
      const manifest =
        samples
          .map(
            (sample, index) =>
              `file '${sample.name}'\nduration ${Math.max(0.001, ((samples[index + 1]?.at ?? duration) - sample.at) / 1000).toFixed(6)}\n`,
          )
          .join("") + `file '${samples[samples.length - 1]!.name}'\n`;
      const manifestPath = await policy.write(
        path.join(frameDirectory, "frames.txt"),
        manifest,
      );
      // The concat list is server-authored and contains only fixed, relative frame filenames from this isolated directory.
      await processMedia("ffmpeg", [
        "-hide_banner",
        "-nostdin",
        "-n",
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        manifestPath,
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        path.join(frameDirectory, "recording.mp4"),
      ]);
      await policy.resolve(videoOutput, true);
      await copyFile(
        path.join(frameDirectory, "recording.mp4"),
        videoOutput,
        constants.COPYFILE_EXCL,
      );
      recording = {
        requestedFps: input.recordFps,
        sampledFrames: samples.length,
        durationSeconds: duration / 1000,
        timing:
          "Continuous masked browser screenshots during real actions; measured sample intervals preserved, encoded at 30 fps. Capture cadence depends on local screenshot performance.",
      };
    }
    return {
      screenshot: output,
      video: videoOutput,
      recording,
      viewport: { width: input.width, height: input.height },
      evidence: safeEvidence,
      privacy:
        "Fresh isolated browser; same-origin network only; all form fields, embedded frames and marked private elements masked on every frame. Use synthetic data: arbitrary personal text, images and third-party embedded content need human review.",
    };
  } catch (error) {
    if (timedOut)
      throw new Error(
        "Browser capture exceeded its 90-second execution deadline.",
      );
    throw error;
  } finally {
    clearTimeout(deadline);
    stopSampling = true;
    await sampler;
    await browser?.close();
    if (frameDirectory)
      await rm(frameDirectory, { recursive: true, force: true });
  }
}
