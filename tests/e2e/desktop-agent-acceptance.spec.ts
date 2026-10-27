import { test, expect } from "@playwright/test";
import { seedVisualApp, PROJECT } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

test.beforeEach(async ({ page }) => {
  await seedVisualApp(page);
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: workspaceFixture() }));
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("助手草稿刷新恢复且组合输入确认不会发送", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/agent-conversations/*/workflow-messages", async route => { sends++; await route.fulfill({ status: 503, json: { message: "测试请求" } }); });
  await page.goto(`/${PROJECT}`);
  const input = page.getByRole("textbox", { name: "描述设计需求" });
  await expect(input).toBeEnabled();
  await input.fill("秋冬亚麻风衣，保留领型");
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await input.press("Enter");
  expect(sends).toBe(0);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("fashion-workspace-drafts", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return new Promise<boolean>(resolve => { const request = db.transaction("drafts").objectStore("drafts").getAll(); request.onsuccess = () => { resolve(request.result.some((row: { value: { prompt?: string } }) => row.value.prompt === "秋冬亚麻风衣，保留领型")); db.close(); }; });
  })).toBe(true);
  await page.reload();
  await expect(input).toHaveValue("秋冬亚麻风衣，保留领型");
  await expect(page.getByRole("complementary", { name: "本机草稿恢复" })).toContainText("已恢复本机草稿");
});

test("分栏Escape恢复，键盘调整后可刷新恢复", async ({ page }) => {
  await page.goto(`/${PROJECT}`);
  const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
  await expect(page.getByRole("heading", { name: "方案与灵感" })).toBeInViewport();
  await expect(separator).toBeVisible();
  const bounds = await separator.boundingBox();
  if (!bounds) throw new Error("分栏手柄不可见");
  await page.mouse.move(bounds.x + 3, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 64, bounds.y + 80);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => Math.abs(((await separator.boundingBox())?.x ?? 0) - bounds.x)).toBeLessThan(2);
  await separator.focus();
  await separator.press("ArrowLeft");
  await expect.poll(async () => (await separator.boundingBox())?.x ?? Infinity).toBeLessThan(bounds.x);
  const changed = await separator.boundingBox();
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("fashion:workspace-split:")).map(([, value]) => JSON.parse(value) as { width: number }).some(item => item.width > 400))).toBe(true);
  await page.reload();
  await expect(separator).toBeVisible();
  await expect.poll(async () => Math.abs(((await separator.boundingBox())?.x ?? 0) - (changed?.x ?? 0))).toBeLessThan(2);
});

test("工作室表单本机恢复", async ({ page }) => {
  await page.goto(`/${PROJECT}/studio?tab=presentation`);
  const name = page.getByRole("textbox", { name: "展示包名称" });
  await expect(name).toBeVisible();
  await name.fill("本机未保存展示包");
  await expect.poll(async () => page.evaluate(async () => {
    const request = indexedDB.open("fashion-workspace-drafts", 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    return new Promise<boolean>(resolve => { const read = db.transaction("drafts").objectStore("drafts").getAll(); read.onsuccess = () => { resolve(JSON.stringify(read.result).includes("本机未保存展示包")); db.close(); }; });
  })).toBe(true);
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(name).toHaveValue("本机未保存展示包");
});

test("项目任务抽屉按真实能力停止并恢复焦点", async ({ page }) => {
  let canceled = false;
  await page.route(`**/api/projects/${PROJECT}/tasks*`, route => route.fulfill({ json: { items: [{ id: "generation:task-1", domain: "generation", title: "图片生成", rawStatus: canceled ? "CANCELED" : "RUNNING", status: canceled ? "canceled" : "running", group: canceled ? "ended" : "running", createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", objectId: null, conversationId: null, href: `/${PROJECT}`, actions: canceled ? [] : [{ kind: "cancel_generation", targetId: "task-1" }] }], counts: { running: canceled ? 0 : 1, attention: 0 }, nextCursor: null } }));
  await page.route("**/api/generations/task-1", route => { canceled = true; return route.fulfill({ json: { status: "CANCELED" } }); });
  await page.goto(`/${PROJECT}`);
  const trigger = page.getByRole("button", { name: /^项目任务/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "项目任务" });
  await expect(dialog.getByText("处理中", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "停止后续处理" }).click();
  await expect(dialog.getByText("已取消", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(trigger).toBeFocused();
});
