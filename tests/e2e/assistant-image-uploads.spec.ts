import { expect, test, type Page } from "@playwright/test";
import {
  assistantImageUploadFixture,
  chatImageBytes,
} from "./assistant-image-upload-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";
import { chooseValue, valueControl } from "./choice-control";
test.setTimeout(70_000);
const input = (page: Page) =>
  page.getByRole("textbox", { name: "描述设计需求", exact: true });
const references = (page: Page) =>
  page
    .getByLabel("正在讨论", { exact: true })
    .locator("[data-assistant-reference-id]");
const tray = (page: Page) =>
  page.getByLabel("待加入的参考图片", { exact: true });
const upload = (page: Page, names: string[] = ["参考外套.png"]) =>
  page.getByLabel("选择助手参考图片", { exact: true }).setInputFiles(
    names.map((name, i) => ({
      name,
      mimeType: "image/png",
      buffer: i
        ? Buffer.concat([chatImageBytes, Buffer.from([i])])
        : chatImageBytes,
    })),
  );

for (const width of [1440, 320])
  test(`${width}px聊天上传多图自动追加当前草稿引用，明确发送才调用助手`, async ({
    page,
  }) => {
    const state = await assistantImageUploadFixture(page, { width });
    await state.open();
    await input(page).fill("比较两张参考的领口，保留面料质感");
    const textbox = await input(page).elementHandle();
    await input(page).evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(3, 5),
    );
    await upload(page, ["正面参考.png", "领口参考.png"]);
    await expect(references(page)).toHaveCount(2);
    await expect(tray(page)).toHaveCount(0);
    expect(state.sign).toHaveLength(2);
    expect(state.puts).toHaveLength(2);
    expect(state.imports).toHaveLength(2);
    expect(state.sends).toEqual([]);
    expect(
      await references(page).evaluateAll((elements) =>
        elements.map((element) => element.textContent),
      ),
    ).toEqual([
      expect.stringContaining("正面参考.png"),
      expect.stringContaining("领口参考.png"),
    ]);
    await expect(input(page)).toHaveValue("比较两张参考的领口，保留面料质感");
    expect(await textbox?.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    expect(
      await input(page).evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([3, 5]);
    await page.getByRole("button", { name: "发送需求", exact: true }).click();
    await expect.poll(() => state.sends.length).toBe(1);
    expect(state.sends[0]?.referencedNodeIds).toEqual([
      "uploaded-1",
      "uploaded-2",
    ]);
    expect(state.errors).toEqual([]);
  });

test("粘贴图片到聊天只由聊天接收，文字与光标内容一并保留", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("保留前后文字");
  await input(page).evaluate(async (element, encoded) => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    data.items.add(new File([bytes], "粘贴参考.png", { type: "image/png" }));
    data.setData("text/plain", "加上参考");
    element.focus();
    (element as HTMLTextAreaElement).setSelectionRange(2, 2);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, chatImageBytes.toString("base64"));
  await expect(references(page)).toHaveCount(1);
  await expect(input(page)).toHaveValue("保留加上参考前后文字");
  expect(state.sign).toHaveLength(1);
  expect(state.imports).toHaveLength(1);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("尚无会话时上传不创建对话，刷新保留引用，发送后只建一次", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  const conversations: {
    id: string;
    mode: string;
    projectId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  }[] = [];
  let created = 0;
  await page.route(
    `**/api/projects/${PROJECT}/agent-conversations**`,
    (route) => {
      if (route.request().method() === "POST") {
        const conversation = {
          id: "new-upload-chat",
          mode: "workflow",
          projectId: PROJECT,
          title: "参考设计对话",
          createdAt: NOW,
          updatedAt: NOW,
        };
        conversations.push(conversation);
        created++;
        return route.fulfill({ json: conversation });
      }
      return route.fulfill({
        json: { items: conversations, nextCursor: null },
      });
    },
  );
  await state.open();
  await input(page).fill("先讨论这张新参考，不直接生图");
  await upload(page);
  await expect(references(page)).toHaveCount(1);
  await expect(tray(page)).toHaveCount(0);
  expect(created).toBe(0);
  expect(state.sends).toEqual([]);
  await page.reload();
  await expect(input(page)).toHaveValue("先讨论这张新参考，不直接生图");
  await expect(references(page)).toHaveCount(1);
  expect(created).toBe(0);
  expect(state.sign).toHaveLength(1);
  await page.getByRole("button", { name: "发送需求", exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(1);
  expect(created).toBe(1);
  expect(state.sends[0]?.referencedNodeIds).toEqual(["uploaded-1"]);
  await expect(input(page)).toHaveValue("");
  await page.reload();
  await expect(input(page)).toHaveValue("");
  await expect(references(page)).toHaveCount(0);
  expect(created).toBe(1);
  expect(state.errors).toEqual([]);
});

test("多张图片准备期间继续输入采用最新正文，完成时不丢光标或已有引用", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("最初想法");
  let release!: () => void;
  state.holdImport = new Promise((resolve) => {
    release = resolve;
  });
  await upload(page, ["第一张.png", "第二张.png"]);
  await expect.poll(() => state.imports.length).toBe(1);
  await input(page).fill("后来补充的设计要求");
  await input(page).evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(2, 4),
  );
  release();
  state.holdImport = null;
  await expect(references(page)).toHaveCount(2);
  await expect(tray(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("后来补充的设计要求");
  expect(
    await input(page).evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([2, 4]);
  await page.reload();
  await expect(input(page)).toHaveValue("后来补充的设计要求");
  await expect(references(page)).toHaveCount(2);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("拖入聊天使用相同私有上传路径，不在白板重复接收", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  const data = await page.evaluateHandle((encoded) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
        "拖入参考.png",
        { type: "image/png" },
      ),
    );
    return data;
  }, chatImageBytes.toString("base64"));
  const drop = page.locator("[data-assistant-image-drop]");
  await drop.dispatchEvent("dragenter", { dataTransfer: data });
  await expect(drop).toContainText("松开添加参考图片");
  await drop.dispatchEvent("drop", { dataTransfer: data });
  await expect(references(page)).toHaveCount(1);
  expect(state.sign).toHaveLength(1);
  expect(state.imports).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("上传失败阻止发送，继续只重试原附件且不清空正文", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  state.failedPut = true;
  await state.open();
  await input(page).fill("保留这份设计需求");
  await upload(page);
  await expect(tray(page).getByRole("alert")).toContainText("直传失败");
  await expect(
    page.getByRole("button", { name: "发送需求", exact: true }),
  ).toBeDisabled();
  await tray(page).getByRole("button", { name: "继续添加" }).click();
  await expect(references(page)).toHaveCount(1);
  await expect(tray(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("保留这份设计需求");
  expect(state.imports).toHaveLength(1);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("加入项目回执丢失后刷新只提示确认，沿用原编号不重传", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  state.loseImport = true;
  await state.open();
  await input(page).fill("刷新后继续核对这件衣服");
  await upload(page);
  await expect(tray(page).getByRole("alert")).toContainText("暂未确认");
  const command = structuredClone(state.imports[0]);
  await page.reload();
  await expect(input(page)).toHaveValue("刷新后继续核对这件衣服");
  await expect(
    tray(page).getByRole("button", { name: "继续添加" }),
  ).toBeVisible();
  expect(state.imports).toHaveLength(1);
  await tray(page).getByRole("button", { name: "继续添加" }).click();
  await expect(references(page)).toHaveCount(1);
  await expect(tray(page)).toHaveCount(0);
  expect(state.sign).toHaveLength(1);
  expect(state.imports).toHaveLength(2);
  expect(state.imports[1]).toEqual(command);
  expect(
    state.getGraph().nodes.filter((node) => node.type === "reference_image"),
  ).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("切换对话时停止上传，迟到结果不进入新对话，回原对话可继续", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  await page.route(
    `**/api/projects/${PROJECT}/agent-conversations?*`,
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "visual-chat",
              title: "原设计对话",
              mode: "workflow",
              projectId: PROJECT,
              createdAt: NOW,
              updatedAt: NOW,
            },
            {
              id: "other-chat",
              title: "另一设计对话",
              mode: "workflow",
              projectId: PROJECT,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          nextCursor: null,
        },
      }),
  );
  await state.open();
  await input(page).fill("原对话草稿");
  let release!: () => void;
  state.holdImport = new Promise((resolve) => {
    release = resolve;
  });
  await upload(page);
  await expect.poll(() => state.imports.length).toBe(1);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await chooseValue(valueControl(page, "历史对话"), "other-chat");
  await expect(input(page)).toHaveValue("");
  release();
  state.holdImport = null;
  await expect(references(page)).toHaveCount(0);
  await chooseValue(valueControl(page, "历史对话"), "visual-chat");
  await expect(input(page)).toHaveValue("原对话草稿");
  await expect(
    tray(page).getByRole("button", { name: "继续添加" }),
  ).toBeVisible();
  await tray(page).getByRole("button", { name: "继续添加" }).click();
  await expect(references(page)).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test("账号切换不显示旧附件与迟到引用，只读项目没有上传入口", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  let account = "visual-designer";
  await seedReturningFeatureGuideUser(page, ["upload-other"]);
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        user: { id: account, email: "test@example.test", name: "设计师" },
        credits: { limit: 600, used: 0, remaining: 600 },
      },
    }),
  );
  await state.open();
  let release!: () => void;
  state.holdSign = new Promise((resolve) => {
    release = resolve;
  });
  await upload(page);
  await expect.poll(() => state.sign.length).toBe(1);
  account = "upload-other";
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "fashion:session-change",
        newValue: "upload-account-change",
      }),
    ),
  );
  await expect(
    page.getByLabel("选择助手参考图片", { exact: true }),
  ).toBeEnabled();
  release();
  state.holdSign = null;
  await expect(tray(page)).toHaveCount(0);
  await expect(references(page)).toHaveCount(0);
  expect(state.imports).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("非图片与超过引用上限整批拒绝，普通文本粘贴仍由输入框处理", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await page.getByLabel("选择助手参考图片").setInputFiles({
    name: "video.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("video"),
  });
  await expect(tray(page).getByRole("alert")).toContainText("仅支持");
  expect(state.sign).toEqual([]);
  await tray(page).getByRole("button", { name: "关闭图片添加提示" }).click();
  await upload(
    page,
    Array.from({ length: 17 }, (_, i) => `reference-${i}.png`),
  );
  await expect(tray(page).getByRole("alert")).toContainText("超过 16");
  expect(state.sign).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("只读白板保留聊天阅读但不显示上传图片", async ({ page }) => {
  const state = await assistantImageUploadFixture(page, { canEdit: false });
  await state.open();
  await expect(
    page
      .getByRole("complementary", { name: "设计助手", exact: true })
      .getByRole("button", { name: "上传图片", exact: true }),
  ).toHaveCount(0);
  expect(state.sign).toEqual([]);
});

test("上传中暂停可立即移除，正文与发送恢复，迟到响应不接入", async ({
  page,
}) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("不需要这张图了");
  let release!: () => void;
  state.holdSign = new Promise((resolve) => {
    release = resolve;
  });
  await upload(page);
  await expect(
    tray(page).getByRole("button", { name: /^暂停上传/ }),
  ).toBeVisible();
  await tray(page)
    .getByRole("button", { name: /^暂停上传/ })
    .click();
  await tray(page)
    .getByRole("button", { name: /^移除待添加图片/ })
    .click();
  await expect(tray(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "发送需求", exact: true }),
  ).toBeEnabled();
  release();
  state.holdSign = null;
  await expect(input(page)).toHaveValue("不需要这张图了");
  expect(state.imports).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("上传中刷新要求重选原文件，匹配后继续不丢正文", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  await input(page).fill("稍后继续这份参考");
  let release!: () => void;
  state.holdSign = new Promise((resolve) => {
    release = resolve;
  });
  await upload(page);
  await expect.poll(() => state.sign.length).toBe(1);
  await page.reload();
  release();
  state.holdSign = null;
  await expect(
    tray(page).getByRole("button", { name: "重新选择", exact: true }),
  ).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await tray(page)
    .getByRole("button", { name: "重新选择", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "参考外套.png",
    mimeType: "image/png",
    buffer: chatImageBytes,
  });
  await expect(references(page)).toHaveCount(1);
  await expect(tray(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("稍后继续这份参考");
  expect(state.imports).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("普通文字粘贴不被图片逻辑拦截，不增加上传或生成请求", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  const accepted = await input(page).evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "原生粘贴文字");
    return element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(accepted).toBe(true);
  expect(state.sign).toEqual([]);
  expect(state.imports).toEqual([]);
  expect(state.sends).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("图片处理明确失败后继续重试原文件，不误接入或发送", async ({ page }) => {
  const state = await assistantImageUploadFixture(page);
  await state.open();
  state.failedThumbnail = true;
  await input(page).fill("保留这份设计要求");
  await upload(page);
  await expect(tray(page).getByRole("alert")).toContainText("缩略图生成失败");
  expect(state.imports).toEqual([]);
  await tray(page)
    .getByRole("button", { name: "继续添加", exact: true })
    .click();
  await expect(references(page)).toHaveCount(1);
  await expect(tray(page)).toHaveCount(0);
  expect(state.sign).toHaveLength(2);
  expect(state.imports).toHaveLength(1);
  expect(state.sends).toEqual([]);
  await expect(input(page)).toHaveValue("保留这份设计要求");
  expect(state.errors).toEqual([]);
});

for (const height of [640, 400])
  test(`320×${height}多附件和引用时输入与发送可见，参考区独立滚动`, async ({
    page,
  }) => {
    const state = await assistantImageUploadFixture(page, { width: 320 });
    await state.open();
    await page.setViewportSize({ width: 320, height });
    await input(page).fill("这是一份保留在输入区的设计要求");
    await upload(page, ["正面.png", "领口.png", "袖口.png", "后背.png", "面料.png", "配色.png", "细节.png"]);
    await expect(references(page)).toHaveCount(7);
    await expect(tray(page)).toHaveCount(0);
    await expect(input(page)).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "发送需求", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await input(page).evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeGreaterThanOrEqual(63);
    const referenceArea = page.locator("[data-discussion-references]");
    expect(
      await referenceArea.evaluate((element) => element.scrollWidth),
    ).toBeGreaterThan(
      await referenceArea.evaluate((element) => element.clientWidth),
    );
    await referenceArea.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(
      references(page)
        .last()
        .locator("[data-reference-preview]"),
    ).toBeInViewport({ ratio: 1 });
    expect(state.errors).toEqual([]);
  });
