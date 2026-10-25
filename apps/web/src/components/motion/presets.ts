import type mojs from "@mojs/core";

export type CoutureEffect =
  | "archive"
  | "signature"
  | "stitch"
  | "material"
  | "needle"
  | "thread"
  | "reveal"
  | "seal";
export type Mojs = typeof mojs;

/** All SVG is disposable decoration. Content never waits for this timeline. */
export function composeEffect(
  mo: Mojs,
  effect: CoutureEffect,
  host: HTMLElement,
  duration: number,
  colors: readonly string[],
  touch: boolean,
) {
  const width = host.clientWidth;
  const height = host.clientHeight;
  const ink = colors[0] ?? "#323232";
  const paper =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-paper")
      .trim() || "#fff";
  const easing = getComputedStyle(document.documentElement)
    .getPropertyValue("--ease-enter")
    .trim();
  const curve = easing
    .match(/cubic-bezier\(([^)]+)\)/u)?.[1]
    ?.split(",")
    .map(Number);
  const [x1 = 0.23, y1 = 1, x2 = 0.32, y2 = 1] = curve ?? [];
  // Burst treats arrays as per-child values; pass the resolved curve function.
  const ease = mo.easing.bezier(x1, y1, x2, y2);
  const timeline = new mo.Timeline();
  const items: InstanceType<Mojs["Shape"]>[] = [];
  const shape = (options: Record<string, unknown>) => {
    const item = new mo.Shape({
      parent: host,
      left: 0,
      top: 0,
      fill: "none",
      stroke: ink,
      strokeWidth: 1,
      duration,
      easing: ease,
      opacity: { 0.9: 0, easing: "linear.none" },
      isShowEnd: false,
      ...options,
    });
    items.push(item);
  };
  const line = (x: number, y: number, length: number, rotate = 0, delay = 0) =>
    shape({
      shape: "line",
      x,
      y,
      radius: length / 2,
      rotate,
      scaleX: { 0.12: 1 },
      delay,
      duration: duration - delay,
    });
  const corners = (inset: number) => {
    for (const [x, y, sx, sy] of [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1],
    ] as const) {
      line(x + sx * 7, y, 14);
      line(x, y + sy * 7, 14, 90);
    }
  };
  const fragments = (x: number, y: number, inward = false, count = 8) => {
    items.push(
      new mo.Burst({
        parent: host,
        left: x,
        top: y,
        count: touch ? Math.ceil(count / 2) : count,
        radius: inward ? { 40: 10 } : { 8: 38 },
        degree: 300,
        rotate: -60,
        children: {
          shape: "line",
          radius: 5,
          radiusY: 2,
          stroke: [...colors],
          strokeWidth: 1.2,
          fill: "none",
          rotate: "stagger(0, 27)",
          scale: { 1: 0.3 },
          opacity: { 0.8: 0, easing: "linear.none" },
          duration,
          easing: ease,
          isShowEnd: false,
        },
      }),
    );
  };

  switch (effect) {
    case "archive":
      line(Math.min(width, 240) / 2, height + 7, Math.min(width, 240));
      line(0, height + 7, 12, 90);
      line(Math.min(width, 240), height + 7, 12, 90, 80);
      break;
    case "signature":
      corners(-8);
      line(width / 2, height + 12, Math.min(width + 24, 260));
      shape({
        shape: "rect",
        x: width + 12,
        y: height + 12,
        radius: 4,
        rotate: { 45: 90 },
      });
      break;
    case "stitch":
      for (let i = 0; i < 3; i++)
        line(width - 12 - i * 15, height - 10, 9, -35, i * 45);
      fragments(width - 16, height - 14, true, 6);
      break;
    case "material":
      corners(4);
      fragments(width - 10, height - 10, false, 8);
      break;
    case "needle":
      line(10, height / 2, 28, -40);
      shape({
        shape: "circle",
        x: 10,
        y: height / 2,
        radius: 9,
        scale: { 1.5: 0.95 },
      });
      fragments(10, height / 2, true, 4);
      break;
    case "thread":
      for (let i = 0; i < 3; i++) line(6 + i * 14, height + 4, 9, 0, i * 35);
      break;
    case "reveal":
      corners(3);
      line(width / 2, 1, width, 0);
      line(width - 1, height / 2, height, 90, 65);
      for (const side of [-1, 1]) {
        const mask = document.createElement("div");
        Object.assign(mask.style, {
          position: "absolute",
          inset: "0",
          background: paper,
          opacity: "0.28",
          clipPath:
            side < 0
              ? "polygon(0 0, 100% 0, 0 100%)"
              : "polygon(100% 0, 100% 100%, 0 100%)",
        });
        host.append(mask);
        items.push(
          new mo.Html({
            el: mask,
            x: { 0: side * 32 },
            y: { 0: side * 14 },
            opacity: { 0.28: 0 },
            duration,
            easing: ease,
          }),
        );
      }
      break;
    case "seal":
      shape({
        shape: "rect",
        x: width - 18,
        y: height / 2,
        radius: 17,
        radiusY: 12,
        scale: { 1.15: 0.95 },
        rotate: { "-12": -5 },
      });
      line(width - 18, height / 2, 14, -35);
      fragments(width - 18, height / 2, true, 8);
      break;
  }
  timeline.add(...items);
  return {
    play: () => timeline.play(),
    stop: () => {
      timeline.stop();
      items.forEach((item) => item.stop());
    },
  };
}
