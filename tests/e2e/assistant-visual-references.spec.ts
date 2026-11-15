import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { loadZhiya, openZhiya, prepareZhiya } from "./zhiya-fixture";
import { NOW } from "../visual/fixtures";

for (const width of [1440, 320]) test(`${width}px 消息隐藏引用记录，保留正文和下一条草稿`, async ({ page }) => {
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
  await expect(message).toContainText("领口图片尚未传入，这部分先留待细看。");
  await expect(message.getByText("查看引用记录", { exact: true })).toHaveCount(0);
  await expect(message.getByText("这条回复未保存引用记录", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("output/playwright/assistant-visual-references", { recursive: true });
  await page.screenshot({ path: `output/playwright/assistant-visual-references/record-${width}.png` });
  await expect(input).toHaveValue("下一步单独看领口，保留这份草稿");
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open("fashion-workspace-drafts", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction("drafts").objectStore("drafts").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { const rows = request.result as { value?: { prompt?: string } }[]; db.close(); resolve(rows.some(row => row.value?.prompt === "下一步单独看领口，保留这份草稿")); };
    };
  }))).toBe(true);
  await page.reload();
  await expect(input).toHaveValue("下一步单独看领口，保留这份草稿");
  await expect(message.getByText("查看引用记录", { exact: true })).toHaveCount(0);
  await expect(message).toContainText("可以保留直身廓形，试着让袖口更利落。");
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
