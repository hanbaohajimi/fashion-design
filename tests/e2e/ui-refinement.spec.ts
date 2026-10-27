import { chooseValue } from "./choice-control";
import { test, expect } from "@playwright/test";
import { seedVisualApp, settleImages, PROJECT } from "../visual/fixtures";
import {
  workspaceFixture,
  experimentFixture,
} from "../visual/workspace-fixture";
import { controlFontFailures, contrastFailures } from "./review-accessibility";

const tabs = [
  "tasks",
  "styles",
  "experiments",
  "patterns",
  "presentation",
  "runway",
  "planning",
  "tech",
  "samples",
  "team",
  "trends",
  "brand",
];
test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({ json: workspaceFixture() }),
  );
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) =>
    route.fulfill({ json: experimentFixture(PROJECT) }),
  );
});

for (const width of [1440, 1280, 1024, 768, 375, 320]) {
  test(`全页面 ${width} 边界与候选截图`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const pages = [
      ...tabs.map((tab) => ({
        name: tab,
        url: `/${PROJECT}/studio?tab=${tab}${tab === "runway" ? "&showId=show-1&runId=run-1" : ""}`,
      })),
      { name: "projects", url: "/" },
      { name: "fabrics", url: "/fabrics" },
      { name: "archive", url: "/trends" },
      { name: "login", url: "/login" },
      { name: "confirm", url: "/auth/confirm" },
      { name: "share", url: `/share/${"a".repeat(43)}` },
      { name: "workbench", url: `/${PROJECT}` },
    ];
    for (const surface of pages) {
      await page.goto(surface.url);
      await expect(page.locator("main")).toBeVisible();
      if (tabs.includes(surface.name))
        await expect(
          page.locator('[role="tabpanel"]:not([hidden]) h2').first(),
        ).toBeVisible();
      if (surface.name === "fabrics")
        await expect(
          page
            .getByRole("img", { name: "棉布、哑光、通勤", exact: true })
            .first(),
        ).toBeVisible();
      if (surface.name === "archive")
        await expect(
          page.getByRole("heading", { name: "克制的都市通勤廓形" }),
        ).toBeVisible();
      if (surface.name === "runway")
        await expect(
          page.getByRole("list", { name: "服装秀制作阶段" }),
        ).toBeVisible();
      if (surface.name === "workbench")
        await expect(
          page.getByRole("heading", { name: "方案与灵感" }),
        ).toBeVisible();
      await settleImages(page);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth
          ? []
          : Array.from(document.querySelectorAll("main *"))
              .filter(
                (element) =>
                  element.checkVisibility() &&
                  element.getBoundingClientRect().right > innerWidth + 1,
              )
              .map((element) => ({
                tag: element.tagName,
                text: element.textContent?.slice(0, 45),
                width: element.getBoundingClientRect().width,
              })),
      );
      expect.soft(overflow, `${surface.name} ${width} overflow`).toEqual([]);
      expect
        .soft(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${surface.name} ${width} document width`,
        )
        .toBe(true);
      expect
        .soft(await controlFontFailures(page), `${surface.name} ${width} font`)
        .toEqual([]);
      expect
        .soft(
          await contrastFailures(page, true),
          `${surface.name} ${width} contrast`,
        )
        .toEqual([]);
      if (width === 1440 || width === 375)
        await page.screenshot({
          path: `output/ui-refinement/${surface.name}-${width}.png`,
          fullPage: true,
        });
    }
  });
}

test("素材目录搜索、取消、确认与焦点恢复", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  const trigger = page.getByRole("button", { name: /更换或添加图片/ }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("搜索设计图片").fill("不存在的素材");
  await expect(dialog.getByText("没有匹配的图片，请调整搜索。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "选择图片 2", exact: true }).click();
  await dialog.getByRole("button", { name: /确认选择/ }).click();
  await expect(
    page.getByText("有未保存的修改", { exact: true }).first(),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("只有一个款式时新建仍可返回原对象", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.getByRole("button", { name: "新建款式", exact: true }).click();
  await page.getByText("切换对象", { exact: true }).click();
  await page
    .getByRole("complementary", { name: "已有款式" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByLabel("款式名称", { exact: true })).not.toHaveValue(
    "",
  );
});

test("100 个样衣问题按状态筛选并切换当前编辑对象", async ({ page }) => {
  const data = workspaceFixture();
  const sample = data.samples[0];
  if (!sample) throw new Error("样衣测试资料缺失");
  const issues = Array.from({ length: 100 }, (_, index) => ({
    id: `issue-${index}`,
    assetId: "asset-front",
    x: 0.4,
    y: 0.5,
    category: "FIT" as const,
    text: `检查位置 ${index + 1}`,
    status: index % 2 ? ("FIXED" as const) : ("OPEN" as const),
    resolution: "",
  }));
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({
      json: {
        ...data,
        samples: [
          {
            ...sample,
            currentRevision: {
              ...sample.currentRevision,
              payload: { ...sample.currentRevision.payload, issues },
            },
          },
        ],
      },
    }),
  );
  await page.goto(`/${PROJECT}/studio?tab=samples`);
  await chooseValue(page.getByLabel("筛选问题状态"), "FIXED");
  const index = page.getByRole("navigation", { name: "样衣问题切换" });
  await expect(index.getByRole("button")).toHaveCount(50);
  await index.getByRole("button", { name: /100\./ }).click();
  await expect(page.locator('[data-sample-issue="issue-99"]')).toBeVisible();
  await expect(
    page.getByLabel("问题描述", { exact: true }).filter({ visible: true }),
  ).toHaveValue("检查位置 100");
});

test("款式入口将确切修订带入商品展示并在刷新后保留", async ({ page }) => {
  const revisionId = workspaceFixture().styles[0]?.currentRevision.id;
  await page.goto(`/${PROJECT}/studio?tab=styles`);
  await page.getByRole("button", { name: "继续商品展示", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tab=presentation.*styleRevisionId=${revisionId}`));
  await expect(page.getByLabel("采用款式修订")).toHaveValue(revisionId ?? "");
  await page.reload();
  await expect(page.getByLabel("采用款式修订")).toHaveValue(revisionId ?? "");
});

test("分享图片失败可重试，失效链接提供恢复入口", async ({ page }) => {
  let failed = true;
  await page.route("**/visual-garment.svg", async (route) => {
    if (failed) return route.fulfill({ status: 503, body: "" });
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="green"/></svg>',
    });
  });
  await page.goto(`/share/${"a".repeat(43)}`);
  await expect(page.getByRole("button", { name: "重试预览" })).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "重试预览" }).click();
  await expect(page.getByRole("img", { name: "分享的设计图片" })).toBeVisible();
  await page.route("**/api/image-shares/*", (route) =>
    route.fulfill({ status: 410, json: {} }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "暂时无法查看这份设计" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
});

test("窗口滚动可到达面料末尾，分享原图完整落在视口内", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/fabrics");
  await expect(
    page.getByRole("img", { name: "棉布、哑光、通勤", exact: true }).first(),
  ).toBeVisible();
  await page.mouse.wheel(0, 3000);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(1000);
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "棉布、哑光、通勤", exact: true })
        .evaluateAll(
          (images) =>
            images.filter((image) => {
              const box = image.getBoundingClientRect();
              return box.bottom > 0 && box.top < innerHeight;
            }).length,
        ),
    )
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/share/${"a".repeat(43)}`);
  const artwork = page.getByRole("img", { name: "分享的设计图片" });
  await expect(artwork).toBeVisible();
  const bounds = await artwork.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(900);
});

test("助手回复渲染列表表格与引用并忽略原始 HTML", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(
    "**/api/agent-conversations/visual-chat/messages*",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "markdown-reply",
              role: "assistant",
              status: "completed",
              kind: "reply",
              createdAt: "2026-10-20T02:00:00Z",
              content:
                "## 配色建议\n\n保留完整肩线。\n\n- 藏蓝\n- 米白\n\n| 部位 | 材质 |\n| --- | --- |\n| 衣身 | 棉布 |\n\n> 先确认面料再生成。\n\n<button>不应出现的按钮</button>",
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await page.goto(`/${PROJECT}`);
  await expect(page.getByRole("heading", { name: "配色建议" })).toBeVisible();
  const reply = page.locator('[data-message-id="markdown-reply"]');
  await expect(reply.locator("li")).toHaveCount(2);
  await expect(reply.getByRole("table")).toBeVisible();
  await expect(reply.locator("blockquote")).toContainText("先确认面料");
  await expect(
    reply.getByRole("button", { name: "不应出现的按钮" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "output/ui-refinement/assistant-markdown-1440.png",
  });
});
