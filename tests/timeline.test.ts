import { describe, it, expect } from "vitest";
import { timelineSchema, timelineFacts } from "../src/schemas/timeline.js";
describe("evidence-bound timeline", () => {
  const shot = {
    title: "A real workflow",
    evidence: "Recorded /projects route",
    duration: 2,
  };
  it("rejects fabricated evidence-free scenes", () => {
    expect(() =>
      timelineSchema.parse({
        product: "Demo",
        shots: [{ title: "Unsupported claim" }],
      }),
    ).toThrow();
  });
  it("computes contiguous exact frame ranges", () => {
    const timeline = timelineSchema.parse({
      product: "Demo",
      fps: 24,
      shots: [shot, { ...shot, duration: 3 }],
    });
    const facts = timelineFacts(timeline);
    expect(facts.durationInFrames).toBe(120);
    expect(facts.scenes.map((scene) => [scene.start, scene.frames])).toEqual([
      [0, 48],
      [48, 72],
    ]);
  });
  it("rejects unsafe encoding dimensions and excessive timelines", () => {
    expect(() =>
      timelineSchema.parse({ product: "Demo", width: 1081, shots: [shot] }),
    ).toThrow();
    expect(() =>
      timelineSchema.parse({
        product: "Demo",
        shots: Array.from({ length: 8 }, () => ({ ...shot, duration: 30 })),
      }),
    ).toThrow();
  });
});
