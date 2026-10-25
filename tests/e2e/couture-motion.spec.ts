import { expect, test, type Page } from "@playwright/test";

// These scenarios exercise the editable workflow, not the default design workbench.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fashion:canvas-view", "workflow"));
});
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";
import {
  studioFixture,
  styleFixture,
  techPackFixture,
} from "../../apps/web/src/modules/studio/studio-test-fixtures";

declare global {
  interface Window {
    coutureSamples: {
      effect: string;
      svg: number;
      pointerEvents: string;
      elapsed?: number;
    }[];
    coutureFrames: number[];
  }
}

test.use({
  actionTimeout: 12_000,
  video: { mode: "on", size: { width: 1440, height: 1000 } },
  trace: "on",
  viewport: { width: 1440, height: 1000 },
});
test.setTimeout(60_000);

async function observe(page: Page, reduce = false) {
  await seedVisualApp(page);
  await page.emulateMedia({
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  await page.addInitScript(() => {
    window.coutureSamples = [];
    window.coutureFrames = [];
    const started = new WeakMap<Node, { index: number; at: number }>();
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.dataset.coutureMotion)
            continue;
          const index = window.coutureSamples.length;
          started.set(node, { index, at: performance.now() });
          window.coutureSamples.push({
            effect: node.dataset.coutureMotion,
            svg: node.querySelectorAll("svg").length,
            pointerEvents: getComputedStyle(node).pointerEvents,
          });
        }
        for (const node of record.removedNodes) {
          const start = started.get(node);
          if (start)
            window.coutureSamples[start.index].elapsed =
              performance.now() - start.at;
        }
      }
    }).observe(document, { childList: true, subtree: true });
    let last = 0;
    const sample = (now: number) => {
      if (last && document.querySelector("[data-couture-motion]"))
        window.coutureFrames.push(now - last);
      last = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function effect(page: Page, name: string, minimum = 1) {
  await expect
    .poll(() =>
      page.evaluate(
        (value) =>
          window.coutureSamples.filter(
            (item) => item.effect === value && item.svg > 0,
          ).length,
        name,
      ),
    )
    .toBeGreaterThanOrEqual(minimum);
  await expect(page.locator("[data-couture-motion]")).toHaveCount(0);
  const played = await page.evaluate(
    (value) => window.coutureSamples.filter((item) => item.effect === value),
    name,
  );
  expect(played.at(-1)?.elapsed).toBeGreaterThan(100);
  await test.info().attach(`motion-${name}-${minimum}`, {
    body: JSON.stringify(
      {
        effects: played,
        frameIntervals: await page.evaluate(() => window.coutureFrames),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed())
    await info.attach("motion-measurements", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          effects: window.coutureSamples,
          frameIntervals: window.coutureFrames,
        })),
        null,
        2,
      ),
      contentType: "application/json",
    });
});

test("首页铺稿与创建落款，筛选和历史刷新不重复庆祝", async ({ page }) => {
  await observe(page);
  await page.route("**/api/projects/*/studio/creative-summary", (route) =>
    route.fulfill({ json: { styles: 0, assets: 0, packs: 0 } }),
  );
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      json: {
        id: "couture-created",
        name: "高定线迹试验",
        archived: false,
        assetCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });
  await page.route("**/api/projects/couture-created", (route) =>
    route.fulfill({ json: { id: "couture-created", name: "高定线迹试验" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "项目库", exact: true }),
  ).toBeVisible();
  await effect(page, "archive");
  await page.getByRole("searchbox").fill("针织");
  await page.getByRole("searchbox").clear();
  expect(
    await page.evaluate(
      () =>
        window.coutureSamples.filter((item) => item.effect === "archive")
          .length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("高定线迹试验");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/couture-created$/u, { timeout: 30_000 });
  await effect(page, "signature");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "适合画布", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.coutureSamples)).toEqual([]);
});

test("趋势成功缝入、失败不庆祝，减少动态效果仍可完成操作", async ({ page }) => {
  await observe(page);
  let fails = true;
  await page.route(`**/api/projects/${PROJECT}/workflow`, (route) =>
    route.fulfill(
      fails
        ? { status: 500, json: { message: "测试失败" } }
        : { json: { revision: 2 } },
    ),
  );
  await page.goto(`/trends?from=board&boardId=${PROJECT}`);
  const action = page
    .getByRole("button", { name: "加入工作流", exact: true })
    .first();
  await action.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "测试失败" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.coutureSamples)).toEqual([]);
  fails = false;
  await action.click();
  await effect(page, "stitch");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "加入工作流", exact: true })
    .nth(1)
    .click();
  await expect(page.getByRole("status")).toContainText("原始来源已保留");
  expect(await page.evaluate(() => window.coutureSamples.length)).toBe(1);
});

test("新面料落定、任务起针和真实阶段切换、候选揭幕均只播放一次", async ({
  page,
}, info) => {
  await observe(page);
  // Read the existing fixture through its public API, then drive real sync responses.
  await page.goto("/");
  await effect(page, "archive");
  const graph = await page.evaluate(async () =>
    (await fetch("/api/projects/atelier-visual/workflow/sync")).json(),
  );
  // Keep polling active without simulating a historical task as a fresh submission.
  graph.nodes[0].payload = {
    ...graph.nodes[0].payload,
    roleInferenceState: "pending",
  };
  graph.nodes[0].type = "reference_image";
  await page.route(`**/api/projects/${PROJECT}/workflow/sync`, (route) =>
    route.fulfill({ json: graph }),
  );
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "适合画布", exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  const tool = graph.nodes.find((node: { id: string }) => node.id === "tool");
  graph.revision++;
  tool.status = "queued";
  await effect(page, "needle");
  graph.revision++;
  tool.status = "running";
  await effect(page, "thread");
  graph.revision++;
  graph.nodes.push({
    ...graph.nodes[0],
    id: "new-fabric",
    type: "fabric",
    title: "新面料布样",
    x: 450,
    y: 430,
    payload: { fabricId: "fabric-0" },
  });
  await effect(page, "material");
  graph.revision++;
  graph.nodes.push({
    ...graph.nodes[2],
    id: "new-result",
    title: "新裁片方案",
    x: 80,
    y: 460,
  });
  await effect(page, "reveal");
  const sample = await page.evaluate(() =>
    window.coutureSamples.find((item) => item.effect === "reveal"),
  );
  expect(sample?.elapsed).toBeGreaterThan(600);
  expect(
    await page.evaluate(() =>
      window.coutureSamples.every((item) => item.pointerEvents === "none"),
    ),
  ).toBe(true);
  const completed = new Promise<{ stream: string }>((resolve) =>
    cdp.once("Tracing.tracingComplete", resolve),
  );
  await cdp.send("Tracing.end");
  const { stream } = await completed;
  let trace = "";
  for (;;) {
    const part = await cdp.send("IO.read", { handle: stream });
    trace += part.data;
    if (part.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  await info.attach("couture-performance", {
    body: trace,
    contentType: "application/json",
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "适合画布", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.coutureSamples)).toEqual([]);
});

test("面料上传成功反馈与真实加入画布后的落定", async ({ page }) => {
  await observe(page);
  const fabric = {
    id: "new-upload",
    mainFileId: "fabric-file",
    mainImageUrl: "/visual-garment.svg",
    tags: ["高定羊毛"],
    scope: "personal",
    canManage: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await page.route("**/api/fabrics", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: fabric })
      : route.fallback(),
  );
  await page.goto("/fabrics");
  await page.locator("summary").filter({ hasText: "上传面料" }).click();
  const upload = page.getByRole("region", { name: "上传面料", exact: true });
  await upload.locator('input[type="file"]').setInputFiles({
    name: "swatch.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6AAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await upload.getByLabel(/标签/u).fill("高定羊毛");
  await upload
    .getByRole("button", { name: "保存到面料库", exact: true })
    .click();
  await effect(page, "material");

  const graph = await page.evaluate(async () =>
    (await fetch("/api/projects/atelier-visual/workflow/sync")).json(),
  );
  await page.route(`**/api/projects/${PROJECT}/workflow/sync`, (route) =>
    route.fulfill({ json: graph }),
  );
  await page.route(`**/api/projects/${PROJECT}/workflow`, (route) => {
    const input = route.request().postDataJSON();
    for (const operation of input.operations ?? [])
      if (operation.type === "add_node")
        graph.nodes.push({
          ...operation.node,
          status: "ready",
          createdAt: NOW,
          updatedAt: NOW,
        });
    graph.revision++;
    return route.fulfill({ json: graph });
  });
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: /添加素材/u }).click();
  await page.getByRole("button", { name: /面料库/u }).click();
  const library = page.getByRole("dialog", { name: "选择面料", exact: true });
  await library.getByRole("button", { name: /棉布/u }).first().click();
  await effect(page, "material");
  const arrival = await page.evaluate(() =>
    window.coutureSamples.find((item) => item.effect === "material"),
  );
  expect(arrival?.elapsed).toBeGreaterThan(300);
});

test("系列签章在新建后播放，重新打开不重播", async ({ page }) => {
  await observe(page);
  const collection = {
    id: "couture-collection",
    projectId: PROJECT,
    name: "线迹高定系列",
    sourceGarmentType: null,
    createdAt: NOW,
    updatedAt: NOW,
    hero: {
      assetId: "visual-look",
      thumbnailUrl: null,
      url: "/visual-garment.svg",
    },
    dna: {
      extractionStatus: "ready",
      fabrics: [],
      locks: {
        fabrics: false,
        moodWords: false,
        palette: false,
        silhouettes: false,
      },
      moodWords: [],
      palette: [],
      referenceFileIds: [],
      signatureDetails: [],
      silhouettes: [],
      updatedAt: NOW,
    },
  };
  await page.route("**/api/collections", (route) =>
    route.fulfill({ json: collection }),
  );
  await page.route("**/api/collections/couture-collection", (route) =>
    route.fulfill({ json: collection }),
  );
  await page.route(
    "**/api/collections/couture-collection/consistency",
    (route) =>
      route.fulfill({
        json: { looks: [], referenceLabel: "参考相似度", similarities: [] },
      }),
  );
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "适合画布", exact: true }).click();
  const candidate = page.getByRole("group", {
    name: "设计节点 藏蓝通勤外套",
    exact: true,
  });
  // Use the node's accessible details action even when the assistant overlaps its center.
  await candidate.focus();
  await candidate.press("Enter");
  await page
    .getByRole("button", { name: "设为主推款并建立系列", exact: true })
    .click();
  await effect(page, "seal");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "设为主推款并建立系列", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.coutureSamples.filter((item) => item.effect === "seal").length,
    ),
  ).toBe(1);
});

test("工作室保存与导出签章，恢复历史导出不重播", async ({ page }) => {
  await observe(page);
  let style = styleFixture();
  const data = () =>
    studioFixture({ styles: [style], techPacks: [techPackFixture()] });
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: data() }),
  );
  await page.route("**/images/*.png", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="120"><rect width="100" height="120" fill="#ddd"/></svg>',
    }),
  );
  await page.route("**/api/studio/styles/**", (route) =>
    route.fulfill({ json: style }),
  );
  await page.route("**/api/projects/*/studio/styles/**", (route) => {
    const input = route.request().postDataJSON();
    style = {
      ...style,
      name: input.name ?? style.name,
      version: 2,
      currentRevision: {
        ...style.currentRevision,
        id: "style-r2",
        revision: 2,
        payload: { ...style.currentRevision.payload, ...input },
      },
    };
    return route.fulfill({ json: style });
  });
  const job = {
    id: "couture-export",
    status: "succeeded",
    downloadUrl: "/couture-export.pdf",
  };
  let exported = false;
  await page.route("**/api/exports?*", (route) =>
    route.fulfill({ json: { items: exported ? [job] : [] } }),
  );
  await page.route("**/api/exports", (route) => {
    exported = true;
    return route.fulfill({ json: job });
  });
  await page.route("**/api/exports/couture-export", (route) =>
    route.fulfill({ json: job }),
  );
  await page.route("**/couture-export.pdf", (route) =>
    route.fulfill({
      contentType: "application/pdf",
      headers: { "Content-Disposition": "attachment; filename=couture.pdf" },
      body: "%PDF-1.4 test",
    }),
  );
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.getByLabel("款式名称", { exact: true }).fill("线迹高定夹克");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await effect(page, "seal");
  await page.getByRole("tab", { name: "技术包", exact: true }).click();
  await page
    .getByRole("button", { name: "导出此修订 PDF", exact: true })
    .click();
  await effect(page, "seal", 2);
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "下载已生成的技术包 PDF", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /^couture(?:-export)?\.pdf$/u,
  );
  await page.reload();
  await expect(
    page.getByRole("link", { name: "下载已生成的技术包 PDF", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.coutureSamples)).toEqual([]);
});

test("减少动态效果时不执行 Mo.js，生产包不预加载图形库", async ({ page }) => {
  await observe(page, true);
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (/\/_next\/static\/.*\.js(?:\?|$)/u.test(response.url()))
      scripts.push(response.text().catch(() => ""));
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "项目库", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => "mojs" in window)).toBe(false);
  // Turbopack dev eagerly registers async chunks; verify network splitting on the production build.
  if (process.env.ATELIER_PRODUCTION_TEST === "true")
    expect(
      (await Promise.all(scripts)).some((body) => /ShapeSwirl\s*:/u.test(body)),
    ).toBe(false);
  expect(await page.evaluate(() => window.coutureSamples)).toEqual([]);
});

test.describe("触屏动效", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("粒子减半，切换减少动态效果立即停止，保留成功文字", async ({ page }) => {
    await observe(page);
    await page.route(`**/api/projects/${PROJECT}/workflow`, (route) =>
      route.fulfill({ json: { revision: 2 } }),
    );
    await page.goto(`/trends?from=board&boardId=${PROJECT}`);
    await page
      .getByRole("button", { name: "加入工作流", exact: true })
      .first()
      .tap();
    await expect(page.locator('[data-couture-motion="stitch"]')).toBeVisible();
    expect(
      await page.locator('[data-couture-motion="stitch"] svg').count(),
    ).toBe(6);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("[data-couture-motion]")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("原始来源已保留");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
