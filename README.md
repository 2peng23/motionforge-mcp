# MotionForge MCP

A local TypeScript MCP server for discovering product evidence, capturing real browser UI, directing evidence-bound timelines, exporting editable Remotion projects, rendering H.264 videos, and measuring technical export quality. No account or hosted infrastructure is required for the local workflow.

Version 0.1.0 implements 41 discoverable executable tools. Its creative tools produce structured artifacts from actual project evidence and client-authored copy; the AI client supplies judgment and validates product claims. It does **not** automatically guarantee a professional film or infer product functionality from a directory name.

## Install

Prerequisites: Node.js >=20.19, npm, FFmpeg/FFprobe on PATH, and Chromium. Tested on macOS with Node20.20 and locally installed Google Chrome. Windows/Linux behavior is designed around portable Node APIs but has not been exercised here.

```bash
git clone https://github.com/2peng23/motionforge-mcp.git
cd motionforge-mcp
npm ci
npx playwright install chromium
npm run build
npm test
```

Remotion can use the same browser by setting `MOTIONFORGE_BROWSER_PATH` to the installed Chromium/Chrome executable; otherwise its renderer may need its own browser download. Preinstall a browser to keep production work offline.

```bash
MOTIONFORGE_ROOTS=/absolute/authorized/project MOTIONFORGE_BROWSER_PATH=/absolute/chrome node dist/server/cli.js
```

`MOTIONFORGE_ROOTS` is mandatory. Multiple roots use `:` on macOS/Linux, `;` on Windows. Authorize both application source and output directory. The server reserves stdout for MCP messages; diagnostics and progress go to stderr. Future npm publishing is prepared through the executable bin entry; `npx -y motionforge-mcp` requires publishing first. Local package verification: `npm pack --dry-run`.

## Connect a coding assistant

[Client configurations](docs/clients.md) cover Codex, Claude Code, Cursor and VS Code. SDK stdio discovery and tool invocation are integration-tested. Actual installation into those four apps was not performed and their configurations were not changed.

## Run the acceptance demonstration

```bash
MOTIONFORGE_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run demo
```

Omit the environment variable when Chromium is installed for both Playwright and Remotion. The demo starts an isolated localhost fixture, discovers its HTML pages, captures an actual working project filter and projects page, saves an evidence-bound storyboard, renders a 1920×1080 30fps 10-second MP4 with actual recorded interface footage, fully decodes it with FFmpeg, exports thumbnails and an editable Remotion project, and saves measured results under `artifacts/demo-TIMESTAMP/acceptance-report.json`. It stops its own fixture. No real customer data or supplied audio is used; the video is intentionally silent.

## Typical MCP workflow

1. `analyze_project` and `detect_brand_identity` inspect authorized source. Confirm feature claims through the running application.
2. `prepare_capture_environment` reports development commands; it does not execute them. Obtain user authorization before starting the user's development server outside this MCP.
3. `capture_page` and `capture_user_flow` capture actual routes. Mutating interactions require `allowInteractions: true`. Capture only accounts/data authorized for recording.
4. The AI client authors a brief and shot titles from evidence. `generate_storyboard` saves the validated `timeline` object to an authorized new `output` path.
5. `create_motion_scene`, `animate_product_interface`, `create_camera_movement`, and `create_transition` create new editable timeline versions.
6. Optionally import licensed audio, mix it, and attach it with `sync_audio_timeline`.
7. `generate_remotion_project` exports standalone source. `render_video` uses its own fixed trusted source, the validated timeline, and authorized local raster/video/audio assets.
8. `validate_export`, `inspect_audio_levels`, `analyze_rendered_frames`, and `generate_quality_report` supply objective evidence for the client to inspect.

A timeline contains `product`, `direction`, `width`, `height`, `fps`, optional `crf`/`encodingPreset`/`audio`, and `shots`. Every shot requires `title` and `evidence`; `asset` is an authorized local raster image or MP4/WebM interaction clip; `kind` supports interface, typography, split, device and perspective; `motion` supports push, pan, reveal and hold; `transition` supports fade, wipe and cut. All exact schemas are discoverable via MCP tools/list. See [workflow](docs/workflow.md), [tools](docs/tools.md), [creative direction](docs/creative-direction.md) and [security](docs/security.md).

## Scope and limits

- Export: actual editable React/Remotion composition, manifest and copied local assets. Exported projects support `npm install`, `npm run studio`, `npm run render`.
- Render: H.264 MP4/yuv420p, landscape/portrait/square or custom even dimensions, 12–60fps, up to 180 seconds and 30 scenes, CRF0–40, bounded encoding presets, one render at a time, configurable deadline. Portrait/square use their own layout rather than cropping landscape.
- Browser: isolated contexts, fixed locale/timezone, responsive screenshots, scrolling/click/hover/form steps, cursor moves, source evidence and continuous masked recording (requested6–24fps, actual timing preserved; bounded30seconds/480frames/512MB). Private markers and fields are hidden; arbitrary personal images/text still require human review. See capture limitations in the returned evidence and security documentation.
- Motion: deterministic frame-driven typography, camera pan/push, reveal masks, fade/wipe/cut, distinct screen/text/device layouts, and CSS perspective screen rotation. No arbitrary Three.js meshes, full 3D scene modeling, advanced layered parallax, or autonomous product storytelling is implemented. Device mockups are CSS frames, not photorealistic hardware.
- Audio: authorized local audio import, FFmpeg mixing, timed client-authored scripts in any provided language (including English/Filipino/Taglish); no automatic translation. ElevenLabs is optional, requires explicit upload authorization and account credit; real paid synthesis was not tested. No stock-music downloader.
- QA: actual FFprobe stream/duration/dimension checks, full decoding, black/freeze diagnostics, sampled frames and peak/mean audio metering. Text clipping measures actual Chrome text-range bounds and clipping ancestors at each scene midpoint (6% horizontal / 3% vertical safe area, 1px tolerance). It excludes text embedded in screenshots/video, all-frame coverage and complex clip-path guarantees; human frame review remains required. No computer-vision beauty score or complete aesthetic evaluation.
- Framework discovery: dependency detection and heuristic route evidence, including React/Next, Vue/Nuxt, Svelte/SvelteKit and HTML. No framework migration, project script execution, or application-code rewrite.

The code is MIT licensed. [Remotion has its own license and commercial eligibility rules](https://www.remotion.dev/docs/license); installing this MIT server does not grant a Remotion license. Optional provider terms and asset licenses also apply.

See [verification evidence](docs/verification.md), [troubleshooting](docs/troubleshooting.md), [contributing](CONTRIBUTING.md), and [API sources](docs/api-sources.md).
