import { expect, test, type Page } from "@playwright/test";
import {
  runwayActionSchema,
  runwayCreateShowSchema,
  runwayStartSchema,
  type RunwayAction,
} from "../../packages/shared/src/runway";
import {
  runwayRunFixture,
  runwayMediaFixture,
  runwayShowFixture,
  RUNWAY_TEST_NOW,
} from "../../apps/web/src/modules/runway/runway-test-fixtures";
import {
  studioFixture,
  styleFixture,
} from "../../apps/web/src/modules/studio/studio-test-fixtures";

const base = "/api/projects/project-1/runway";
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750"><rect width="500" height="750" fill="#e7e9e2"/><path d="M180 150 90 210 65 370 140 390 155 280 155 620 345 620 345 280 360 390 435 370 410 210 320 150 280 195 250 170 220 195Z" fill="#586a60"/></svg>';
test.setTimeout(60_000);
test.use({ video: { mode: "on", size: { width: 1280, height: 900 } } });

test.describe("本地视频缓冲反馈", () => {
  test("真实本地媒体保留原生操作，等待反馈不触发自动播放", async ({ page }) => {
    await prepare(page);
    const run = runwayRunFixture({ status: "SUCCEEDED", stage: "finished", pendingInput: null, media: [{
      ...runwayMediaFixture("buffer-preview", "final_video"), mimeType: "video/webm", contentUrl: "/painting-loaders/irises.webm",
    }] });
    await page.route("**/api/projects/project-1/runway/runs/run-1", route => route.fulfill({ json: run }));
    await page.route("**/api/projects/project-1/runway/shows/show-1", route => route.fulfill({ json: runwayShowFixture({ runs: [run] }) }));
    await page.goto("/project-1/studio?tab=runway&showId=show-1&runId=run-1");
    const video = page.locator("video").first();
    await expect(video).toBeVisible();
    await video.evaluate(async element => { element.muted = true; await element.play(); });
    await expect.poll(() => video.evaluate(element => element.videoWidth)).toBeGreaterThan(0);
    await expect(video).toHaveAttribute("controls", "");
    await video.evaluate(element => {
      Object.defineProperty(element, "readyState", { configurable: true, get: () => 1 });
      element.dispatchEvent(new Event("waiting"));
    });
    await expect(page.getByText("视频正在缓冲，保留当前画面", { exact: true })).toBeVisible();
    await page.screenshot({ path: "output/ui-motion/video-buffering.png" });
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.getByText("视频正在缓冲，保留当前画面", { exact: true })).toHaveCSS("position", "static");
    await page.screenshot({ path: "output/ui-motion/video-buffering-high-contrast.png" });
    await page.emulateMedia({ forcedColors: "none" });
    await video.evaluate(element => {
      Reflect.deleteProperty(element, "readyState");
      element.dispatchEvent(new Event("playing"));
    });
    await expect(page.getByText("视频正在缓冲，保留当前画面")).not.toBeVisible();
    await video.evaluate(element => { element.pause(); element.dispatchEvent(new Event("waiting")); });
    await page.waitForTimeout(350);
    expect(await video.evaluate(element => element.paused)).toBe(true);
    await expect(page.getByText("视频正在缓冲，保留当前画面")).not.toBeVisible();
  });
});

// Real Next.js UI with isolated API fixtures. No database, model or queue claim.
async function prepare(
  page: Page,
  { canEdit = true, empty = false, enabled = true } = {},
) {
  const data = studioFixture({
    styles: [styleFixture()],
    role: canEdit ? "OWNER" : "VIEWER",
    capabilities: { edit: canEdit, review: canEdit, manageMembers: canEdit },
  });
  let run = runwayRunFixture();
  let shows = empty ? [] : [runwayShowFixture()];
  const actions: RunwayAction[] = [];
  const unexpected: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/me")
      return route.fulfill({
        json: {
          user: {
            id: "runway-user",
            authId: "runway-auth",
            email: "runway@example.com",
            name: "设计师",
            avatar: null,
            createdAt: RUNWAY_TEST_NOW,
            deletedAt: null,
          },
          credits: { limit: 600, remaining: 500, used: 100 },
        },
      });
    if (path === "/api/projects/project-1")
      return route.fulfill({
        json: {
          id: "project-1",
          name: "庭院亚麻系列",
          archived: false,
          createdAt: RUNWAY_TEST_NOW,
          updatedAt: RUNWAY_TEST_NOW,
          assetCount: data.assets.length,
          coverAssetId: null,
          coverUrl: null,
        },
      });
    if (path === "/api/projects/project-1/studio")
      return route.fulfill({ json: data });
    if (path === `${base}/capabilities`)
      return route.fulfill({
        json: {
          enabled,
          workerOnline: true,
          mode: "mock",
          canEdit,
          capabilities: { image: true, video: true, music: true },
        },
      });
    if (path === `${base}/shows` && method === "GET")
      return route.fulfill({ json: shows });
    if (path === `${base}/shows/show-1` && method === "GET")
      return route.fulfill({
        json:
          shows.find((show) => show.id === "show-1") ??
          runwayShowFixture({ runs: [] }),
      });
    if (path === `${base}/shows` && method === "POST") {
      const body = runwayCreateShowSchema.parse(request.postDataJSON());
      const show = runwayShowFixture({
        title: body.title,
        draft: body.draft,
        runs: [],
      });
      shows = [show];
      return route.fulfill({ status: 201, json: show });
    }
    if (path === `${base}/shows/show-1/runs`) {
      runwayStartSchema.parse(request.postDataJSON());
      run = runwayRunFixture({
        status: "QUEUED",
        stage: "prepare",
        pendingInput: null,
        media: [],
      });
      shows = shows.map((show) => ({ ...show, runs: [run] }));
      return route.fulfill({ json: run });
    }
    if (path === `${base}/runs/run-1`) return route.fulfill({ json: run });
    if (path === `${base}/runs/run-1/events`)
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": waiting\n\n",
      });
    if (path === `${base}/runs/run-1/actions`) {
      const action = runwayActionSchema.parse(request.postDataJSON());
      actions.push(action);
      run = {
        ...run,
        status: "QUEUED",
        version: run.version + 1,
        pendingInput: null,
      };
      shows = shows.map((show) => ({
        ...show,
        runs: show.runs.map((item) => (item.id === run.id ? run : item)),
      }));
      return route.fulfill({ json: run });
    }
    if (path.includes("/runway/media/"))
      return route.fulfill({ contentType: "image/svg+xml", body: image });
    unexpected.push(`${method} ${path}`);
    return route.fulfill({
      status: 404,
      json: { message: `未配置的测试请求 ${path}` },
    });
  });
  await page.route("**/images/*.png", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: image }),
  );
  return { actions, unexpected };
}

test("服装秀深链优先于 assetId，配对提交媒体 ID 并在刷新后恢复", async ({
  page,
}) => {
  const state = await prepare(page);
  await page.goto(
    "/project-1/studio?tab=runway&assetId=asset-front&showId=show-1&runId=run-1",
  );
  await expect(page.getByRole("heading", { name: "庭院亚麻秀" })).toBeVisible();
  await expect(
    page.getByText(
      "当前使用模拟生成服务，图片和视频仅用于验证制作流程，不代表真实模型效果。",
    ),
  ).toBeVisible();
  await page.getByLabel("模特 1 的服装").selectOption("cloth-b");
  await page.getByRole("button", { name: "确认配对并试衣" }).click();
  await expect.poll(() => state.actions.length).toBe(1);
  expect(state.actions[0]).toMatchObject({
    kind: "pair",
    interruptId: "interrupt-pair",
    expectedVersion: 3,
    pairings: [
      { modelMediaId: "model-a", clothMediaId: "cloth-b" },
      { modelMediaId: "model-b", clothMediaId: "cloth-b" },
    ],
  });
  await expect(page.getByText("等待执行", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "庭院亚麻秀" })).toBeVisible();
  await expect(page.getByLabel("运行历史")).toHaveValue("run-1");
  expect(state.unexpected).toEqual([]);
});

test("从款式修订建立服装秀，保存与执行分开", async ({ page }) => {
  const state = await prepare(page, { empty: true });
  await page.goto("/project-1/studio?tab=styles");
  await page.getByRole("button", { name: "制作服装秀" }).click();
  await expect(page).toHaveURL(/tab=runway.*styleRevisionId=style-r1/);
  await expect(page.getByRole("heading", { name: "建立服装秀" })).toBeVisible();
  await expect(
    page.getByRole("list").getByText("褶线夹克 · r1", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("秀场需求", { exact: true })
    .fill("保留褶线夹克细节，在清晨庭院中进行两人走秀");
  await page.getByLabel("出场人数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "保存需求" }).click();
  await expect(
    page.getByRole("button", { name: "开始制作服装秀" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "服装秀制作进度" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "开始制作服装秀" }).click();
  await expect(page.getByText("等待执行", { exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test("只读成员可查看与下载，手机布局无横向溢出", async ({ page }) => {
  const state = await prepare(page, { canEdit: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/project-1/studio?tab=runway&showId=show-1&runId=run-1");
  await expect(page.getByRole("heading", { name: "庭院亚麻秀" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认配对并试衣" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "下载原图" })).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/playwright/runway-workspace-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "本次运行的需求" }).click();
  await expect(page.getByRole("region", { name: "本次运行的需求快照" })).toContainText("清晨庭院中的亚麻服装秀");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "output/playwright/runway-input-snapshot-mobile.png", fullPage: true });
  expect(state.actions).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("桌面制作阶段可聚焦与切换，当前阶段可恢复定位", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/project-1/studio?tab=runway&showId=show-1&runId=run-1");
  await expect(page.getByRole("heading", { name: "庭院亚麻秀" })).toBeVisible();
  const current = page.getByRole("button", { name: /模特与服装.*当前/ });
  await current.focus();
  await expect(current).toBeFocused();
  await page.getByRole("button", { name: /4.*视频镜头/ }).click();
  await expect(
    page.getByRole("heading", { name: "本阶段尚无成果" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "定位当前阶段" }).click();
  await expect(page.getByLabel("模特 1 的服装")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/playwright/runway-workspace-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "本次运行的需求" }).click();
  await expect(page.getByRole("region", { name: "本次运行的需求快照" })).toContainText("清晨庭院中的亚麻服装秀");
  await page.screenshot({ path: "output/playwright/runway-input-snapshot-desktop.png", fullPage: true });
});
