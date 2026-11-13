# Troubleshooting

- **Roots required / outside roots:** set MOTIONFORGE_ROOTS in the MCP process environment and authorize source plus output directories. Relative paths resolve from the server's working directory; prefer absolute paths.
- **Chromium missing:** `npx playwright install chromium` provisions Playwright. Set MOTIONFORGE_BROWSER_PATH to one existing compatible Chrome/Chromium executable to share it with Remotion. Never supply a shell command as the path.
- **FFmpeg missing:** install FFmpeg with ffprobe and put the executables on PATH before launching the MCP client.
- **Capture missing fonts/assets:** third-party requests are intentionally blocked; serve authorized assets on the application's own origin for deterministic local capture.
- **Protected/private file rejected:** .env, .git, keys and credential files cannot be read through tools. Supply public configuration/assets separately.
- **Existing output rejected:** tools preserve artifacts; choose a fresh path. Export directories must not already exist.
- **Render canceled by client:** increase tool timeout past the render deadline. MOTIONFORGE_RENDER_TIMEOUT_SECONDS accepts10–1800; default600. Only one render and one capture run concurrently. Large compositions may exceed resource limits.
- **Unsupported asset:** only local raster screenshots, MP4/WebM footage and admitted local audio containers are imported. SVG, remote media URLs, HLS and arbitrary compositions are rejected.
- **No soundtrack:** silent video is valid. Supply authorized local audio or explicitly enable optional paid voiceover. No background music is downloaded automatically.
- **A quality check flags a hold/fade:** black/freeze detection is diagnostic; intentional stillness and fade frames are possible. Review full playback and sampled frames.
