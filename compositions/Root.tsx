import React, { useLayoutEffect, useRef } from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  delayRender,
  continueRender,
} from "remotion";
import timeline from "./timeline.json";

// Enabled only by the trusted layout QA renderer; normal renders emit no measurements.
function measureTextLayout(
  root: HTMLDivElement,
  sceneIndex: number,
  frame: number,
  width: number,
  height: number,
) {
  const origin = root.getBoundingClientRect();
  const scaleX = width / origin.width;
  const scaleY = height / origin.height;
  const rectangle = (bounds: DOMRect) => ({
    left: (bounds.left - origin.left) * scaleX,
    top: (bounds.top - origin.top) * scaleY,
    right: (bounds.right - origin.left) * scaleX,
    bottom: (bounds.bottom - origin.top) * scaleY,
  });
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-motionforge-text]"),
  )
    .slice(0, 20)
    .map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const bounds = range.getBoundingClientRect();
      const clippingAncestors: ReturnType<typeof rectangle>[] = [];
      let ancestor: HTMLElement | null = element.parentElement;
      while (ancestor && clippingAncestors.length < 10) {
        const style = getComputedStyle(ancestor);
        if (
          /(hidden|clip|scroll|auto)/.test(
            `${style.overflowX} ${style.overflowY}`,
          )
        )
          clippingAncestors.push(rectangle(ancestor.getBoundingClientRect()));
        if (ancestor === root) break;
        ancestor = ancestor.parentElement;
      }
      return {
        role: element.dataset.motionforgeText,
        bounds: rectangle(bounds),
        lineBoxes: range.getClientRects().length,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        clippingAncestors,
      };
    });
  console.log(
    `MOTIONFORGE_LAYOUT_QA:${JSON.stringify({ sceneIndex, frame, width, height, elements })}`,
  );
}
const total = timeline.shots.reduce(
  (sum, shot) => sum + Math.round(shot.duration * timeline.fps),
  0,
);
const directions = {
  cinematic: {
    font: "Georgia,serif",
    speed: 0.65,
    travel: 45,
    scale: 0.07,
    label: "THE PRODUCT IN FOCUS",
  },
  minimal: {
    font: "Arial,sans-serif",
    speed: 0.5,
    travel: 18,
    scale: 0.025,
    label: "FORM. FUNCTION. FOCUS.",
  },
  futuristic: {
    font: "Courier New,monospace",
    speed: 0.35,
    travel: 30,
    scale: 0.06,
    label: "SYSTEM / PRODUCT",
  },
  energetic: {
    font: "Arial Black,Arial,sans-serif",
    speed: 0.25,
    travel: 65,
    scale: 0.09,
    label: "BUILT TO MOVE",
  },
  editorial: {
    font: "Georgia,serif",
    speed: 0.45,
    travel: 24,
    scale: 0.035,
    label: "PRODUCT JOURNAL",
  },
  elegant: {
    font: "Georgia,serif",
    speed: 0.7,
    travel: 20,
    scale: 0.025,
    label: "CONSIDERED IN EVERY DETAIL",
  },
  gaming: {
    font: "Arial Black,Arial,sans-serif",
    speed: 0.25,
    travel: 50,
    scale: 0.08,
    label: "ENTER THE EXPERIENCE",
  },
  corporate: {
    font: "Arial,sans-serif",
    speed: 0.5,
    travel: 20,
    scale: 0.03,
    label: "CLARITY IN EVERY WORKFLOW",
  },
};
function Scene({
  shot,
  index,
  layoutQa,
}: {
  shot: (typeof timeline.shots)[number];
  index: number;
  layoutQa: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const sceneRoot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!layoutQa) return;
    const handle = delayRender("Measuring composition text layout");
    let cancelled = false;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        continueRender(handle);
      }
    };
    void (async () => {
      await document.fonts.ready;
      for (let attempt = 0; attempt < 60 && !cancelled; attempt++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const root = sceneRoot.current;
        const bounds = root?.getBoundingClientRect();
        if (root && bounds && bounds.width > 0 && bounds.height > 0) {
          measureTextLayout(root, index, frame, width, height);
          break;
        }
      }
    })().finally(release);
    return () => {
      cancelled = true;
      release();
    };
  }, [layoutQa, index, frame, width, height]);
  const frames = Math.round(shot.duration * fps);
  const direction = directions[timeline.direction as keyof typeof directions];
  const enter = interpolate(
    frame,
    [0, Math.min(fps * direction.speed, frames / 4)],
    [0, 1],
    { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const leave = interpolate(
    frame,
    [frames - Math.min(fps * 0.3, frames / 4), frames],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );
  const progress = frame / Math.max(1, frames - 1);
  const zoom = shot.motion === "push" ? 1 + progress * direction.scale : 1;
  const x = shot.motion === "pan" ? interpolate(progress, [0, 1], [-2, 2]) : 0;
  const portrait = height > width;
  const typography = shot.kind === "typography";
  const split = shot.kind === "split";
  const headingSize =
    (portrait ? width * 0.065 : height * (typography ? 0.1 : 0.061)) *
    Math.min(1, 55 / shot.title.length);
  const motionTransform =
    shot.kind === "perspective"
      ? `perspective(1800px) rotateY(${interpolate(progress, [0, 1], [-12, 8])}deg) rotateX(5deg) scale(${zoom})`
      : `translateX(${x}%) scale(${zoom})`;
  const assetIsVideo = /\.(mp4|webm)$/i.test(shot.asset ?? "");
  const assetDuration = (
    shot as (typeof timeline.shots)[number] & { assetDurationSeconds?: number }
  ).assetDurationSeconds;
  const mediaStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    maxHeight: portrait ? height * 0.58 : height * 0.72,
    objectFit: "contain",
    background: "#fff",
  };
  const image = shot.asset ? (
    assetIsVideo ? (
      <Freeze
        frame={Math.min(
          frame,
          Math.max(0, Math.floor((assetDuration ?? shot.duration) * fps) - 1),
        )}
      >
        <OffthreadVideo src={staticFile(shot.asset)} muted style={mediaStyle} />
      </Freeze>
    ) : (
      <Img src={staticFile(shot.asset)} style={mediaStyle} />
    )
  ) : null;
  return (
    <AbsoluteFill
      ref={sceneRoot}
      style={{
        background: timeline.background,
        color: "#f5f7f4",
        fontFamily: direction.font,
        opacity:
          shot.transition === "cut" || shot.transition === "wipe"
            ? 1
            : enter * leave,
        clipPath:
          shot.transition === "wipe"
            ? `inset(0 ${(1 - enter) * 100}% 0 0)`
            : undefined,
        padding: portrait ? "10% 7%" : "6% 6%",
        overflow: "hidden",
      }}
    >
      <div
        data-motionforge-text="product"
        style={{
          position: "absolute",
          top: "3%",
          left: "6%",
          fontFamily: "Arial,sans-serif",
          fontSize: Math.max(14, height * 0.018),
          letterSpacing: 3,
          color: timeline.accent,
        }}
      >
        {timeline.product}{" "}
        <span style={{ opacity: 0.5 }}>
          {" "}
          / {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      {typography ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            height: "100%",
            width: "100%",
            textAlign: index % 2 ? "right" : "left",
          }}
        >
          <div
            data-motionforge-text="direction"
            style={{
              fontFamily: "Arial,sans-serif",
              fontSize: height * 0.018,
              letterSpacing: 4,
              color: timeline.accent,
              marginBottom: height * 0.04,
            }}
          >
            {direction.label}
          </div>
          <h1
            data-motionforge-text="title"
            style={{
              fontSize: headingSize,
              lineHeight: 1.04,
              letterSpacing: -headingSize * 0.04,
              margin: 0,
              overflowWrap: "anywhere",
              transform: `translateY(${(1 - enter) * direction.travel}px)`,
              clipPath: `inset(0 0 ${(1 - enter) * 100}% 0)`,
            }}
          >
            {shot.title}
          </h1>
          <p
            data-motionforge-text="description"
            style={{
              fontFamily: "Arial,sans-serif",
              fontSize: headingSize * 0.3,
              lineHeight: 1.5,
              opacity: enter * 0.7,
              maxWidth: "30em",
              alignSelf: index % 2 ? "flex-end" : "flex-start",
            }}
          >
            {shot.description}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: portrait ? "column" : split ? "row-reverse" : "row",
            gap: split ? "3%" : "5%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              flex: shot.asset ? (split ? 1 : ".75") : "1",
              width: portrait ? "100%" : undefined,
              transform: `translateY(${(1 - enter) * direction.travel}px)`,
            }}
          >
            <div
              style={{
                width: split ? "100%" : 48,
                height: split ? 1 : 4,
                background: timeline.accent,
                marginBottom: 24,
              }}
            />
            <h1
              data-motionforge-text="title"
              style={{
                fontSize: headingSize,
                lineHeight: 1.05,
                letterSpacing: -headingSize * 0.04,
                margin: "0 0 24px",
                overflowWrap: "anywhere",
              }}
            >
              {shot.title}
            </h1>
            {shot.description && (
              <p
                data-motionforge-text="description"
                style={{
                  fontFamily: "Arial,sans-serif",
                  fontSize: headingSize * 0.38,
                  lineHeight: 1.5,
                  maxWidth: "34em",
                  opacity: 0.75,
                  margin: 0,
                }}
              >
                {shot.description}
              </p>
            )}
            {split && (
              <div
                data-motionforge-text="direction"
                style={{
                  marginTop: height * 0.05,
                  fontFamily: "Arial,sans-serif",
                  fontSize: height * 0.017,
                  letterSpacing: 2,
                  color: timeline.accent,
                }}
              >
                {direction.label}
              </div>
            )}
          </div>
          {shot.asset && (
            <div
              style={{
                flex: split ? 1.2 : 1.5,
                width: portrait ? "100%" : "65%",
                position: "relative",
                transform: motionTransform,
                border:
                  shot.kind === "device"
                    ? "10px solid #30383f"
                    : "1px solid #ffffff25",
                borderRadius: shot.kind === "device" ? 26 : 4,
                overflow: "hidden",
                boxShadow:
                  shot.kind === "device" ? "0 22px 70px #0007" : undefined,
                clipPath:
                  shot.motion === "reveal"
                    ? `inset(0 ${(1 - enter) * 100}% 0 0)`
                    : undefined,
              }}
            >
              {shot.kind === "device" && (
                <div
                  style={{
                    height: 20,
                    background: "#30383f",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    paddingLeft: 10,
                  }}
                >
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 9,
                        background: "#94a1ac",
                      }}
                    />
                  ))}
                </div>
              )}
              {image}
            </div>
          )}
        </div>
      )}
      <div
        data-motionforge-text="footer"
        style={{
          position: "absolute",
          bottom: "3%",
          right: "6%",
          fontFamily: "Arial,sans-serif",
          fontSize: height * 0.015,
          color: "#ffffff66",
        }}
      >
        Captured product • {timeline.direction}
      </div>
    </AbsoluteFill>
  );
}
function Video({ layoutQa = false }: { layoutQa?: boolean }) {
  let start = 0;
  return (
    <AbsoluteFill style={{ background: timeline.background }}>
      {timeline.shots.map((shot, index) => {
        const from = start;
        start += Math.round(shot.duration * timeline.fps);
        return (
          <Sequence
            key={index}
            from={from}
            durationInFrames={Math.round(shot.duration * timeline.fps)}
          >
            <Scene shot={shot} index={index} layoutQa={layoutQa} />
          </Sequence>
        );
      })}
      {timeline.audio && (
        <Audio src={staticFile(timeline.audio)} volume={0.8} />
      )}
    </AbsoluteFill>
  );
}
registerRoot(() => (
  <Composition
    id="MotionForge"
    component={Video}
    width={timeline.width}
    height={timeline.height}
    fps={timeline.fps}
    durationInFrames={total}
  />
));
