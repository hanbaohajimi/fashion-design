import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { prepareNodeEntry } from "./node-entry-fixture";
import { loadZhiya } from "./zhiya-fixture";
import { generatedVideoBytes } from "./generated-media-fixture";

test.setTimeout(90000);
async function add(page: Page, kind: "文本" | "图片" | "视频") {
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  const menu = page.getByRole("group", { name: "添加节点选项", exact: true });
  if ((page.viewportSize()?.width ?? 0) >= 768) expect(await menu.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.getByRole("group", { name: "添加节点选项", exact: true }).getByRole("button", { name: kind, exact: true }).click();
}

for (const width of [1440, 1280, 390, 320]) test(`${width}px 添加节点菜单、手动文本与AI起草完整往返`, async ({ page }) => {
  const state = await prepareNodeEntry(page, width); await loadZhiya(page);
  await mkdir("output/node-integration", { recursive: true });
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  if (width >= 768) expect(await page.getByRole("group", { name: "添加节点选项", exact: true }).evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.screenshot({ path: `output/node-integration/menu-${width}.png`, animations: "disabled" });
  await page.getByRole("group", { name: "添加节点选项", exact: true }).getByRole("button", { name: "文本", exact: true }).click();
  await expect.poll(() => state.items.length).toBe(1);
  const id = state.items[0]?.id;
  const node = page.locator(`[data-creation-id="${id}"]`);
  await node.getByRole("button", { name: "自己编写内容", exact: true }).click();
  const field = page.getByRole("textbox", { name: "节点文本内容", exact: true });
  await expect(field).toBeFocused();
  await field.fill("用于春夏系列的手动文本草稿");
  expect(state.aiCalls()).toBe(0); expect(state.imageCalls()).toBe(0);
  await page.screenshot({ path: `output/node-integration/text-manual-${width}.png`, animations: "disabled" });
  expect(state.saves.some(save => JSON.stringify(save.snapshot).includes("用于春夏系列的手动文本草稿"))).toBe(false);
  await page.getByRole("button", { name: "保存文本", exact: true }).click();
  await expect.poll(() => state.items[0]?.currentResult?.text).toBe("用于春夏系列的手动文本草稿");
  await page.getByRole("toolbar", { name: "创作操作", exact: true }).getByRole("button", { name: "AI 起草", exact: true }).click();
  const composer = page.getByRole("region", { name: "文本创作框", exact: true });
  await composer.getByRole("textbox", { name: "本次创作要求" }).fill("写一句轻盈春夏系列的文案");
  await composer.getByRole("button", { name: /^(重新)?起草$/ }).click();
  await expect.poll(() => state.aiCalls()).toBe(1);
  await expect(node).toContainText("AI 起草的春夏设计文案");
  await page.screenshot({ path: `output/node-integration/text-ai-${width}.png`, animations: "disabled" });
  expect(state.imageCalls()).toBe(0); expect(state.items[0]?.runs).toHaveLength(2); expect(state.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CANVAS_CLIP_AUDIT_SCRIPT) {
    const audit = await readFile(process.env.CANVAS_CLIP_AUDIT_SCRIPT, "utf8");
    const reports: Record<string, unknown> = {};
    for (const phase of ["default", "hover", "expanded", "settled"]) {
      if (phase === "hover") await composer.getByRole("button", { name: "重新起草", exact: true }).hover();
      if (phase === "expanded") await composer.getByRole("button", { name: "展开创作框", exact: true }).click();
      if (phase === "settled") await page.getByRole("button", { name: "收起创作框", exact: true }).click();
      reports[phase] = await page.evaluate(`(${audit})({root:'[aria-label="无限白板"]',max:200})`);
    }
    await writeFile(`output/node-integration/clip-${width}.json`, JSON.stringify(reports, null, 2));
  }
});

test("空图片节点右侧端口可预连线，无产物时不执行下游", async ({ page }) => {
  const state = await prepareNodeEntry(page); await loadZhiya(page);
  await add(page, "图片"); await expect.poll(() => state.items.length).toBe(1);
  const upstream = state.items[0]; if (!upstream) throw new Error("缺少上游");
  const port = page.locator(`[data-connection-source="${upstream.id}"]`);
  await expect(port).toBeVisible();
  await page.screenshot({ path: "output/node-integration/empty-image-ports.png", animations: "disabled" });
  await port.press("Enter");
  await add(page, "图片"); await expect.poll(() => state.items.length).toBe(2);
  expect(state.items[1]?.draft.inputs[0]).toMatchObject({ creationId: upstream.id });
  expect(state.items[1]?.draft.inputs[0]?.nodeId).toBeUndefined();
  await page.getByRole("textbox", { name: "本次创作要求" }).fill("使用上游图片进行修改");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByText(/参考节点尚无可用结果/).first()).toBeVisible();
  expect(state.imageCalls()).toBe(0);
  await page.screenshot({ path: "output/node-integration/pending-connection.png", animations: "disabled" });
  expect(state.errors).toEqual([]);
});

for (const width of [1440, 1280, 390, 320]) test(`${width}px 视频上传填入目标并真实播放，关联丢失回执可恢复`, async ({ page }) => {
  const state = await prepareNodeEntry(page, width); await loadZhiya(page); await add(page, "视频");
  await expect.poll(() => state.items.length).toBe(1); state.loseNextAttach();
  const id = state.items[0]?.id;
  await page.locator(`[data-creation-id="${id}"]`).getByRole("button", { name: "上传视频", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加视频", exact: true });
  await page.screenshot({ path: `output/node-integration/upload-video-${width}.png`, animations: "disabled" });
  await picker.getByLabel("选择上传资源").setInputFiles({ name: "sample.mp4", mimeType: "video/mp4", buffer: generatedVideoBytes });
  await expect(picker.getByRole("button", { name: "确认上次导入", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "确认上次导入", exact: true }).click();
  await expect(picker).toHaveCount(0);
  const video = page.locator(`[data-creation-id="${id}"] video`); await expect(video).toBeVisible();
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.05);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.screenshot({ path: `output/node-integration/video-${width}.png`, animations: "disabled" });
  await page.getByRole("button", { name: "放大播放", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "视频预览", exact: true });
  await expect(preview.locator("video")).toBeVisible();
  await preview.locator("video").evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
  await expect.poll(() => preview.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.05);
  await preview.getByRole("button", { name: "关闭预览" }).click();
  expect(state.items[0]?.runs).toHaveLength(1); expect(state.imageCalls()).toBe(0); expect(state.aiCalls()).toBe(0);
  expect(state.commands.filter(command => command.type === "import_reference_video")).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("手动文本的中文输入、丢失回执和历史恢复保留后续编辑", async ({ page }) => {
  const state = await prepareNodeEntry(page, 390); await loadZhiya(page); await add(page, "文本");
  await page.locator("[data-creation-id]").getByRole("button", { name: "自己编写内容", exact: true }).click();
  const field = page.getByRole("textbox", { name: "节点文本内容", exact: true });
  await field.fill("第一版手动内容");
  await field.dispatchEvent("compositionstart"); await field.press("Control+Enter");
  expect(state.items[0]?.runs).toHaveLength(0);
  await field.dispatchEvent("compositionend");
  state.loseNextTextSave(); await page.getByRole("button", { name: "保存文本", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认上次文本保存", exact: true })).toBeVisible();
  await field.fill("回执未确认时继续编辑的第二版");
  await page.getByRole("button", { name: "确认上次文本保存", exact: true }).click();
  await expect(field).toHaveValue("回执未确认时继续编辑的第二版");
  expect(state.items[0]?.runs).toHaveLength(1);
  await page.getByRole("button", { name: "保存文本", exact: true }).click();
  await expect.poll(() => state.items[0]?.runs.length).toBe(2);
  await field.fill("尚未保存的第三版");
  await page.getByRole("button", { name: "历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "创作历史", exact: true });
  await history.getByRole("button", { name: "采用此结果", exact: true }).click();
  await expect.poll(() => state.items[0]?.currentResult?.text).toBe("第一版手动内容");
  expect(state.items[0]?.runs.some(run => run.results.some(result => result.text === "尚未保存的第三版"))).toBe(true);
  await history.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(field).toHaveValue("第一版手动内容");
  await field.fill("恢复后仍可保存"); await page.getByRole("button", { name: "保存文本", exact: true }).click();
  await expect.poll(() => state.items[0]?.currentResult?.text).toBe("恢复后仍可保存");
  expect(state.aiCalls()).toBe(0); expect(state.errors).toEqual([]);
});

test("文本服务失败保留要求，确认原提交后成功起草", async ({ page }) => {
  const state = await prepareNodeEntry(page); await loadZhiya(page); await add(page, "文本");
  const composer = page.getByRole("region", { name: "文本创作框", exact: true });
  const prompt = composer.getByRole("textbox", { name: "本次创作要求" });
  await prompt.fill("起草两句设计说明"); state.failNextTextRun();
  await composer.getByRole("button", { name: "起草", exact: true }).click();
  await expect(composer.getByText("文本服务暂不可用，请重试")).toBeVisible();
  await expect(prompt).toHaveValue("起草两句设计说明");
  await composer.getByRole("button", { name: "确认上次提交", exact: true }).click();
  await expect.poll(() => state.items[0]?.runs.length).toBe(1);
  expect(state.imageCalls()).toBe(0); expect(state.errors).toEqual([]);
});

test("全局资源上传放上画布，已有图片可定位且不重复放置", async ({ page }) => {
  const state = await prepareNodeEntry(page); await loadZhiya(page);
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("group", { name: "添加节点选项", exact: true }).getByRole("button", { name: "上传", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加资源", exact: true });
  await picker.getByLabel("选择上传资源").setInputFiles({ name: "sample.mp4", mimeType: "video/mp4", buffer: generatedVideoBytes });
  await expect(picker).toHaveCount(0); await expect(page.locator("video").first()).toBeVisible();
  expect(state.commands[0]).toMatchObject({ type: "import_reference_video", placement: "canvas" });
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("group", { name: "添加节点选项", exact: true }).getByRole("button", { name: "从已有资源选择", exact: true }).click();
  await expect(picker.getByRole("button", { name: "通勤外套 1", exact: true })).toBeVisible();
  await page.screenshot({ path: "output/node-integration/existing-resources.png", animations: "disabled" });
  await picker.getByRole("searchbox", { name: "搜索已有资源" }).fill("通勤外套");
  await picker.getByRole("button", { name: "通勤外套 1", exact: true }).click();
  await expect(picker).toHaveCount(0);
  expect(state.commands).toHaveLength(1); expect(state.items).toHaveLength(0);
  expect(state.aiCalls()).toBe(0); expect(state.imageCalls()).toBe(0); expect(state.errors).toEqual([]);
});

test("减弱动态下菜单键盘往返，隐藏连接保留空节点与要求", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await prepareNodeEntry(page, 1440); await loadZhiya(page);
  const trigger = page.getByRole("button", { name: "添加节点", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  await expect(page.getByRole("group", { name: "添加节点选项", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await add(page, "图片");
  const target = page.locator(`[data-creation-id="${state.items[0]?.id}"]`);
  const before = await target.boundingBox();
  const prompt = page.getByRole("textbox", { name: "本次创作要求" }); await prompt.fill("只保留这段原始要求");
  await expect(page.locator(`[data-connection-source="${state.items[0]?.id}"]`)).toBeVisible();
  await page.getByRole("switch", { name: "显示连接关系" }).click();
  await expect(page.locator("[data-connection-source]")).toHaveCount(0);
  expect(await target.boundingBox()).toEqual(before); await expect(prompt).toHaveValue("只保留这段原始要求");
  await page.screenshot({ path: "output/node-integration/reduced-motion-1440.png", animations: "disabled" });
  expect(state.imageCalls()).toBe(0); expect(state.errors).toEqual([]);
});

test("已有项目视频可选择并填入空节点，资源搜索不启动生成", async ({ page }) => {
  const state = await prepareNodeEntry(page); await loadZhiya(page); await add(page, "视频");
  await expect.poll(() => state.items.length).toBe(1);
  await page.locator(`[data-creation-id="${state.items[0]?.id}"]`).getByRole("button", { name: "选择已有视频", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加视频", exact: true });
  await picker.getByRole("button", { name: "项目视频", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator("[data-creation-id] video")).toBeVisible();
  expect(state.commands[0]).toMatchObject({ type: "place_generated_media", mediaId: "existing-video", placement: "reference" });
  expect(state.aiCalls()).toBe(0); expect(state.imageCalls()).toBe(0); expect(state.errors).toEqual([]);
});
