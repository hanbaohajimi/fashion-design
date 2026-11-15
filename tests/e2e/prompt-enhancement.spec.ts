import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { NOW, PROJECT } from "../visual/fixtures";

const field = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const endpoint = "**/api/projects/*/assistant/prompt-enhancements";
const original = "服装设计，先不要生成";
const enhanced =
  "请结合图1整理服装设计要求，明确设计目标与可调整范围，暂不生成图片。";
async function open(page: Page, width = 1440) {
  const state = await prepareZhiya(page, {
    realClock: true,
    count: 2,
    viewport: { width, height: 900 },
  });
  await loadZhiya(page);
  await openZhiya(page);
  await field(page).fill(original);
  return state;
}
async function reference(page: Page) {
  await page.getByRole("button", { name: "添加素材", exact: true }).click();
  await page.getByRole("button", { name: "添加引用", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加引用", exact: true });
  await picker.getByRole("checkbox", { name: /通勤外套 1/ }).check();
  await picker
    .getByRole("button", { name: "使用所选引用", exact: true })
    .click();
  await expect(picker).toBeHidden();
}

for (const width of [1440, 390, 320])
  test(`${width}px主动增强回填和撤销，保留引用且不发送或生图`, async ({
    page,
  }) => {
    const state = await open(page, width);
    await reference(page);
    const calls: { prompt: string; referencedNodeIds: string[] }[] = [];
    await page.route(endpoint, (route) => {
      const input = route.request().postDataJSON();
      calls.push(input);
      return route.fulfill({
        json: { requestId: input.requestId, enhancedPrompt: enhanced },
      });
    });
    expect(calls).toHaveLength(0);
    await page.getByRole("button", { name: "增强提示词", exact: true }).click();
    await expect(field(page)).toHaveValue(enhanced);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      prompt: original,
      referencedNodeIds: ["material-0"],
    });
    await expect(page.locator("[data-assistant-reference-id]")).toHaveCount(1);
    await mkdir("output/prompt-enhancement/screenshots", { recursive: true });
    await page.mouse.move(10, 10);
    await page
      .locator("#workflow-design-assistant")
      .screenshot({
        path: `output/prompt-enhancement/screenshots/enhanced-${width}.png`,
        animations: "disabled",
      });
    await page.getByRole("button", { name: "撤销增强", exact: true }).click();
    await expect(field(page)).toHaveValue(original);
    expect(
      state.mutations.filter((path) => !path.includes("/prompt-enhancements")),
    ).toEqual([]);
    expect(state.errors).toEqual([]);
  });

test("增强期间编辑的草稿需明确采用，Enter不会误发", async ({ page }) => {
  const state = await open(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(endpoint, async (route) => {
    const input = route.request().postDataJSON();
    calls++;
    await gate;
    await route.fulfill({
      json: { requestId: input.requestId, enhancedPrompt: enhanced },
    });
  });
  await page.getByRole("button", { name: "增强提示词", exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await field(page).fill("我后来输入的新要求");
  await field(page).press("Enter");
  await expect(
    page.getByRole("button", { name: "发送需求", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("button", { name: "使用增强结果", exact: true }),
  ).toBeVisible();
  await expect(field(page)).toHaveValue("我后来输入的新要求");
  await page.getByRole("button", { name: "使用增强结果", exact: true }).click();
  await expect(field(page)).toHaveValue(enhanced);
  await page.getByRole("button", { name: "撤销增强", exact: true }).click();
  await expect(field(page)).toHaveValue("我后来输入的新要求");
  expect(
    state.mutations.filter((path) => !path.includes("/prompt-enhancements")),
  ).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("失败保留原文，切换会话后迟到的增强结果不回填", async ({ page }) => {
  await open(page);
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 503,
      json: { message: "增强暂时不可用，原文已保留。" },
    }),
  );
  await page.route(`**/api/projects/${PROJECT}/agent-conversations`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: {
            id: "new-chat",
            mode: "workflow",
            title: "新对话",
            createdAt: NOW,
            updatedAt: NOW,
            archivedAt: null,
            messageCount: 0,
          },
        })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "增强提示词", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "增强暂时不可用" }),
  ).toBeVisible();
  await expect(field(page)).toHaveValue(original);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(endpoint, async (route) => {
    const input = route.request().postDataJSON();
    calls++;
    await gate;
    await route
      .fulfill({
        json: { requestId: input.requestId, enhancedPrompt: enhanced },
      })
      .catch(() => undefined);
  });
  await page.getByRole("button", { name: "增强提示词", exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await expect(field(page)).toHaveValue("");
  release();
  await expect(
    page.getByRole("button", { name: "撤销增强", exact: true }),
  ).toHaveCount(0);
});

test("全部功能不再创建需求分析或评估，图片创作继续保留", async ({ page }) => {
  const state = await prepareZhiya(page, { realClock: true });
  await loadZhiya(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "全部功能模块",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "需求分析", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "方案评估", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "图片创作", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
