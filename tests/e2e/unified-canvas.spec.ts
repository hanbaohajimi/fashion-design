import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import { emptyCanvasCreationDraft, type CanvasCreation, type CreateCanvasCreationInput, type UpdateCanvasCreationInput } from "../../packages/shared/src/canvas-creations";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";

test.setTimeout(90_000);
function required<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error("缺少预期测试记录"); return value; }
async function prepare(page: Page, width = 1440, canEdit = true, count = 2) {
  const state = await prepareZhiya(page, { count, canEdit, realClock: true, viewport: { width, height: width < 700 ? 844 : 900 } });
  const items: CanvasCreation[] = [];
  const runs: string[] = [];
  const runKeys: string[] = [];
  const receipts = new Set<string>();
  let completeRuns = false, loseResponse = false;
  let updateGate: Promise<void> | undefined;
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) => {
    const data = studioFixture();
    return route.fulfill({ json: { ...data, capabilities: { ...data.capabilities, edit: canEdit }, assets: [...data.assets, { id: "look-0", url: "/visual-garment.svg", thumbnailUrl: null }, { id: "look-1", url: "/visual-garment.svg", thumbnailUrl: null }] } });
  });
  await page.route(`**/api/projects/${PROJECT}/experiments`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/projects/${PROJECT}/canvas/creations**`, async (route) => {
    const url = new URL(route.request().url()); const parts = url.pathname.split("/");
    if (route.request().method() === "GET") return route.fulfill({ json: { items, canEdit } });
    if (route.request().method() === "POST" && parts.at(-1) === "creations") {
      const input = route.request().postDataJSON() as CreateCanvasCreationInput;
      const existing = items.find((item) => item.id === input.id); if (existing) return route.fulfill({ json: existing });
      const item: CanvasCreation = { ...input, revision: 0, projectId: PROJECT, position: input.position ?? null, currentResult: null, currentResultNodeId: null, runs: [], resource: null, removed: false, createdAt: NOW, updatedAt: NOW };
      items.push(item); return route.fulfill({ json: item });
    }
    const id = parts.at(-1) === "runs" ? parts.at(-2) : parts.at(-1);
    const index = items.findIndex((item) => item.id === id); const item = items[index];
    if (!item) return route.fulfill({ status: 404, json: { message: "不存在" } });
    if (route.request().method() === "PATCH") {
      const gate = updateGate; updateGate = undefined; if (gate) await gate;
      const input = route.request().postDataJSON() as UpdateCanvasCreationInput;
      if (input.expectedRevision !== item.revision) return route.fulfill({ status: 409, json: { message: "创作要求已更新" } });
      const adoptedRun = item.runs.find((run) => run.results.some((result) => result.nodeId === input.currentResultNodeId));
      items[index] = { ...item, revision: item.revision + 1, draft: adoptedRun?.draft ?? input.draft ?? item.draft,
        ...(adoptedRun ? { currentResultNodeId: input.currentResultNodeId ?? null, currentResult: adoptedRun.results.find((result) => result.nodeId === input.currentResultNodeId) ?? null } : {}) };
    } else {
      const { mutationId } = route.request().postDataJSON() as { mutationId: string };
      runKeys.push(mutationId);
      if (!receipts.has(mutationId)) {
        receipts.add(mutationId); runs.push(item.id);
        const results = completeRuns ? Array.from({ length: item.draft.parameters.count }, (_, ordinal) => ({ nodeId: `result-${runs.length}-${ordinal}`, assetId: `generated-${runs.length}-${ordinal}`, imageUrl: "/visual-garment.svg", title: `第${runs.length}轮结果${ordinal + 1}`, text: null, width: 768, height: 1024 })) : [];
        Object.assign(state.graph, { revision: state.graph.revision + 1, nodes: [...state.graph.nodes, ...results.map((result) => ({ id: result.nodeId, kind: "asset", type: "candidate", title: result.title, status: "completed", payload: { assetId: result.assetId, imageUrl: result.imageUrl, canvasCreationId: item.id, canvasPlacement: "manual" }, x: 0, y: 0, createdAt: NOW, updatedAt: NOW }))] });
        items[index] = { ...item, currentResult: results[0] ?? null, currentResultNodeId: results[0]?.nodeId ?? null, runs: [{ id: `run-${runs.length}`, creationId: item.id, executionId: null, toolNodeId: null, conversationId: null, status: completeRuns ? "completed" : "queued", draft: structuredClone(item.draft), inputSnapshot: structuredClone(item.draft.inputs), results, error: null, createdAt: NOW }, ...item.runs] };
      }
      if (loseResponse) { loseResponse = false; return route.abort("connectionfailed"); }
    }
    return route.fulfill({ json: items[index] });
  });
  return { ...state, items, runs, runKeys, completeRuns: () => { completeRuns = true; }, loseNextResponse: () => { loseResponse = true; }, holdNextUpdate: () => { let resume!: () => void; updateGate = new Promise<void>((resolve) => { resume = resolve; }); return resume; } };
}
async function selectImage(page: Page) {
  const image = page.getByRole("group", { name: "通勤外套 1", exact: true });
  const box = await image.boundingBox(); if (!box) throw new Error("没有图片");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("region", { name: "图片创作框" })).toBeVisible();
}

for (const width of [1440, 1280, 390]) test(`${width}px 单一画布、图片上下工具与功能目录`, async ({ page }) => {
  const state = await prepare(page, width); await useCanvasPhotograph(page); await loadZhiya(page); await selectImage(page);
  await expect(page.getByRole("toolbar", { name: "常用图片工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "抓手工具", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "文本工具", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "固定素材", exact: true })).toHaveCount(0);
  const prompt = page.getByRole("textbox", { name: "本次创作要求" });
  await prompt.fill("保留图1版型，将主色改为墨绿");
  const image = page.locator('.tl-shape[data-shape-id="shape:canvas-material-0"]'); const before = await image.boundingBox();
  await page.getByRole("switch", { name: /显示连接关系/ }).click();
  await expect(page.getByRole("switch", { name: /显示连接关系/ })).toHaveAttribute("aria-checked", "false");
  expect(await image.boundingBox()).toEqual(before); await expect(prompt).toHaveValue("保留图1版型，将主色改为墨绿");
  await mkdir("output/unified-canvas", { recursive: true });
  await page.screenshot({ path: `output/unified-canvas/selected-${width}.png` });
  if (process.env.CANVAS_CLIP_AUDIT_SCRIPT) {
    const audit = await readFile(process.env.CANVAS_CLIP_AUDIT_SCRIPT, "utf8");
    const result = await page.evaluate(`(${audit})({ root: '[aria-label="无限白板"]', max: 200, hover: true })`) as { cut: number; issues: { el: string; level: string }[] };
    const controls = result.issues.filter((issue) => issue.level === "cut" && /composer|imageToolbar/u.test(issue.el));
    await writeFile(`output/unified-canvas/clip-audit-${width}.json`, JSON.stringify({ ...result, controls }, null, 2));
    expect(controls).toEqual([]);
  }
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "全部功能模块", exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /系列工作台/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /时尚趋势/ })).toBeVisible();
  await page.screenshot({ path: `output/unified-canvas/catalog-${width}.png` });
  await dialog.getByRole("button", { name: "关闭全部功能" }).click();
  await expect(prompt).toHaveValue("保留图1版型，将主色改为墨绿");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.runs).toEqual([]); expect(state.errors).toEqual([]);
});

test("空创作节点不执行，中文组合输入和快速连续提交只产生一次请求", async ({ page }) => {
  const state = await prepare(page); await loadZhiya(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  await page.getByRole("dialog", { name: "全部功能模块" }).getByRole("button", { name: /图片创作/ }).click();
  await expect.poll(() => state.items.length).toBe(1); expect(state.runs).toEqual([]);
  const prompt = page.getByRole("textbox", { name: "本次创作要求" }); await expect(prompt).toBeVisible();
  const empty = page.locator(`[data-creation-id="${state.items[0]?.id}"]`);
  const emptyBox = required(await empty.boundingBox()); expect(emptyBox.width / emptyBox.height).toBeCloseTo(16 / 9, 2);
  await expect(page.getByRole("toolbar", { name: "常用图片工具" })).toHaveCount(0);
  await page.screenshot({ path: "output/add-nodes/empty-image-1440.png", animations: "disabled" });
  await empty.getByRole("button", { name: "描述画面", exact: true }).click();
  await expect(prompt).toBeFocused();
  await empty.getByRole("button", { name: "选择画布参考", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "可引用素材" })).toBeVisible();
  await page.getByRole("button", { name: "关闭素材选择" }).click();
  await prompt.fill("生成一件棉质通勤外套");
  await prompt.dispatchEvent("compositionstart"); await prompt.press("Control+Enter");
  expect(state.runs).toEqual([]); await prompt.dispatchEvent("compositionend"); await prompt.press("Control+Enter"); expect(state.runs).toEqual([]);
  await prompt.press("ArrowLeft");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => state.runs.length).toBe(1);
  await expect(page.locator(`[data-creation-id="${state.items[0]?.id}"]`)).toBeVisible();
  expect(state.items[0]?.draft.parameters).toEqual({ ...emptyCanvasCreationDraft().parameters, width: 1536, height: 864 });
  expect(state.errors).toEqual([]);
});

test("重跑保持目标，历史预览不采用，继续创作绑定准确结果版本", async ({ page }) => {
  const state = await prepare(page); state.completeRuns(); await useCanvasPhotograph(page); await loadZhiya(page); await selectImage(page);
  await page.getByRole("textbox", { name: "本次创作要求" }).fill("将袖口改成窄袖口");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => state.runs.length).toBe(1);
  const id = required(state.items[0]).id, first = required(required(state.items[0]).currentResult);
  const shape = page.locator(`[data-creation-id="${id}"]`); const position = required(state.items[0]).position;
  await expect(shape).toBeVisible();
  await page.getByRole("textbox", { name: "本次创作要求" }).fill("将袖口改成宽袖口");
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect.poll(() => state.runs.length).toBe(2); expect(state.items).toHaveLength(1); expect(required(state.items[0]).position).toEqual(position);
  const current = required(state.items[0]).currentResultNodeId;
  await page.getByRole("toolbar", { name: "常用图片工具" }).getByRole("button", { name: "历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "创作历史", exact: true });
  await expect(history.getByRole("heading", { name: /的历史$/ })).toBeVisible();
  await page.screenshot({ path: "output/unified-canvas/history-initial-1440.png" });
  await history.getByRole("img", { name: first.title, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "图片预览", exact: true })).toBeVisible(); expect(required(state.items[0]).currentResultNodeId).toBe(current);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await history.getByRole("button", { name: "采用此结果", exact: true }).click();
  await expect.poll(() => required(state.items[0]).currentResultNodeId).toBe(first.nodeId);
  await page.screenshot({ path: "output/unified-canvas/history-1440.png" });
  await history.getByRole("button", { name: "继续创作", exact: true }).last().click();
  await expect.poll(() => state.items.length).toBe(2);
  expect(state.items[1]?.draft.inputs[0]).toMatchObject({ creationId: id, nodeId: first.nodeId, assetId: first.assetId });
  expect(state.runs).toHaveLength(2); expect(state.errors).toEqual([]);
});

test("390px 横向空图片节点自动打开创作框，推荐入口只准备草稿", async ({ page }) => {
  const state = await prepare(page, 390); await loadZhiya(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  await page.getByRole("dialog", { name: "全部功能模块" }).getByRole("button", { name: /图片创作/ }).click();
  await expect.poll(() => state.items.length).toBe(1);
  const node = page.locator(`[data-creation-id="${state.items[0]?.id}"]`);
  const box = required(await node.boundingBox()); expect(box.width / box.height).toBeCloseTo(16 / 9, 2);
  await node.getByRole("button", { name: "描述画面", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本次创作要求" })).toBeFocused();
  await expect(page.getByRole("button", { name: "生成", exact: true })).toBeInViewport();
  await page.screenshot({ path: "output/add-nodes/empty-image-390.png", animations: "disabled" });
  expect(state.runs).toEqual([]); expect(state.errors).toEqual([]);
});

test("未知生成回执复用原编号，后来输入的要求在刷新后保留", async ({ page }) => {
  const state = await prepare(page); state.completeRuns(); state.loseNextResponse(); await loadZhiya(page); await selectImage(page);
  await page.getByRole("textbox", { name: "本次创作要求" }).fill("第一轮要求");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  const confirm = page.getByRole("button", { name: "确认上次提交", exact: true }); await expect(confirm).toBeVisible();
  await page.getByRole("textbox", { name: "本次创作要求" }).fill("尚未提交的下一轮要求");
  await confirm.click(); await expect.poll(() => state.runKeys.length).toBe(2);
  expect(state.runKeys[0]).toBe(state.runKeys[1]); expect(state.runs).toHaveLength(1);
  await expect(page.getByRole("textbox", { name: "本次创作要求" })).toHaveValue("尚未提交的下一轮要求");
  await page.reload(); await expect(page.getByRole("textbox", { name: "本次创作要求" })).toHaveValue("尚未提交的下一轮要求");
  expect(state.runs).toHaveLength(1); expect(state.errors).toEqual([]);
});

test("端口连接只修改真实输入，隐藏关系不改变连接或素材位置", async ({ page }) => {
  const state = await prepare(page); await loadZhiya(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  await page.getByRole("dialog", { name: "全部功能模块" }).getByRole("button", { name: /图片创作/ }).click();
  await expect.poll(() => state.items.length).toBe(1);
  await page.getByRole("button", { name: "更多白板操作", exact: true }).click(); await page.getByRole("button", { name: "查看全图", exact: true }).click();
  await selectImage(page);
  await page.getByRole("button", { name: "从此素材连接", exact: true }).first().press("Enter");
  const resume = state.holdNextUpdate();
  await page.getByRole("button", { name: "连接到图片创作", exact: true }).click();
  const target = page.locator(`[data-creation-id="${required(state.items[0]).id}"]`);
  const targetBox = required(await target.boundingBox());
  await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  const prompt = page.getByRole("textbox", { name: "本次创作要求" });
  await prompt.fill("连线保存期间继续输入的要求");
  resume();
  await expect.poll(() => state.items[0]?.draft.inputs.length).toBe(1);
  await expect(prompt).toHaveValue("连线保存期间继续输入的要求");
  expect(state.items[0]?.draft.inputs[0]?.nodeId).toBe("material-0"); expect(state.runs).toEqual([]);
  const snapshot = structuredClone(required(state.items[0]).draft);
  await page.getByRole("switch", { name: /显示连接关系/ }).click();
  expect(required(state.items[0]).draft).toEqual(snapshot); await expect(page.getByRole("button", { name: "从此素材连接" })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

for (const width of [1440, 390]) test(`${width}px 功能模块捕获所选图片，不预填生成要求`, async ({ page }) => {
  const state = await prepare(page, width); await useCanvasPhotograph(page); await loadZhiya(page); await selectImage(page);
  await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
  await page.getByRole("dialog", { name: "全部功能模块" }).getByRole("button", { name: /换色实验/ }).click();
  const module = page.getByRole("dialog", { name: "换色实验", exact: true }); await expect(module).toBeVisible();
  await expect(module.getByRole("button", { name: "查看大图：设计图片 look-0", exact: true })).toBeVisible();
  await expect(module.getByLabel("本轮目标", { exact: true })).toHaveValue("");
  await expect(module.getByLabel("需要保留的内容（可选）", { exact: true })).toHaveValue("");
  await expect(module.getByRole("img", { name: "本轮实验母图", exact: true })).toBeVisible();
  await module.getByRole("img", { name: "本轮实验母图", exact: true }).evaluate((image: HTMLImageElement) => image.decode());
  await expect(module.getByRole("img", { name: "本轮实验母图", exact: true })).toHaveCSS("opacity", "1");
  await page.screenshot({ path: `output/unified-canvas/color-module-${width}.png`, animations: "disabled" });
  await module.getByRole("button", { name: "返回画布" }).click();
  expect(state.runs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test("独立打开实验不自动选母图，新目标不继承其他目标的草稿", async ({ page }) => {
  const state = await prepare(page); await loadZhiya(page);
  const open = async () => {
    await page.getByRole("button", { name: "全部功能模块", exact: true }).click();
    await page.getByRole("dialog", { name: "全部功能模块" }).getByRole("region", { name: "实验", exact: true }).getByRole("button", { name: "换色实验", exact: true }).click();
    return page.getByRole("dialog", { name: "换色实验", exact: true });
  };
  const first = await open();
  await expect(first.getByText("从项目图片中选择母图，再设置修改目标。", { exact: true })).toBeVisible();
  await first.getByLabel("本轮目标", { exact: true }).fill("只属于这个实验的要求");
  await first.getByRole("button", { name: "返回画布" }).click();
  await page.keyboard.press("Escape");
  const second = await open();
  await expect(second.getByLabel("本轮目标", { exact: true })).toHaveValue("");
  expect(state.items).toHaveLength(2); expect(state.runs).toEqual([]); expect(state.errors).toEqual([]);
});
