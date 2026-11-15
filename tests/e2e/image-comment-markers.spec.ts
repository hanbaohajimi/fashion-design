import { imageScale, zoomImageToDetail } from "./image-workspace-controls";
import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { prepareImageEditing } from "./image-editing-fixture";
import { type ImageFeedback } from "../../packages/shared/src";

test.setTimeout(90_000);
test.use({ video: process.env.FASHION_MOTION_VIDEO === "1" ? { mode: "on", size: { width: 1440, height: 960 } } : "off" });
test.beforeEach(async () => { await mkdir("output/playwright/image-comment-markers", { recursive: true }); });

async function prepare(page: Page, width = 1440, initial?: ImageFeedback) {
  const state = await prepareImageEditing(page, width);
  let feedback: ImageFeedback = initial ?? { revision: 0, annotations: [], comments: [] };
  await page.route("**/api/design-assets/*/feedback", route => {
    if (route.request().method() === "PUT") feedback = { ...route.request().postDataJSON() as ImageFeedback, revision: feedback.revision + 1 };
    return route.fulfill({ json: feedback });
  });
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace.getByRole("button", { name: "添加评论", exact: true }).click();
  return { ...state, workspace, feedback: () => feedback };
}
const composer = (workspace: Locator) => workspace.getByRole("group", { name: /新增修改意见|编辑意见/ });
const draftPin = (workspace: Locator) => workspace.getByRole("button", { name: /^调整标记/ });
async function add(workspace: Locator, text: string) {
  await workspace.getByLabel("图片评论").fill(text);
  await composer(workspace).getByRole("button", { name: "添加评论", exact: true }).click();
}

for (const width of [1440, 320]) {
  test(`${width}px 标记位置、编辑身份与勾选刷新恢复，意见只更新一次`, async ({ page }) => {
    const state = await prepare(page, width);
    const { workspace } = state;
    await composer(workspace).getByRole("button", { name: "定位到图片中心" }).click();
    await expect(draftPin(workspace)).toBeVisible();
    await draftPin(workspace).focus();
    await page.keyboard.press("ArrowRight");
    await add(workspace, "收窄袖口，保留面料纹理");
    await add(workspace, "维持整体色调");
    await workspace.getByLabel("选择意见 2", { exact: true }).uncheck();
    await workspace.getByRole("button", { name: "保存评论", exact: true }).click();
    await expect.poll(() => state.feedback().comments.length).toBe(2);
    await workspace.getByRole("button", { name: /^编辑图片标记 1/ }).click();
    await workspace.getByLabel("图片评论").fill("袖口再收窄一点，保留面料纹理");
    await draftPin(workspace).focus();
    await page.keyboard.press("Shift+ArrowDown");
    await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
    await state.open();
    await expect(workspace.getByLabel("图片评论")).toHaveValue("袖口再收窄一点，保留面料纹理");
    await page.reload();
    await state.open();
    await expect(composer(workspace)).toHaveAccessibleName("编辑意见 1");
    await expect(workspace.getByLabel("选择意见 1", { exact: true })).toBeChecked();
    await expect(workspace.getByLabel("选择意见 2", { exact: true })).not.toBeChecked();
    await expect(draftPin(workspace)).toHaveCount(1);
    await workspace.screenshot({ path: `output/playwright/image-comment-markers/draft-${width}.png` });
    await composer(workspace).getByRole("button", { name: "更新评论" }).click();
    await workspace.getByRole("button", { name: "保存评论", exact: true }).click();
    await expect.poll(() => state.feedback().comments[0]?.text).toBe("袖口再收窄一点，保留面料纹理");
    expect(state.feedback().comments).toHaveLength(2);
    expect(state.feedback().comments[0]?.point?.x).toBeCloseTo(.51, 3);
    expect(state.feedback().comments[0]?.point?.y).toBeCloseTo(.6, 3);
    expect(state.feedback().comments[0]?.annotationIds).toEqual([]);
    expect(state.commands).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.errors).toEqual([]);
  });
}

test("图片外点击、拖动、取消与双指不落标记，200% 标记保持可点击尺寸", async ({ page }) => {
  const { workspace } = await prepare(page);
  const view = workspace.getByLabel("图片查看区域");
  const box = await view.boundingBox();
  if (!box) throw new Error("图片区域缺失");
  await page.mouse.click(box.x + 3, box.y + 3);
  await expect(draftPin(workspace)).toHaveCount(0);
  const picture = workspace.getByAltText("藏蓝通勤外套", { exact: true });
  const rect = await picture.boundingBox();
  if (!rect) throw new Error("原图缺失");
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y + 10); await page.mouse.up();
  await expect(draftPin(workspace)).toHaveCount(0);
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(draftPin(workspace)).toHaveCount(0);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }, { x: x + 30, y, id: 2 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
  await expect(draftPin(workspace)).toHaveCount(0);
  await page.mouse.click(x, y, { button: "right" });
  await page.keyboard.press("Escape");
  if (!await composer(workspace).isVisible()) await workspace.getByRole("button", { name: "添加评论", exact: true }).click();
  await expect(draftPin(workspace)).toHaveCount(0);
  await workspace.getByRole("button", { name: "收起工具", exact: true }).click();
  await zoomImageToDetail(workspace);
  await workspace.getByRole("button", { name: "添加评论", exact: true }).click();
  const zoomed = await picture.boundingBox();
  if (!zoomed) throw new Error("缩放图片缺失");
  await page.mouse.click(zoomed.x + zoomed.width / 2, zoomed.y + zoomed.height / 2);
  await expect(draftPin(workspace)).toBeVisible();
  const pin = await draftPin(workspace).boundingBox();
  expect(pin?.width).toBeCloseTo(44, 0);
  expect(pin?.height).toBeCloseTo(44, 0);
  await add(workspace, "缩放后仍指向中心");
  await workspace.getByRole("button", { name: "保存评论", exact: true }).click();
  await expect.poll(() => imageScale(workspace)).toBeCloseTo(2, 2);
  await workspace.screenshot({ path: "output/playwright/image-comment-markers/zoomed.png" });
});

test("切换标记不会覆盖当前草稿，提交等待与丢失回执保留同一份意见", async ({ page }) => {
  const state = await prepare(page);
  const { workspace } = state;
  await composer(workspace).getByRole("button", { name: "定位到图片中心" }).click();
  await add(workspace, "收窄袖口");
  await workspace.getByLabel("图片评论").fill("还没有添加的草稿");
  await workspace.getByRole("button", { name: /^编辑图片标记 1/ }).click();
  await expect(workspace.getByLabel("图片评论")).toHaveValue("还没有添加的草稿");
  await expect(workspace.getByRole("status")).toContainText("先添加、更新或取消当前评论");
  await composer(workspace).getByRole("button", { name: "清空草稿" }).click();
  state.holdNextSubmission(); state.loseNextResponse();
  await workspace.getByRole("button", { name: "按选中意见修改" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  await expect(workspace.getByLabel("图片评论")).toBeDisabled();
  await expect(workspace.getByRole("button", { name: /^编辑图片标记 1/ })).toBeDisabled();
  await expect(workspace.getByLabel("选择意见 1", { exact: true })).toBeDisabled();
  const first = state.commands[0];
  state.releaseSubmission();
  await expect(workspace.getByRole("button", { name: "重试原操作" })).toBeVisible();
  await page.reload(); await state.open();
  await expect(workspace.getByLabel("图片评论")).toBeDisabled();
  await workspace.getByRole("button", { name: "重试原操作" }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]).toEqual(first);
  expect(state.receipts.size).toBe(1);
  await expect(workspace.getByRole("button", { name: "查看编辑结果" })).toBeVisible();
});

test("已保存的图片意见可以带入同一设计助手并先形成修订计划", async ({ page }) => {
  const state = await prepare(page);
  const { workspace } = state;
  await workspace.getByLabel("图片评论").fill("收窄袖口，保留面料纹理");
  await composer(workspace).getByRole("button", { name: "添加评论", exact: true }).click();
  await workspace.getByRole("button", { name: "交给设计助手制定修订计划", exact: true }).click();
  await expect.poll(() => state.feedback().comments.length).toBe(1);
  const assistant = page.locator("#workflow-design-assistant");
  await expect(assistant).toBeVisible();
  await expect(assistant.getByRole("textbox", { name: "描述设计需求", exact: true })).toHaveValue(/收窄袖口，保留面料纹理/u);
  await expect(assistant.getByRole("status")).toContainText("已带入「藏蓝通勤外套」");
  await expect(assistant.getByLabel("正在讨论").locator("[data-assistant-reference-id=material-0]")).toBeVisible();
  await expect.poll(() => state.commands.length).toBe(0);
});

test("画面标注明确关联对应意见，取消全部勾选后恢复仍需主动选择", async ({ page }) => {
  const state = await prepare(page, 1440, {
    revision: 1, comments: [], annotations: [
      { id: "collar", kind: "rectangle", points: [{ x: .34, y: .14 }, { x: .65, y: .29 }], color: "#2b6553", width: 2, text: "" },
      { id: "cuff", kind: "rectangle", points: [{ x: .67, y: .41 }, { x: .78, y: .56 }], color: "#2b6553", width: 2, text: "" },
    ],
  });
  const { workspace } = state;
  const picture = workspace.getByAltText("藏蓝通勤外套", { exact: true });
  const rect = await picture.boundingBox();
  if (!rect) throw new Error("原图缺失");
  await page.mouse.click(rect.x + rect.width * .48, rect.y + rect.height * .21);
  await composer(workspace).getByText("附上画面标注（可选）", { exact: true }).click();
  await expect(composer(workspace).getByLabel("标注 1 · 矩形", { exact: true })).not.toBeChecked();
  await composer(workspace).getByLabel("标注 1 · 矩形", { exact: true }).check();
  await add(workspace, "领口略微收小，保留双排扣与面料纹理");
  await page.mouse.click(rect.x + rect.width * .72, rect.y + rect.height * .49);
  await expect(composer(workspace).getByLabel("标注 1 · 矩形", { exact: true })).not.toBeChecked();
  await composer(workspace).getByLabel("标注 2 · 矩形", { exact: true }).check();
  await add(workspace, "收窄这一侧袖口，保留袖袢");
  await workspace.getByRole("button", { name: "保存评论", exact: true }).click();
  await expect.poll(() => state.feedback().comments.map(comment => comment.annotationIds)).toEqual([["collar"], ["cuff"]]);
  await workspace.getByLabel("选择意见 2", { exact: true }).uncheck();
  await workspace.getByRole("button", { name: "编辑意见 1", exact: true }).click();
  await expect(workspace.getByLabel("图片评论")).toBeInViewport({ ratio: 1 });
  await expect(composer(workspace).getByLabel("标注 1 · 矩形", { exact: true })).toBeChecked();
  await expect(composer(workspace).getByLabel("标注 2 · 矩形", { exact: true })).not.toBeChecked();
  await workspace.screenshot({ path: "output/playwright/image-comment-markers/numbered-feedback.png" });
  await composer(workspace).getByRole("button", { name: "取消编辑" }).click();
  await workspace.getByLabel("选择意见 1", { exact: true }).uncheck();
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await page.reload(); await state.open();
  await expect(workspace.getByLabel("选择意见 1", { exact: true })).not.toBeChecked();
  await expect(workspace.getByLabel("选择意见 2", { exact: true })).not.toBeChecked();
  await expect(workspace.getByRole("button", { name: "按选中意见修改" })).toBeDisabled();
  await workspace.getByLabel("选择意见 1", { exact: true }).check();
  await workspace.getByRole("button", { name: "按选中意见修改" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.parameters.commentIds).toEqual([state.feedback().comments[0]?.id]);
  await expect(workspace.getByRole("button", { name: "查看编辑结果" })).toBeVisible();
  expect(state.errors).toEqual([]);
});
