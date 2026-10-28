import { test as base, expect, type Page } from "@playwright/test";
import { seedReturningFeatureGuideUser } from "../e2e/feature-guide-fixture";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import {
  runwayRunFixture,
  runwayShowFixture,
} from "../../apps/web/src/modules/runway/runway-test-fixtures";

export const NOW = "2026-10-20T02:00:00.000Z";
export const PROJECT = "atelier-visual";
const garment =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e9e5df"/><path d="M200 120 300 70 400 120 470 260 380 290 370 690 230 690 220 290 130 260Z" fill="#263950"/></svg>';
const project = {
  id: PROJECT,
  name: "秋冬通勤服装设计",
  archived: false,
  assetCount: 3,
  coverAssetId: "look",
  coverUrl: "/visual-garment.svg",
  createdAt: NOW,
  updatedAt: NOW,
};
const node = (
  id: string,
  type: string,
  title: string,
  x: number,
  y: number,
  payload: Record<string, unknown>,
) => ({
  id,
  type,
  title,
  kind: type === "generate_design" ? "tool" : "asset",
  x,
  y,
  status: "completed",
  createdAt: NOW,
  updatedAt: NOW,
  canDelete: false,
  payload,
});
const graph = {
  projectId: PROJECT,
  revision: 1,
  layoutRevision: 0,
  legacyAvailable: false,
  proposals: [],
  nodes: [
    node("brief", "constraint", "设计约束", 80, 180, {
      brief: {
        summary: "宽松廓形，藏蓝配色，适合日常通勤",
        garmentType: "外套",
        constraints: [],
        unknowns: [],
      },
    }),
    node("tool", "generate_design", "方案生成", 430, 180, {
      toolKey: "generate_design",
      toolVersion: "1",
      params: { prompt: "探索通勤外套", count: 1 },
    }),
    node("candidate", "candidate", "藏蓝通勤外套", 780, 100, {
      assetId: "visual-look",
      imageUrl: "/visual-garment.svg",
      imageWidth: 600,
      imageHeight: 800,
    }),
  ],
  edges: [
    {
      id: "input",
      sourceNodeId: "brief",
      targetNodeId: "tool",
      sourcePort: "out",
      targetPort: "constraint",
    },
    {
      id: "output",
      sourceNodeId: "tool",
      targetNodeId: "candidate",
      sourcePort: "out",
      targetPort: "source",
    },
  ],
};

export const test = base.extend({
  browser: async ({ playwright }, use) => {
    const browser = await playwright.chromium.connectOverCDP(
      process.env.ATELIER_VISUAL_CDP!,
    );
    expect(browser.version()).toBe(process.env.ATELIER_CHROMIUM_VERSION);
    await use(browser);
    await browser.close();
  },
});
export { expect };

export async function seedVisualApp(page: Page, { guides = false }: { guides?: boolean } = {}) {
  // Existing fixtures represent returning users; guide scenarios opt into the first look.
  if (!guides) await seedReturningFeatureGuideUser(page, ["visual-designer"]);
  // CDP-attached contexts require explicit media emulation before navigation.
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  // Workflow labels use pinned system fonts. Do not wait on unused SDK text fonts.
  await page.route("https://cdn.tldraw.com/*/fonts/**", (route) =>
    route.abort(),
  );
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const style = document.createElement("style");
        style.textContent =
          ':root { --font-sans: "Noto Sans CJK SC", sans-serif !important; --font-serif: "Noto Serif CJK SC", serif !important; } nextjs-portal { display: none !important; }';
        document.head.append(style);
      },
      { once: true },
    );
  });
  await page.route("**/visual-garment.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: garment }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/u, "");
    if (path === `/projects/${PROJECT}/studio/creative-summary`)
      return route.fulfill({ json: { styles: 0, assets: 0, packs: 0 } });
    if (path === `/projects/${PROJECT}/studio`)
      return route.fulfill({ json: studioFixture({ assets: [] }) });
    const json = (data: unknown) => route.fulfill({ json: data });
    if (path === `/projects/${PROJECT}/runway/capabilities`)
      return json({
        enabled: true,
        workerOnline: true,
        mode: "mock",
        canEdit: true,
        capabilities: { image: true, video: true, music: true },
      });
    if (path === `/projects/${PROJECT}/runway/shows`)
      return json([
        runwayShowFixture({
          projectId: PROJECT,
          runs: [runwayRunFixture({ projectId: PROJECT })],
        }),
      ]);
    if (path === `/projects/${PROJECT}/runway/shows/show-1`)
      return json(
        runwayShowFixture({
          projectId: PROJECT,
          runs: [runwayRunFixture({ projectId: PROJECT })],
        }),
      );
    if (path === `/projects/${PROJECT}/runway/runs/run-1`)
      return json(runwayRunFixture({ projectId: PROJECT }));
    if (path === `/projects/${PROJECT}/runway/runs/run-1/events`)
      return route.fulfill({ status: 204, body: "" });
    if (path.includes("/runway/media/"))
      return route.fulfill({ contentType: "image/svg+xml", body: garment });
    if (path.startsWith("/image-shares/"))
      return json({ imageUrl: "/visual-garment.svg" });
    if (path === "/me")
      return json({
        user: {
          id: "visual-designer",
          email: "designer@example.com",
          name: "设计师",
        },
        credits: { limit: 600, used: 0, remaining: 600 },
      });
    if (path === "/generations") return json({ items: [], nextCursor: null });
    if (path === "/projects")
      return json({
        items: [
          project,
          {
            ...project,
            id: "second",
            name: "针织系列探索",
            assetCount: 0,
            coverUrl: null,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        hasMore: false,
      });
    if (path === `/projects/${PROJECT}`) return json(project);
    if (path.endsWith("/workflow/sync") || path.endsWith("/workflow"))
      return json(graph);
    if (path.endsWith("/workflow/tools"))
      return json({ agentVersion: 2, tools: [] });
    if (path.endsWith("/agent-conversations"))
      return json({
        items: [
          {
            id: "visual-chat",
            mode: "workflow",
            projectId: PROJECT,
            title: "外套设计",
            createdAt: NOW,
            updatedAt: NOW,
            archivedAt: null,
          },
        ],
        nextCursor: null,
      });
    if (path.endsWith("/messages"))
      return json({ items: [], nextCursor: null });
    if (path.endsWith("/context"))
      return json({
        revision: 1,
        summaryRevision: 0,
        currentObjective: "秋冬通勤服装设计",
        currentTask: "探索外套方案",
        focusNodeIds: [],
        requirements: [],
        preferences: [],
        state: { preferences: [] },
        scopedMemory: [],
        nodes: graph.nodes,
        visualCoverage: {
          total: 1,
          ready: 1,
          pending: 0,
          failed: 0,
          attachedNodeIds: ["candidate"],
        },
      });
    if (path.endsWith("/plan")) return json({ plan: null });
    if (
      path.includes("/design-assets/") &&
      (path.endsWith("/content") || path.endsWith("/thumbnail"))
    )
      return route.fulfill({ contentType: "image/svg+xml", body: garment });
    if (/^\/design-assets\/[^/]+\/feedback$/u.test(path))
      return json({ revision: 0, annotations: [], comments: [] });
    if (/^\/design-assets\/[^/]+\/shares$/u.test(path)) return json([]);
    if (path.endsWith("/versions"))
      return json({ items: [], nextCursor: null });
    if (path.endsWith("/path"))
      return json({ steps: [], decisions: [], incomplete: false });
    if (path === "/exports")
      return json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    if (path === "/exports/capabilities")
      return json({ downloadLinkHours: 24 });
    if (path === "/fabrics")
      return json({
        items: Array.from({ length: 6 }, (_, index) => ({
          id: `fabric-${index}`,
          canManage: false,
          scope: "preset",
          mainFileId: `fabric-file-${index}`,
          mainImageUrl: "/visual-garment.svg",
          tags: ["棉布", "哑光", "通勤"],
          createdAt: NOW,
          updatedAt: NOW,
        })),
        total: 6,
        totalPages: 1,
        page: 1,
        limit: 30,
      });
    if (path === "/trends/digest/current") return json(null);
    if (path === "/trends")
      return json({
        items: Array.from({ length: 3 }, (_, index) => ({
          id: `trend-${index}`,
          category: ["women", "men", "fabric"][index],
          platform: "vogue.com",
          title: [
            "克制的都市通勤廓形",
            "轻盈层次与功能细节",
            "自然肌理与柔和配色",
          ][index],
          summary: "通过简洁轮廓与细腻材质，探索日常穿着中的舒适与秩序。",
          tags: ["通勤", "肌理"],
          coverImageUrl: "/visual-garment.svg",
          sourceUrl: "https://www.vogue.com/fashion-shows",
          publishedAt: NOW,
          curatedAt: NOW,
          status: "ready",
          extracted: {
            fabricMentions: ["棉布"],
            keyColors: ["#263950", "#d8c9b8"],
            keywords: ["克制", "层次"],
            silhouettes: ["宽松"],
          },
        })),
        total: 3,
        page: 1,
        pageSize: 60,
        hasMore: false,
      });
    if (/^\/projects\/[^/]+\/tasks$/u.test(path)) return json({ items: [], nextCursor: null, counts: { running: 0, attention: 0 } });
    if (path === "/auth/login") return json({ ok: true });
    throw new Error(
      `视觉测试缺少明确的 API fixture: ${route.request().method()} ${path}`,
    );
  });
}

export async function settleImages(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Offscreen lazy images must load before a full-page visual assertion.
    for (const image of document.images) image.loading = "eager";
    await Promise.allSettled(
      Array.from(document.images, (image) => image.decode()),
    );
  });
}
