import { mkdir } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { prepareImageEditing } from "./image-editing-fixture";
import sharp from "../../apps/worker/node_modules/sharp";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";

test.setTimeout(90_000);
test.beforeEach(async () => {
  await mkdir("output/playwright/image-editing-recovery", { recursive: true });
});

async function paintRegion(workspace: Locator) {
  const canvas = workspace.getByLabel("局部重绘掩码画布");
  await expect(canvas).toBeVisible();
  await workspace
    .getByRole("button", { name: "标记中央区域", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  return canvas;
}

for (const width of [1440, 320]) {
  test(`${width}px 局部重绘选区与文字刷新恢复且不会自动提交`, async ({
    page,
  }) => {
    const state = await prepareImageEditing(page, width);
    await state.open();
    const workspace = page.getByRole("dialog", { name: "图片工作区" });
    await workspace
      .getByRole("button", { name: "局部重绘", exact: true })
      .click();
    await workspace
      .getByLabel("局部重绘说明")
      .fill("将领口改为窄驳领，保留面料与光线");
    const canvas = await paintRegion(workspace);
    const pixels = await canvas.evaluate((element) =>
      (element as HTMLCanvasElement).toDataURL(),
    );
    // Closing uses the actual draft flush boundary; reopening must restore even
    // before a further page reload, without relying on a debounce sleep.
    await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
    await state.open();
    await expect(workspace.getByLabel("局部重绘说明")).toHaveValue(
      "将领口改为窄驳领，保留面料与光线",
    );
    await expect(canvas).toHaveAttribute("data-stroke-count", "1");
    expect(
      await canvas.evaluate((element) =>
        (element as HTMLCanvasElement).toDataURL(),
      ),
    ).toBe(pixels);
    await page.reload();
    await state.open();
    await expect(workspace).toBeVisible();
    await expect(canvas).toHaveAttribute("data-stroke-count", "1");
    expect(
      await canvas.evaluate((element) =>
        (element as HTMLCanvasElement).toDataURL(),
      ),
    ).toBe(pixels);
    expect(state.commands).toHaveLength(0);
    expect(state.masks).toHaveLength(0);
    await expect(workspace.getByText(/已选约/)).toBeInViewport({ ratio: 1 });
    await workspace.screenshot({
      path: `output/playwright/image-editing-recovery/restored-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await workspace.getByRole("button", { name: "清空", exact: true }).click();
    await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
    await state.open();
    await expect(canvas).toHaveAttribute("data-stroke-count", "0");
    expect(state.errors).toEqual([]);
  });
}

test("提交中与回执待确认时锁住选区，刷新重试保留原任务与蒙版", async ({
  page,
}) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "局部重绘", exact: true })
    .click();
  await workspace.getByLabel("局部重绘说明").fill("调整领口比例，保留衣身");
  const canvas = await paintRegion(workspace);
  state.holdNextSubmission();
  state.loseNextResponse();
  await workspace.getByRole("button", { name: "提交局部重绘" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  const point = {
    pointerId: 5,
    pointerType: "mouse",
    button: 0,
    clientX: 200,
    clientY: 200,
    bubbles: true,
  };
  await canvas.dispatchEvent("pointerdown", point);
  await canvas.dispatchEvent("pointerup", point);
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  state.releaseSubmission();
  await expect(workspace.getByRole("alert")).toContainText("暂未收到任务确认");
  await canvas.dispatchEvent("pointerdown", point);
  await canvas.dispatchEvent("pointerup", point);
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  await page.reload();
  await state.open();
  await expect(
    workspace.getByRole("button", { name: "重试局部重绘" }),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  expect(state.commands).toHaveLength(1);
  await workspace.getByRole("button", { name: "重试局部重绘" }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  await expect(
    workspace.getByAltText("藏蓝通勤外套", { exact: true }),
  ).toBeVisible();
  const recoveryText = await page
    .locator('[aria-label="本机草稿恢复"]')
    .allTextContents();
  await test
    .info()
    .attach("draft-recovery-state", {
      body: JSON.stringify(recoveryText),
      contentType: "application/json",
    });
  expect(recoveryText.join("")).not.toContain("差异");
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(state.masks).toHaveLength(1);
  const exported = await sharp(state.masks[0])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([exported.info.width, exported.info.height]).toEqual([600, 800]);
  expect(exported.data[(10 * 600 + 10) * 4 + 3]).toBe(255);
  expect(exported.data[(400 * 600 + 300) * 4 + 3]).toBe(0);
  expect(state.receipts.size).toBe(1);
  expect(
    state.getGraph().nodes.filter((node) => node.type === "candidate"),
  ).toHaveLength(2);
  await workspace
    .getByRole("button", { name: "查看编辑结果", exact: true })
    .click();
  await expect(
    workspace.getByAltText("局部编辑新版本", { exact: true }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "返回来源图片" }).click();
  await expect(
    workspace.getByAltText("藏蓝通勤外套", { exact: true }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "对比编辑结果" }).click();
  await expect(
    workspace.getByRole("region", { name: "当前图片" }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("region", { name: "对比图片" }),
  ).toBeVisible();
  await workspace.screenshot({
    path: "output/playwright/image-editing-recovery/compare-1440.png",
  });
  expect(state.errors).toEqual([]);
});

test("蒙版上传失败保留选区和说明，擦除只在明确提交后执行", async ({ page }) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace.getByRole("button", { name: "擦除", exact: true }).click();
  const canvas = await paintRegion(workspace);
  state.failNextUpload();
  await workspace.getByRole("button", { name: "提交局部重绘" }).click();
  await expect(workspace.getByRole("alert")).toContainText("上传");
  expect(state.commands).toHaveLength(0);
  await expect(canvas).toHaveAttribute("data-stroke-count", "1");
  await expect(workspace.getByLabel("局部重绘说明")).toHaveValue(
    /移除蒙版内的对象/,
  );
  await expect(
    workspace.getByRole("button", { name: "撤销一笔" }),
  ).toBeEnabled();
  await workspace.getByRole("button", { name: "提交局部重绘" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0]?.parameters).toMatchObject({
    taskType: "inpaint",
    intent: "erase",
    mask: { fileAssetId: "edit-mask" },
  });
  expect(
    state.getGraph().nodes.find((node) => node.id === "material-0")?.payload
      .assetId,
  ).toBe("look-0");
  await expect(
    workspace.getByRole("button", { name: "查看编辑结果" }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("320px 去背景回执丢失后继续原操作，并能比较结果与返回原图", async ({
  page,
}) => {
  const state = await prepareImageEditing(page, 320);
  const source = state.assets.get("look-0");
  if (!source) throw new Error("原图缺失");
  const original = Buffer.from(source);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "移除背景", exact: true })
    .click();
  expect(state.commands).toHaveLength(0);
  state.loseNextResponse();
  await workspace.getByRole("button", { name: "移除背景并生成新版本" }).click();
  await expect(workspace.getByRole("alert")).toContainText("暂未收到任务确认");
  await page.reload();
  await state.open();
  await expect(
    workspace.getByRole("button", { name: "重试原操作" }),
  ).toBeVisible();
  expect(state.commands).toHaveLength(1);
  await workspace.getByRole("button", { name: "重试原操作" }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(state.commands[0]?.parameters).toMatchObject({
    taskType: "i2i",
    intent: "remove_background",
  });
  expect(state.masks).toHaveLength(0);
  expect(state.receipts.size).toBe(1);
  expect(state.assets.get("look-0")).toEqual(original);
  await workspace.getByRole("button", { name: "关闭图片提示" }).click();
  await workspace.screenshot({
    path: "output/playwright/image-editing-recovery/result-links-320.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    workspace.getByRole("button", { name: "查看编辑结果" }),
  ).toBeInViewport({ ratio: 1 });
  await workspace.getByRole("button", { name: "对比编辑结果" }).click();
  await expect(
    workspace.getByRole("region", { name: "对比图片" }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "当前图", exact: true }).click();
  await expect(
    workspace.getByRole("region", { name: "当前图片" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "返回图片", exact: true })
    .click();
  await workspace.getByRole("button", { name: "查看编辑结果" }).click();
  await expect(
    workspace.getByAltText("局部编辑新版本", { exact: true }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "返回来源图片" }).click();
  await expect(
    workspace.getByAltText("藏蓝通勤外套", { exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("原图读取失败可以在编辑器内重试", async ({ page }) => {
  const state = await prepareImageEditing(page);
  let unavailable = true;
  await page.route("**/api/design-assets/look-0/content", (route) =>
    unavailable ? route.fulfill({ status: 503 }) : route.fallback(),
  );
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "局部重绘", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "重新读取原图" }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "提交局部重绘" }),
  ).toBeDisabled();
  unavailable = false;
  await workspace.getByRole("button", { name: "重新读取原图" }).click();
  await expect(workspace.getByLabel("局部重绘掩码画布")).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "提交局部重绘" }),
  ).toBeEnabled();
  expect(state.commands).toHaveLength(0);
});

test("切换账号不会恢复另一位设计师的选区和修改说明", async ({ page }) => {
  const state = await prepareImageEditing(page);
  await state.open();
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await workspace
    .getByRole("button", { name: "局部重绘", exact: true })
    .click();
  await workspace.getByLabel("局部重绘说明").fill("原账号的领口修改");
  await paintRegion(workspace);
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  const me = await page.evaluate(async () => (await fetch("/api/me")).json());
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        ...me,
        user: { ...me.user, id: "mask-other-account", name: "另一位设计师" },
      },
    }),
  );
  await seedReturningFeatureGuideUser(page, ["mask-other-account"]);
  await page.reload();
  await state.open();
  await workspace
    .getByRole("button", { name: "局部重绘", exact: true })
    .click();
  await expect(workspace.getByLabel("局部重绘说明")).toHaveValue("");
  await expect(workspace.getByLabel("局部重绘掩码画布")).toHaveAttribute(
    "data-stroke-count",
    "0",
  );
  expect(state.commands).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
