export type FixtureMode = "demo" | "worst" | "empty" | "one" | "large";
export interface Candidate {
  id: string;
  name: string;
  color: string;
  image: string;
  state: "ready" | "running" | "failed" | "queued";
  prompt: string;
  source: string;
}
export const FIXTURE_LABELS: Record<FixtureMode, string> = {
  demo: "Demo",
  worst: "Worst case",
  empty: "Empty",
  one: "One",
  large: "Large",
};

/** Deterministic schematic samples, not actual generated or private design assets. */
export function garmentImage(index: number, color: string): string {
  const collar = index % 2 ? "M86 62L120 112L154 62" : "M86 62Q120 96 154 62";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300"><rect width="240" height="300" fill="#eeeae2"/><path d="M86 62L57 75L23 128L53 147L72 121L65 259Q120 275 175 259L168 121L187 147L217 128L183 75L154 62Q120 78 86 62Z" fill="${color}" stroke="#4d4843" stroke-width="2"/><path d="${collar}M120 85V264M76 173H105V203H75M135 173H164V203H135" fill="none" stroke="#ded9cb" stroke-width="2"/><path d="M72 227Q120 ${index % 3 ? 242 : 220} 171 227" fill="none" stroke="#4d4843" stroke-dasharray="3 4"/><text x="120" y="287" text-anchor="middle" font-size="10" fill="#766f65">ATELIER · SAMPLE ${index + 1}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function resultFixtures(mode: FixtureMode): Candidate[] {
  const count =
    mode === "empty" ? 0 : mode === "one" ? 1 : mode === "demo" ? 6 : 12;
  const colors = [
    "#727c70",
    "#4e6274",
    "#ac8e6d",
    "#915f52",
    "#69616d",
    "#c3b49e",
  ];
  const names = [
    "苔绿 · 垂落肩线",
    "雾蓝 · 折叠领口",
    "沙色 · 双贴袋",
    "陶土 · 收束腰线",
    "石灰 · 落肩轮廓",
    "原麻 · 轻量层次",
  ];
  return Array.from({ length: count }, (_, index) => {
    const color = colors[index % colors.length] ?? "#727c70";
    return {
      id: `candidate-${index + 1}`,
      name:
        mode === "worst"
          ? `${"长款双层风衣与可拆卸折叠领口".repeat(6)} ${index + 1}`
          : (names[index % names.length] ?? "通勤风衣"),
      color,
      image:
        mode === "worst" && index === 1
          ? "/prototype-missing-image"
          : garmentImage(index, color),
      state:
        index === 4
          ? "failed"
          : index === 5
            ? "running"
            : index === 6
              ? "queued"
              : "ready",
      prompt: `${mode === "worst" ? "保持肩线与口袋结构，比较纹理与廓形细节。".repeat(40) : "保留双贴袋与落肩结构，改变面料色彩，观察整体比例。"}`,
      source: `秋冬通勤风衣 / 面料样本 ${index + 1}`,
    };
  });
}
