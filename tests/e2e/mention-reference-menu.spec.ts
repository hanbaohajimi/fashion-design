import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepareZhiya, loadZhiya, openZhiya } from "./zhiya-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import type { WorkflowNode } from "../../apps/web/src/modules/board/workflow/workflow-api";

const output = "output/mention-reference-menu";
const opaque = "4be5c6b871ac012345678901234567890.png";
async function setup(page: Page, width = 1440, height = 900) {
  const state = await prepareZhiya(page, {
    realClock: true,
    count: 9,
    viewport: { width, height },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useCanvasPhotograph(page);
  const original = state.graph.nodes[0];
  if (!original) throw new Error("缺少画布测试对象");
  const node = (
    index: number,
    title: string,
    type: WorkflowNode["type"],
    payload: WorkflowNode["payload"],
    kind: WorkflowNode["kind"] = "asset",
  ): WorkflowNode => ({
    ...original,
    id: `material-${index}`,
    title,
    type,
    payload,
    kind,
  });
  Object.assign(state.graph, {
    nodes: [
      node(0, opaque, "candidate", {
        assetId: "look-0",
        imageUrl: "/visual-garment.svg",
        generation: "不应显示的执行参数",
      }),
      node(1, "系列造型", "candidate", {
        assetId: "look-1",
        imageUrl: "/visual-garment.svg",
      }),
      node(2, "系列造型", "candidate", {
        assetId: "look-2",
        imageUrl: "/visual-garment.svg",
      }),
      node(3, "设计要求", "reference_text", {
        text: "保留肩线与衣身轮廓，使用哑光面料。",
      }),
      node(4, "暖色方案", "swatch", {
        colors: [{ hex: "#8d5a48", name: "陶土" }],
      }),
      node(5, "失效图片", "reference_image", {
        imageUrl: "/missing-mention.png",
      }),
      node(
        6,
        "后台执行参数",
        "generate_design",
        { params: { debug: "technical-metadata" } },
        "tool",
      ),
      node(7, "内部历史记录", "legacy", {}),
      node(8, "c5f498218a8d45d49956a4aac7e422a9.jpg", "reference_image", {
        imageUrl: "/visual-garment.svg",
      }),
    ],
  });
  await page.route("**/missing-mention.png", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await mkdir(output, { recursive: true });
  await loadZhiya(page);
  await openZhiya(page);
  return state;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 450 },
]) {
  test(`${viewport.width}px对话@列表仅显示缩略图和简短名称，背景信息与ID不出现`, async ({
    page,
  }) => {
    const state = await setup(page, viewport.width, viewport.height);
    const input = page.getByRole("textbox", {
      name: "描述设计需求",
      exact: true,
    });
    await input.fill("@");
    const list = page.getByRole("listbox", {
      name: "引用画布节点",
      exact: true,
    });
    await expect(list.getByRole("option")).toHaveText([
      "设计方案",
      "系列造型（1）",
      "系列造型（2）",
      "设计要求",
      "暖色方案",
      "失效图片",
    ]);
    await expect(list.getByText(opaque)).toHaveCount(0);
    await expect(
      list.getByText(
        /material-|后台执行参数|technical-metadata|内部历史记录|素材|工具/,
      ),
    ).toHaveCount(0);
    const thumbnail = list
      .getByRole("option", { name: "设计方案", exact: true })
      .locator("img");
    await expect(thumbnail).toHaveCSS("object-fit", "contain");
    await expect
      .poll(() =>
        thumbnail.evaluate(
          (element) => (element as HTMLImageElement).naturalWidth,
        ),
      )
      .toBeGreaterThan(0);
    const broken = list.getByRole("option", { name: "失效图片", exact: true });
    await expect(broken.locator("img")).toHaveCount(0);
    await expect(broken.locator("svg")).toHaveCount(1);
    const popup = page.locator("[data-assistant-mention-popup]");
    expect(
      await popup.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const bounds = await popup.boundingBox();
    expect(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width &&
        bounds.y + bounds.height <= viewport.height,
    ).toBe(true);
    await page.screenshot({
      path: `${output}/assistant-${viewport.width}.png`,
      animations: "disabled",
    });
    await popup.screenshot({
      path: `${output}/menu-${viewport.width}.png`,
      animations: "disabled",
    });
    await list
      .getByRole("option", { name: "系列造型（2）", exact: true })
      .click();
    await expect(input).toHaveValue("@系列造型 ");
    await expect(
      page.locator('[data-assistant-reference-id="material-2"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-assistant-reference-id="material-1"]'),
    ).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(list).toBeHidden();
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("按可读名称搜索图片、键盘选择保持原对象身份与光标", async ({ page }) => {
  const state = await setup(page);
  const input = page.getByRole("textbox", {
    name: "描述设计需求",
    exact: true,
  });
  await input.fill("参考@参考图，保留轮廓。");
  await input.press("Home");
  for (let index = 0; index < 6; index++) await input.press("ArrowRight");
  const list = page.getByRole("listbox", { name: "引用画布节点", exact: true });
  await expect(
    list.getByRole("option", { name: "参考图片", exact: true }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(
    page.locator('[data-assistant-reference-id="material-8"]'),
  ).toHaveCount(1);
  await expect(input).toHaveValue(
    "参考@c5f498218a8d45d49956a4aac7e422a9.jpg，保留轮廓。",
  );
  await expect(input).toBeFocused();
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("图片创作框的@候选也显示图片，不再显示节点编号", async ({ page }) => {
  const state = await prepareZhiya(page, {
    realClock: true,
    count: 3,
    viewport: { width: 1440, height: 900 },
  });
  await useCanvasPhotograph(page);
  await loadZhiya(page);
  const image = page.getByRole("group", { name: "通勤外套 1", exact: true });
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error("画布图片未就绪");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const input = page.getByRole("textbox", {
    name: "本次创作要求",
    exact: true,
  });
  await input.fill("@");
  const list = page.getByRole("listbox", { name: "可引用素材", exact: true });
  const option = list.getByRole("option", { name: "通勤外套 2", exact: true });
  await expect(option.locator("img")).toBeVisible();
  await expect(option).toHaveText("通勤外套 2");
  await expect(list.locator("small")).toHaveCount(0);
  await page.screenshot({
    path: `${output}/creation-1440.png`,
    animations: "disabled",
  });
  await option.click();
  await expect(input).toHaveValue("图2");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
