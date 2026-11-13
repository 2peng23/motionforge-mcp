# Verified upstream APIs

Registry and installed declarations were checked during implementation. Pins: official MCP server/client2.4.0 (stdio serveStdio and registerTool), Remotion/bundler/renderer4.0.543, React19.2.0, Playwright1.65.0, Zod4.6.7, Vitest4.1.12. package-lock.json records transitive versions. Node20.20 is the demonstrated runtime.

- [Official MCP v2 first server](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server) — factory-based serveStdio; stdout reserved for protocol.
- [Official MCP TypeScript repository](https://github.com/modelcontextprotocol/typescript-sdk) — split v2 packages and compatibility.
- [Remotion bundle](https://www.remotion.dev/docs/bundle), [selectComposition](https://www.remotion.dev/docs/renderer/select-composition), [renderMedia](https://www.remotion.dev/docs/renderer/render-media) — actual server rendering APIs, cancellation and encoding options.
- [Playwright browser contexts](https://playwright.dev/docs/browser-contexts), [network interception](https://playwright.dev/docs/network) and [screenshots](https://playwright.dev/docs/screenshots) — isolated deterministic capture.
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html) and [FFprobe](https://ffmpeg.org/ffprobe.html) — stream metadata, decoding, black/freeze and volume filters.
- [ElevenLabs convert](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) — optional text-to-speech endpoint. Credentialed invocation was not tested.
- [Remotion license](https://www.remotion.dev/docs/license) — the server's MIT license does not replace dependency licensing.

Client setup references are linked in clients.md. APIs evolve; use the lockfile to reproduce this version.
