# Verification evidence

Executed locally on macOS with Node 20.20.0, npm 10.8.2, installed Google Chrome, FFmpeg and FFprobe on 2026-11-13. Linux/Windows and actual client application installations were not exercised.

- npm run build: passed TypeScript compilation and executable bin preparation.
- Chrome-enabled npm test:18 tests across 8 files passed, including SDK stdio discovery/invocation, path boundaries, real browser flow recording, actual audio mixing, media format admission, actual rendered DOM bounds and held final video frame.
- npm audit: zero reported vulnerabilities in installed dependencies.
- npm pack: tarball built; isolated installation lists all 41 tools over stdio and exports editable source from packaged template.
- npm run demo: discovered two HTML pages and actual source branding; clicked a working project filter with cursor choreography and recorded 24 continuously masked frames at requested 12 fps with measured intervals.
- Final video: 1920×1080, h264, 30/1fps, 300frames, 10.000000seconds. Full decode passed. Actual captured interactionMP4 is embedded in the product film.
- Chrome DOM layout QA: 4scene midpoint samples, 0safe-area issues in generated typography. No OCR or all-frame guarantee.
- Five sampled frame images saved for visual inspection; a sampled480px thumbnail was visually inspected. Continuous playback/listening was not performed. No soundtrack supplied; demo intentionally has no audio stream.

Artifacts are retained locally under artifacts/demo-1794532780296/: fieldnote.mp4, storyboard.json, acceptance-report.json, input screenshots/recording, frames/, and editable composition directory. Artifacts are excluded from Git and npm packages.

The demonstration's product and sample records are fictional fixtures, not an invented claim about an existing customer product. Optional ElevenLabs account synthesis was not invoked. The SDK transport test does not prove installation in Codex/Claude Code/Cursor/VS Code; documented configuration examples follow official client references.
