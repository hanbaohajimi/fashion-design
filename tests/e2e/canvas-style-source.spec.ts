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
  test(`历史主图不在白板时可明确放回并继续原款式 ${width}`, async ({
    page,
  }) => {
    const state = await prepareStyleContinuity(page, { width });
    state.removeSourceFromGraph();
    await page.goto(`/${PROJECT}?assetId=look-0&styleRevisionId=style-r1`);
    const source = page.getByRole("complementary", { name: "白板来源图片" });
    await expect(
      source.getByRole("button", { name: "放入白板继续编辑" }),
    ).toBeVisible();
    expect(state.placementRequests).toHaveLength(0);
    await page.screenshot({
      path: `${output}/source-${width}.png`,
      animations: "disabled",
    });
    await source.getByRole("button", { name: "放入白板继续编辑" }).click();
    const image = page.getByRole("dialog", { name: "图片工作区" });
    await expect(image).toBeVisible();
    expect(state.placementRequests).toHaveLength(1);
    expect(state.placementRequests[0]?.payload.assetId).toBe("look-0");
    await expect(image.getByRole("link", { name: "更新款式修订" })).toHaveCount(0);
    await expect(image.getByRole("button", { name: "版本与对比", exact: true })).toBeVisible();
    expect(state.commands).toHaveLength(0);
    expect(state.styleRequests).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("放置回执丢失后刷新只提供确认，重复确认仍是同一白板对象", async ({
  page,
}) => {
  const state = await prepareStyleContinuity(page);
  state.removeSourceFromGraph();
  state.loseNextPlacementResponse();
  await page.goto(`/${PROJECT}?assetId=look-0&styleRevisionId=style-r1`);
  await page.getByRole("button", { name: "放入白板继续编辑" }).click();
  await expect(
    page.getByRole("button", { name: "继续确认放置" }),
  ).toBeVisible();
  await page.reload();
  // The material may already be available after reload; close its details to reach the receipt.
  const image = page.getByRole("dialog", { name: "图片工作区" });
  await expect(image).toBeVisible();
  await image.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(
    page.getByRole("button", { name: "继续确认放置" }),
  ).toBeVisible();
  expect(state.placementRequests).toHaveLength(1);
  await page.getByRole("button", { name: "继续确认放置" }).click();
  await expect(image).toBeVisible();
  expect(state.placementRequests).toHaveLength(2);
  expect(state.placementRequests[1]).toEqual(state.placementRequests[0]);
  expect(state.errors).toEqual([]);
});

test("无权编辑或来源链接不匹配时只提供核对和返回，不导入图片", async ({
  page,
}) => {
  const state = await prepareStyleContinuity(page);
  state.removeSourceFromGraph();
  await page.route(`**/api/projects/${PROJECT}/studio`, (route) =>
    route.fulfill({
      json: {
        ...state.getData(),
        capabilities: { ...state.getData().capabilities, edit: false },
      },
    }),
  );
  await page.goto(`/${PROJECT}?assetId=look-0&styleRevisionId=style-r1`);
  const source = page.getByRole("complementary", { name: "白板来源图片" });
  await expect(source.getByText("款式修订 r1")).toBeVisible();
  await expect(
    source.getByRole("button", { name: "放入白板继续编辑" }),
  ).toHaveCount(0);
  await expect(
    source.getByRole("link", { name: "返回对应款式" }),
  ).toHaveAttribute("href", /styleRevisionId=style-r1/);
  await page.goto(`/${PROJECT}?assetId=foreign-image&styleRevisionId=style-r1`);
  await expect(source.getByText(/这份款式修订或主图已无法访问/)).toBeVisible();
  await expect(
    source.getByRole("button", { name: "放入白板继续编辑" }),
  ).toHaveCount(0);
  expect(state.placementRequests).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("主图仍在流程记录但已从白板移除时，也提供明确的放回入口", async ({
  page,
}) => {
  const state = await prepareStyleContinuity(page);
  state.removeSourcePlacement();
  await page.goto(`/${PROJECT}?assetId=look-0&styleRevisionId=style-r1`);
  const source = page.getByRole("complementary", { name: "白板来源图片" });
  await expect(
    source.getByRole("button", { name: "放入白板继续编辑" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "图片工作区" })).toHaveCount(0);
  await source.getByRole("button", { name: "放入白板继续编辑" }).click();
  await expect(page.getByRole("dialog", { name: "图片工作区" })).toBeVisible();
  expect(state.placementRequests).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
