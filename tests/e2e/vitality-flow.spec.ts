import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fashion:canvas-view", "workflow"));
});
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import {
  studioFixture,
  styleFixture,
} from "../../apps/web/src/modules/studio/studio-test-fixtures";
test("创作首页与工作室从真实修订接续，窄屏和减弱动态均可使用", async ({
  page,
}) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: studioFixture({ styles: [styleFixture()] }) }),
  );
  let summaryRequests = 0;
  await page.route(
    `**/api/projects/${PROJECT}/studio/creative-summary`,
    (route) => {
      summaryRequests++;
      return route.fulfill({ json: { styles: 1, assets: 3, packs: 0 } });
    },
  );
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "继续创作" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "继续创作" }).getByRole("link"),
  ).toHaveCount(1);
  expect(summaryRequests).toBe(0);
  await page.screenshot({
    path: "output/playwright/vitality-projects-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "继续创作", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("link", { name: "款式与交付", exact: true }).click();
  await page.getByRole("button", { name: "设计工具", exact: true }).click();
  await page.getByRole("tab", { name: "色料实验", exact: true }).click();
  await page.getByRole("button", { name: "创作进展" }).click();
  await expect(page.getByRole("region", { name: "创作进展" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "最近的创作记录" }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/playwright/vitality-studio-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog", { name: "创作进展", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.goto("/");
  await page.reload();
  await expect(
    page.getByText("继续你在本机的创作", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "继续创作", exact: true }),
  ).toHaveAttribute("href", new RegExp("studio\\?tab=experiments$", "u"));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("link", { name: "继续创作", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/playwright/vitality-projects-mobile.png",
    fullPage: true,
  });
  for (const path of ["/fabrics", "/trends", "/login"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/playwright/vitality-${path.slice(1)}-mobile.png`,
      fullPage: true,
    });
  }
});

test("引用显式加入且不自动发送，新结果提示不移动画布且刷新不重复提示", async ({
  page,
}) => {
  await seedVisualApp(page);
  await page.goto("/");
  const graph = await page.evaluate(async () =>
    (await fetch(`/api/projects/atelier-visual/workflow/sync`)).json(),
  );
  graph.nodes.find(
    (node: { type: string }) => node.type === "generate_design",
  ).status = "running";
  await page.route(`**/api/projects/${PROJECT}/workflow/sync`, (route) =>
    route.fulfill({ json: graph }),
  );
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
  });
  await page.goto(`/${PROJECT}`);
  await page.getByRole("button", { name: "适合画布", exact: true }).click();
  const candidate = page.getByRole("group", {
    name: "设计节点 藏蓝通勤外套",
    exact: true,
  });
  await expect(candidate).toBeVisible();
  const bounds = await candidate.boundingBox();
  if (!bounds) throw new Error("候选节点没有可见位置");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 25);
  const beforeSuggestion = writes;
  await page
    .getByRole("button", {
      name: "＋ 引用「藏蓝通勤外套」",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "向设计助手描述下一步", exact: true }),
  ).toHaveValue("");
  await expect(page.getByRole("button", { name: "移除引用 藏蓝通勤外套" })).toBeVisible();
  expect(writes).toBe(beforeSuggestion);
  graph.revision++;
  graph.nodes.find(
    (node: { type: string }) => node.type === "generate_design",
  ).status = "completed";
  graph.nodes.push({
    ...graph.nodes.find((node: { type: string }) => node.type === "candidate"),
    id: "new-result",
    title: "新到达的方案",
    x: 1500,
  });
  await expect(
    page.getByRole("button", { name: "查看新方案 ↗", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "稍后查看新方案", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "查看新方案 ↗", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("group", { name: "设计节点 藏蓝通勤外套", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("button", { name: "查看新方案 ↗", exact: true }),
  ).toHaveCount(0);
});
