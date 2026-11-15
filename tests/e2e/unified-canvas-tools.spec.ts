import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { prepareImageEditing } from "./image-editing-fixture";
import { imageToolEntries } from "../../apps/web/src/modules/board/workflow/image-tool-entry";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import { prepareNodeEntry } from "./node-entry-fixture";
import { loadZhiya } from "./zhiya-fixture";
import { PROJECT } from "../visual/fixtures";
import { canvasAction } from "./canvas-workspace-controls";

test.setTimeout(90_000);
for (const width of [1440, 390]) test(`${width}px 历史图片不可覆盖时仍可使用全部图片工具，打开不执行`, async ({ page }) => {
  const state = await prepareImageEditing(page, width, width < 700 ? 844 : 900);
  const image = page.getByRole("group", { name: "藏蓝通勤外套", exact: true });
  const box = await image.boundingBox(); if (!box) throw new Error("缺少图片");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const toolbar = page.getByRole("toolbar", { name: "常用图片工具", exact: true }); await expect(toolbar).toBeVisible();
  for (const name of width >= 700 ? ["局部重绘", "擦除", "移除背景", "换色", "换面料"] : ["局部重绘", "擦除", "移除背景"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeEnabled();
  }
  await mkdir("output/playwright/image-tools-fix", { recursive: true });
  await toolbar.screenshot({ path: `output/playwright/image-tools-fix/toolbar-${width}.png` });
  await page.getByRole("textbox", { name: "本次创作要求" }).fill("保留这条独立创作草稿");
  for (const [index, entry] of imageToolEntries.entries()) {
    const trigger = index < 3 ? toolbar.getByRole("button", { name: entry.label, exact: true }) : toolbar.getByRole("button", { name: "更多图片操作", exact: true });
    await trigger.click();
    if (index >= 3) await page.getByRole("group", { name: "更多图片操作选项", exact: true }).getByRole("button", { name: entry.label, exact: true }).click();
    const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true }).filter({ visible: true });
    await expect(workspace).toBeVisible();
    if (entry.action === "crop") await expect(workspace.getByRole("button", { name: "裁剪比例", exact: true })).toBeVisible();
    else if (entry.action === "orient") await expect(workspace.getByLabel("旋转角度", { exact: true })).toBeVisible();
    else if (entry.action === "remove_background") await expect(workspace.getByRole("button", { name: "移除背景并生成新版本", exact: true })).toBeVisible();
    if (entry.action === "remove_background") await workspace.screenshot({ path: `output/playwright/image-tools-fix/editor-${width}.png` });
    await workspace.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
    await expect(workspace).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(page.getByRole("textbox", { name: "本次创作要求" })).toHaveValue("保留这条独立创作草稿");
  }
  expect(state.commands).toEqual([]); expect(state.masks).toEqual([]); expect(state.errors).toEqual([]);
});

test("历史图片的换色和换面料带入原图，只打开参数不生成", async ({ page }) => {
  const state = await prepareNodeEntry(page);
  Object.assign(state.graph, { nodes: state.graph.nodes.map(node => ({ ...node, canDelete: false, canEditPayload: false, canForkPayload: false })) });
  const original = structuredClone(state.graph.nodes[0]);
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: studioFixture({ assets: [{ id: "look-0", url: "/visual-garment.svg", thumbnailUrl: null }] }) }));
  await page.route(`**/api/projects/${PROJECT}/experiments`, route => route.fulfill({ json: [] }));
  await loadZhiya(page);
  for (const [action, title] of [["换色", "换色实验"], ["换面料", "换面料"]] as const) {
    await canvasAction(page, "查看全图");
    const image = await page.getByRole("group", { name: "通勤外套 1", exact: true }).boundingBox();
    if (!image) throw new Error("缺少历史图片");
    await page.mouse.click(image.x + image.width / 2, image.y + Math.min(80, image.height / 4));
    await page.getByRole("toolbar", { name: "常用图片工具", exact: true }).getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog.getByRole("img", { name: "本轮实验母图", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("本轮目标", { exact: true })).toHaveValue("");
    expect(state.items.at(-1)?.draft.inputs[0]?.nodeId).toBe("material-0");
    await dialog.getByRole("button", { name: "返回画布", exact: true }).click();
  }
  expect(state.graph.nodes[0]).toEqual(original);
  expect(state.imageCalls()).toBe(0);
  expect(state.commands).toEqual([]);
  expect(state.errors).toEqual([]);
});
