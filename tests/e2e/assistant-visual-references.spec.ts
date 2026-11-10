import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";
import { NOW } from "../visual/fixtures";

for (const width of [1440, 320]) test(`${width}px 引用记录区分同图副本、先前补读和未传入图片`, async ({ page }) => {
  const state = await prepareZhiya(page, { count: 4, realClock: true, viewport: { width, height: 900 } });
  const titles = ["藏蓝风衣正面", "藏蓝风衣正面 · 对照副本", "袖口细节参考", "领口细节参考"] as const;
  for (const [i, title] of titles.entries()) {
    const node = state.graph.nodes[i];
    if (!node) throw new Error("测试素材缺失");
    node.title = title;
    node.type = "candidate";
    node.payload = { assetId: i === 1 ? "look-0" : `look-${i}`, imageUrl: "/visual-garment.svg", imageWidth: 600, imageHeight: 800 };
  }
  const refs = (ids: number[]) => ids.map(i => {
    const title = titles[i];
    if (!title) throw new Error("测试素材名称缺失");
    return { nodeId: `material-${i}`, title };
  });
  await page.route("**/api/agent-conversations/visual-chat/messages?*", route => route.fulfill({ json: { nextCursor: null, items: [{
    id: "visual-reference-proof", conversationId: "visual-chat", role: "assistant", status: "completed", kind: "reply", createdAt: NOW, updatedAt: NOW,
    content: "可以保留直身廓形，试着让袖口更利落。领口图片尚未传入，这部分先留待细看。",
    context: {
      referenceSummary: { version: 1, explicit: refs([0, 3]), discussion: [], images: refs([0, 1, 2]) },
      visualCoverage: { total: 4, ready: 3, pending: 0, failed: 1, attachedNodeIds: ["material-2"], unreadNodeIds: ["material-0", "material-1", "material-3"],
        attachedImageCount: 1, providedNodeIds: ["material-0", "material-1", "material-2"], providedImageCount: 2 },
    },
  }] } }));
  await loadZhiya(page);
  await openZhiya(page);
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await expect(input).toBeEnabled();
  await input.fill("下一步单独看领口，保留这份草稿");
  const message = page.locator('[data-message-id="visual-reference-proof"]');
  const record = message.locator("details").first();
  await expect(record).not.toHaveAttribute("open");
  await record.getByText("查看引用记录", { exact: true }).click();
  const provided = record.locator("section").filter({ has: page.getByRole("heading", { name: "传入图片", exact: true }) });
  await expect(provided.getByRole("button")).toHaveCount(3);
  await expect(provided.getByRole("button", { name: titles[0], exact: true })).toBeVisible();
  const missing = record.locator("section").filter({ has: page.getByRole("heading", { name: "尚未传入的引用图片", exact: true }) });
  await expect(missing.getByRole("button")).toHaveCount(1);
  await expect(missing.getByRole("button", { name: titles[3], exact: true })).toBeVisible();
  await record.getByText("图片统计与读取范围", { exact: true }).click();
  await expect(record).toContainText("本轮累计传入 2 张图片，对应 3 个画布对象");
  await expect(record).toContainText("分析不可用 1 项");
  const statistics = record.getByText(/本轮累计传入 2 张图片/);
  await statistics.scrollIntoViewIfNeeded();
  await expect(statistics).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("output/playwright/assistant-visual-references", { recursive: true });
  await page.screenshot({ path: `output/playwright/assistant-visual-references/record-${width}.png` });
  await expect(input).toHaveValue("下一步单独看领口，保留这份草稿");
  await page.reload();
  await expect(input).toHaveValue("下一步单独看领口，保留这份草稿");
  await record.getByText("查看引用记录", { exact: true }).click();
  await record.getByText("图片统计与读取范围", { exact: true }).click();
  await expect(record).toContainText("本轮累计传入 2 张图片，对应 3 个画布对象");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
