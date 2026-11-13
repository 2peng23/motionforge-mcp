# Executable tool reference

All inputs are validated by Zod, exact schemas discoverable through MCP tools/list. Results contain content text plus structuredContent.result; failures set isError. File writes preserve existing artifacts by default.

| Tool                              | Actual scope                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `analyze_project`                 | Inspect bounded source inventory, framework, scripts, route evidence, assets and branding.                                      |
| `discover_routes`                 | Find filesystem route candidates with source paths and explicit inference confidence.                                           |
| `detect_brand_identity`           | Extract existing source colors, font declarations and real headings without inventing branding.                                 |
| `analyze_user_flows`              | Return actual route evidence for a client to author flows. Static scanning cannot verify runtime journeys.                      |
| `inspect_media_assets`            | Inventory local image, font, video and audio assets and byte sizes.                                                             |
| `prepare_capture_environment`     | Check project commands and capture URL; does not execute arbitrary project scripts or start a server.                           |
| `capture_page`                    | Capture authentic screenshot in isolated browser; fields/private elements masked and third-party requests blocked.              |
| `capture_user_flow`               | Execute explicitly authorized bounded actions and capture the final real page state.                                            |
| `record_browser_interaction`      | Record actual interactions using continuous masked browser screenshots, measured sample timing and cursor movement; output MP4. |
| `capture_responsive_screens`      | Capture an explicitly chosen responsive viewport matrix.                                                                        |
| `inspect_animation_opportunities` | Inspect actual headings, links, overflow and Web Animations timing for motion planning; writes evidence screenshot.             |
| `generate_creative_brief`         | Build an evidence-grounded creative brief from source identity, actual routes and explicit audience/goal.                       |
| `generate_storyboard`             | Validate evidence-bound shots and persist a real renderable timeline. Client supplies product claims and screenshots.           |
| `create_scene_plan`               | Calculate exact scene frame ranges from a validated timeline.                                                                   |
| `analyze_visual_rhythm`           | Measure shot lengths, repetition and readability timing without inventing aesthetic scores.                                     |
| `plan_transitions`                | Return implemented transition types with their timeline positions; no random transition assignment.                             |
| `generate_remotion_project`       | Export actual editable React/Remotion source, validated timeline and local assets.                                              |
| `create_motion_scene`             | Validate and append a real shot to a new timeline file; no destructive overwrite.                                               |
| `animate_product_interface`       | Set implemented push, pan, reveal or hold choreography on a real timeline shot.                                                 |
| `create_typography_animation`     | Create frame-driven typography reveal on a selected shot.                                                                       |
| `create_camera_movement`          | Apply deterministic camera motion to an existing scene.                                                                         |
| `create_transition`               | Apply a supported fade, wipe or cut transition in a new timeline.                                                               |
| `generate_device_mockup`          | Frame an actual screenshot with an animated device border; no stock device download.                                            |
| `generate_3d_scene`               | Apply deterministic CSS perspective rotation to a product screen. No mesh/Three.js scene generation.                            |
| `generate_voiceover_script`       | Create a timed script from client-authored evidence-bound scene copy; preserves provided language.                              |
| `generate_voiceover`              | Optionally synthesize supplied text with ElevenLabs. Explicit upload permission and paid account credentials required.          |
| `import_audio`                    | Copy a local authorized music/voice track with license provenance.                                                              |
| `plan_sound_design`               | Calculate scene boundaries and audio cue windows from actual timeline without downloading music.                                |
| `sync_audio_timeline`             | Attach an authorized local audio file to an exported timeline.                                                                  |
| `mix_audio`                       | Mix real local tracks with bounded gain/delay and output limiter via FFmpeg.                                                    |
| `configure_render`                | Validate and save dimensions, frame rate, duration and encoding configuration as a renderable timeline.                         |
| `render_video`                    | Render a bounded real H.264 MP4 with Remotion and retain editable project and progress log.                                     |
| `inspect_render`                  | Read actual FFprobe streams and container metadata.                                                                             |
| `export_project`                  | Export a standalone editable Remotion project with source assets and npm manifest.                                              |
| `export_video`                    | Validate the complete video stream before copying a local MP4 artifact.                                                         |
| `validate_timeline`               | Validate schema, timings, local assets and bounds before rendering.                                                             |
| `analyze_rendered_frames`         | Decode the video; run black/freeze detection and export sampled thumbnails for human review.                                    |
| `detect_clipping`                 | Measure actual composition text ranges and clipping ancestor bounds in Chrome at scene midpoints; no OCR of captured UI.        |
| `inspect_audio_levels`            | Measure actual FFmpeg peak/mean levels and report clipping risk.                                                                |
| `validate_export`                 | Fully decode exported media and verify codec and optional dimensions.                                                           |
| `generate_quality_report`         | Persist measured decode/stream/audio checks and explicit manual review requirements.                                            |

Creative tools operate on evidence and client-authored content; they are structured production artifacts, not autonomous design judgment. generate_3d_scene means CSS perspective product screen, not Three.js mesh generation. detect_clipping measures actual generated text at scene midpoints (6% horizontal/3% vertical safe area with 1px tolerance); it excludes captured UI text, full timeline coverage and complex clip paths. No tool exposes arbitrary shell execution or deletes project files. See README scope/limits and security.md.
