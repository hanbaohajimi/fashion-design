import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { seedVisualApp } from "../visual/fixtures";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";

const cacheKey = "fashion:assistant-skills:visual-designer";
const personal = { id: "offline-personal", name: "我的离线设计步骤", description: "保留个人草稿", prompt: "整理当前设计目标", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z" };
const shared = { ...personal, id: "shared-current", serverId: "shared-current", ownerId: "colleague", scope: "WORKSPACE", workspaceId: "current-workspace", name: "当前工作区的核对步骤" };
const composer = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "描述设计需求", exact: true });

test.beforeEach(async () => { await mkdir("output/playwright/approval-fix", { recursive: true }); });

for (const target of ["/\\outside-review.test/path", "/\t/outside-review.test/path", "/trends?from=board&boardId=visual-project"]) {
  test(`登录确认只返回经校验的站内地址：${JSON.stringify(target)}`, async ({ page }) => {
    await seedVisualApp(page, { realClock: true });
    await page.addInitScript(value => sessionStorage.setItem("fashion:auth-return-to", value), target);
    const outside: string[] = [];
    await page.route(/https?:\/\/outside-review\.test\//u, route => { outside.push(route.request().url()); return route.abort(); });
    await page.route("**/api/auth/login", route => route.fulfill({ json: {} }));
    await page.goto("/auth/confirm?token_hash=offline-review-token");
    const expected = target.startsWith("/trends") ? target : "/";
    await expect(page).toHaveURL(`http://127.0.0.1:3000${expected}`);
    expect(outside).toEqual([]);
  });
}

for (const width of [1440, 320]) {
  test(`${width}px 旧工作区缓存被移除，个人草稿和当前输入持续保留`, async ({ page }) => {
    const state = await prepareZhiya(page, { count: 0, realClock: true, viewport: { width, height: 900 } });
    await page.addInitScript(({ key, item }) => localStorage.setItem(key, JSON.stringify([item, { ...item, id: "old-shared", scope: "WORKSPACE", serverId: "old-shared", name: "其他工作区的私有版型" }])), { key: cacheKey, item: personal });
    await page.route("**/assistant-skills", route => route.fulfill({ json: [] }));
    await loadZhiya(page); await openZhiya(page);
    await composer(page).fill("保留这份尚未发送的设计草稿");
    await page.getByRole("button", { name: "常用技能", exact: true }).click();
    const region = page.getByRole("group", { name: "常用技能选项" });
    await expect(region.getByRole("button", { name: /我的离线设计步骤/ }).first()).toBeVisible();
    await expect(region.getByRole("button", { name: /其他工作区的私有版型/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]").map((item: { id: string }) => item.id), cacheKey)).toEqual([personal.id]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/approval-fix/skills-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(composer(page)).toHaveValue("保留这份尚未发送的设计草稿");
    expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
  });
}

test("当前有权使用的工作区技能可载入，刷新后撤销的技能不从缓存复活", async ({ page }) => {
  await prepareZhiya(page, { count: 0, realClock: true });
  let remote = [shared];
  await page.route("**/assistant-skills", route => route.fulfill({ json: remote }));
  await loadZhiya(page); await openZhiya(page);
  await page.getByRole("button", { name: "常用技能", exact: true }).click();
  await expect(page.getByRole("button", { name: /当前工作区的核对步骤/ }).first()).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), cacheKey)).toEqual([]);
  await page.getByRole("button", { name: /当前工作区的核对步骤/ }).first().click();
  await expect(composer(page)).toHaveValue(shared.prompt);
  remote = [];
  await page.reload(); await expect(composer(page)).toBeVisible();
  await page.getByRole("button", { name: "常用技能", exact: true }).click();
  await expect(page.getByRole("button", { name: /当前工作区的核对步骤/ })).toHaveCount(0);
});

test("桌面端技能菜单与更多助手操作保持可达", async ({ page }) => {
  const identityErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error" && message.text().includes("same key")) identityErrors.push(message.text()); });
  const state = await prepareZhiya(page, { count: 0, realClock: true, viewport: { width: 1440, height: 900 } });
  await page.route("**/assistant-skills", route => route.fulfill({ json: [] }));
  await page.route("**/assistant-delegations", route => route.fulfill({ json: [] }));
  await loadZhiya(page); await openZhiya(page);
  await composer(page).fill("保持服装设计要求");
  await page.getByRole("button", { name: "常用技能", exact: true }).click();
  await expect(page.getByRole("group", { name: "常用技能选项" }).getByRole("button", { name: /整理设计方向/ })).toBeVisible();
  await page.screenshot({ path: "output/playwright/approval-fix/skills-desktop.png" });
  await page.keyboard.press("Escape");
  const settings = page.getByRole("button", { name: "助手设置", exact: true });
  await expect(settings).toBeInViewport({ ratio: 1 });
  await settings.click();
  const menu = page.getByRole("group", { name: "助手设置选项", exact: true });
  await menu.getByRole("button", { name: "设计要求", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设计要求与偏好", exact: true })).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(identityErrors).toEqual([]);
});

test("共享技能读取失败后保留草稿，重新载入可恢复技能", async ({ page }) => {
  await prepareZhiya(page, { count: 0, realClock: true });
  let attempts = 0;
  await page.route("**/assistant-skills", route => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { message: "回执暂时不可读" } })
      : route.fulfill({ json: [shared] });
  });
  await loadZhiya(page); await openZhiya(page);
  await composer(page).fill("保持我的设计说明");
  await expect(composer(page)).toHaveValue("保持我的设计说明");
  await page.waitForTimeout(800);
  await page.reload();
  await expect(composer(page)).toHaveValue("保持我的设计说明");
  await page.getByRole("button", { name: "常用技能", exact: true }).click();
  await expect(page.getByRole("button", { name: /当前工作区的核对步骤/ })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});
