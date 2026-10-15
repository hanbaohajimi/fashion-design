export function curvePath(endX: number, endY: number, detourY = 0) {
  const reach = Math.min(180, Math.max(48, Math.abs(endX) * 0.45));
  const segments: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ][] = detourY
    ? [
        [0, 0, reach, 0, reach, detourY, endX / 2, detourY],
        [
          endX / 2,
          detourY,
          endX - reach,
          detourY,
          endX - reach,
          endY,
          endX,
          endY,
        ],
      ]
    : [[0, 0, reach, 0, endX - reach, endY, endX, endY]];
  const d = `M 0 0 ${segments.map((s) => `C ${s.slice(2).join(" ")}`).join(" ")}`;
  const points = segments.flatMap((s) =>
    Array.from({ length: 33 }, (_, i) => {
      const t = i / 32,
        u = 1 - t;
      return {
        x:
          u ** 3 * s[0] +
          3 * u ** 2 * t * s[2] +
          3 * u * t ** 2 * s[4] +
          t ** 3 * s[6],
        y:
          u ** 3 * s[1] +
          3 * u ** 2 * t * s[3] +
          3 * u * t ** 2 * s[5] +
          t ** 3 * s[7],
      };
    }),
  );
  return { d, points };
}
