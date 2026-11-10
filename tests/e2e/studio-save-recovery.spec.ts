import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PROJECT } from "../visual/fixtures";
import { prepareStyleContinuity } from "./style-continuity-fixture";

test.setTimeout(90_000);
const output = "output/playwright/studio-save-recovery";
test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});

for (const width of [1440, 320]) {
  test(`新款式回执丢失刷新后可确认原保存，不重建并保留后续草稿 ${width}`, async ({
    page,
  }) => {
    const state = await prepareStyleContinuity(page, { empty: true, width });
    await page.goto(`/${PROJECT}/studio?tab=styles&assetId=look-0`);
    await page.getByLabel("款号", { exact: true }).fill("RECOVER-1");
    await page.getByLabel("款式名称", { exact: true }).fill("待确认的通勤外套");
    await page.getByLabel("品类", { exact: true }).fill("外套");
    state.loseNextSave("after");
    await page.getByRole("button", { name: "保存修订", exact: true }).click();
    const recovery = page.getByRole("region", { name: "保存结果恢复" });
    await expect(
      recovery.getByRole("button", { name: "继续确认保存" }),
    ).toBeVisible();
    expect(state.getData().styles).toHaveLength(2);
    await page.reload();
    await expect(
      recovery.getByRole("button", { name: "继续确认保存" }),
    ).toBeVisible();
    await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
      "待确认的通勤外套",
    );
    expect(state.styleRequests).toHaveLength(1);
    await page.screenshot({
      path: `${output}/pending-${width}.png`,
      animations: "disabled",
    });
    await page
      .getByLabel("款式名称", { exact: true })
      .fill("刷新后继续写下的新草稿");
    await page.getByRole("button", { name: "保存修订", exact: true }).click();
    await expect(page.getByText(/上一份保存尚未确认/)).toBeVisible();
    expect(state.styleRequests).toHaveLength(1);
    await recovery.getByRole("button", { name: "继续确认保存" }).click();
    await expect(
      recovery.getByRole("button", { name: "打开已保存资料" }),
    ).toBeVisible();
    await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
      "刷新后继续写下的新草稿",
    );
    expect(state.styleRequests[1]).toEqual(state.styleRequests[0]);
    expect(state.getData().styles).toHaveLength(2);
    await recovery.getByRole("button", { name: "打开已保存资料" }).click();
    await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
      "刷新后继续写下的新草稿",
    );
    await expect(
      page.getByRole("heading", { name: "待确认的通勤外套", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/styleRevisionId=created-style-1-r1/);
    await page.reload();
    await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
      "刷新后继续写下的新草稿",
    );
    await page.getByRole("button", { name: "保存修订", exact: true }).click();
    await expect(page.getByText(/r2 已保存/)).toBeVisible();
    expect(state.styleRequests[2]?.method).toBe("PATCH");
    expect(state.styleRequests[2]?.body).toMatchObject({ expectedVersion: 1 });
    expect(state.getData().styles).toHaveLength(2);
    await expect(page.getByAltText("当前款式主设计图")).toHaveCSS(
      "opacity",
      "1",
    );
    await page.screenshot({
      path: `${output}/confirmed-${width}.png`,
      animations: "disabled",
    });
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "刷新后继续写下的新草稿",
        exact: true,
      }),
    ).toBeVisible();
    await expect(recovery).toHaveCount(0);
    expect(state.invalid).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("更新款式回执丢失后历史页面确认原r2，不再生成r3", async ({ page }) => {
  const state = await prepareStyleContinuity(page);
  await page.goto(`/${PROJECT}/studio?tab=styles&styleRevisionId=style-r1`);
  await page.getByLabel("款式名称", { exact: true }).fill("确认版本的外套");
  state.loseNextSave("after");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续确认保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/正在查看 r1，最新为 r2/)).toBeVisible();
  expect(state.styleRequests).toHaveLength(1);
  await page.getByRole("button", { name: "继续确认保存" }).click();
  await page.getByRole("button", { name: "打开已保存资料" }).click();
  await expect(page).toHaveURL(/styleRevisionId=style-1-r2/);
  expect(
    state.getData().styles.find((style) => style.id === "style-1")?.version,
  ).toBe(2);
  expect(state.styleRequests[1]).toEqual(state.styleRequests[0]);
  expect(state.errors).toEqual([]);
});

for (const kind of ["tech", "presentation"] as const) {
  test(`${kind}提交前断线刷新后继续原操作，保存后准确打开文档`, async ({
    page,
  }) => {
    const state = await prepareStyleContinuity(page);
    await page.goto(`/${PROJECT}/studio?tab=${kind}&styleRevisionId=style-r1`);
    const field = kind === "tech" ? "技术包名称" : "展示包名称";
    const title = kind === "tech" ? "恢复的制作资料" : "恢复的商品展示";
    await page.getByLabel(field, { exact: true }).fill(title);
    if (kind === "presentation")
      await page
        .getByRole("button", { name: "选择图片 1", exact: true })
        .click();
    state.loseNextSave("before");
    await page.getByRole("button", { name: "保存修订", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续确认保存" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "继续确认保存" }),
    ).toBeVisible();
    expect(state.documentRequests).toHaveLength(1);
    await page.getByRole("button", { name: "继续确认保存" }).click();
    await page.getByRole("button", { name: "打开已保存资料" }).click();
    await expect(page).toHaveURL(/documentId=/);
    await expect(page.getByLabel(field, { exact: true })).toHaveValue(title);
    expect(state.documentRequests[1]).toEqual(state.documentRequests[0]);
    await page.reload();
    await expect(page.getByLabel(field, { exact: true })).toHaveValue(title);
    await expect(
      page.getByRole("button", { name: "继续确认保存" }),
    ).toHaveCount(0);
    await page.getByLabel(field, { exact: true }).fill(`${title}补充`);
    await page.getByRole("button", { name: "保存修订", exact: true }).click();
    await expect.poll(() => state.documentRequests.length).toBe(3);
    expect(state.documentRequests[2]).toMatchObject({
      documentId: `${kind === "tech" ? "tech_pack" : "presentation_set"}-2`,
      expectedVersion: 1,
    });
    expect(state.invalid).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("技术包确认后携带新增表格草稿，刷新仍保留数值中间态与行身份", async ({
  page,
}) => {
  const state = await prepareStyleContinuity(page);
  await page.goto(`/${PROJECT}/studio?tab=tech&styleRevisionId=style-r1`);
  await page.getByLabel("技术包名称", { exact: true }).fill("含表格的制作资料");
  state.loseNextSave("before");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续确认保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "BOM", exact: true }).click();
  await page.getByRole("button", { name: "添加材料", exact: true }).click();
  await page.getByLabel("BOM 1 名称", { exact: true }).fill("羊毛主料");
  await page.getByLabel("BOM 1 用量", { exact: true }).fill("1.");
  await page.getByRole("button", { name: "继续确认保存" }).click();
  await page.getByRole("button", { name: "打开已保存资料" }).click();
  await expect(page).toHaveURL(/documentId=tech_pack-2/);
  await page.reload();
  await page.getByRole("button", { name: "BOM", exact: true }).click();
  await expect(page.getByLabel("BOM 1 名称", { exact: true })).toHaveValue(
    "羊毛主料",
  );
  await expect(page.getByLabel("BOM 1 用量", { exact: true })).toHaveValue(
    "1.",
  );
  await expect(
    page.getByText("本机草稿与当前资料存在差异，请核对后继续。"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "添加材料", exact: true }).click();
  await page.getByLabel("BOM 2 名称", { exact: true }).fill("里料");
  await expect(page.getByLabel("BOM 1 名称", { exact: true })).toHaveValue(
    "羊毛主料",
  );
  expect(state.documentRequests).toHaveLength(2);
  expect(state.errors).toEqual([]);
});

test("未确认期间服务器另有新修订，后续草稿需核对而非自动覆盖", async ({
  page,
}) => {
  const state = await prepareStyleContinuity(page);
  await page.goto(`/${PROJECT}/studio?tab=styles&styleRevisionId=style-r1`);
  await page.getByLabel("款式名称", { exact: true }).fill("待确认的r2");
  state.loseNextSave("after");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续确认保存" }),
  ).toBeVisible();
  await page
    .getByLabel("款式名称", { exact: true })
    .fill("尚未提交的本地合并稿");
  const style = state.getData().styles.find((item) => item.id === "style-1");
  if (!style) throw new Error("款式缺失");
  style.version = 3;
  style.name = "另一个编辑者的r3";
  style.currentRevision = {
    ...style.currentRevision,
    id: "other-editor-r3",
    revision: 3,
    payload: { ...style.currentRevision.payload, name: style.name },
  };
  style.revisions = [style.currentRevision, ...style.revisions];
  await page.getByRole("button", { name: "继续确认保存" }).click();
  await expect(page.getByText(/资料后来已有新修订/)).toBeVisible();
  await page.getByRole("button", { name: "打开已保存资料" }).click();
  await expect(page).toHaveURL(/styleRevisionId=other-editor-r3/);
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "另一个编辑者的r3",
  );
  await page.getByRole("button", { name: "本机草稿状态" }).click();
  await expect(
    page.getByText("本机草稿与当前资料存在差异，请核对后继续。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复另一份草稿" }).click();
  await expect(page.getByLabel("款式名称", { exact: true })).toHaveValue(
    "尚未提交的本地合并稿",
  );
  expect(state.styleRequests).toHaveLength(2);
  expect(
    state.getData().styles.find((item) => item.id === "style-1")?.version,
  ).toBe(3);
  expect(state.errors).toEqual([]);
});
