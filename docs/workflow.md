# Renderable storyboard example

First capture a real local page to `/absolute/output/screen.png`. Then call generate_storyboard with:

```json
{
  "output": "/absolute/output/storyboard.json",
  "timeline": {
    "product": "Your verified product",
    "direction": "minimal",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "crf": 18,
    "encodingPreset": "medium",
    "background": "#101922",
    "accent": "#b8ee78",
    "shots": [
      {
        "title": "A real product workflow",
        "description": "Copy the client has verified against the application.",
        "asset": "/absolute/output/screen.png",
        "kind": "interface",
        "duration": 4,
        "motion": "push",
        "transition": "fade",
        "evidence": "Captured authorized local page and verified workflow"
      }
    ]
  }
}
```

Call render_video with timeline path and a new .mp4 output filename. It keeps a source project adjacent to the video and a `.render.json` progress log. Repeated writes require new names/directories. Use export_project for a separately named editable project. npm install inside that export installs the pinned Remotion CLI for studio and rendering; no server dependency on paid hosting is present.

Attach an authorized local track with sync_audio_timeline, or import and mix separate tracks. Unsupplied audio remains absent. Aspect ratios1920×1080,1080×1920 and1080×1080 are accepted, with even custom dimensions as bounded by the schema. CRF0 is lossless/large;18 is the default. Encoding presets trade render speed against compression.
