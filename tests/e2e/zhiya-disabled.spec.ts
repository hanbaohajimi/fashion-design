import { expect, test } from "@playwright/test";
import { PROJECT } from "../visual/fixtures";
import { prepareZhiya, zhiya } from "./zhiya-fixture";

test.skip(!process.env.ZHIYA_DISABLED_URL, "指定关闭 NEXT_PUBLIC_ZHIYA_ENABLED 的独立服务地址");
test.setTimeout(90_000);

test("关闭新版开关仍保留同一个普通聊天入口，不加载角色或旧模型", async ({ page }) => {
  const state = await prepareZhiya(page);
  let characterAssets = 0;
  page.on("request", request => { if (request.url().includes("/assistant/zhiya/")) characterAssets++; });
  await page.goto(`${process.env.ZHIYA_DISABLED_URL}/${PROJECT}`);
  const open = page.getByRole("button", { name: "展开设计助手", exact: true });
  await expect(open).toBeVisible();
  await expect(zhiya(page)).toHaveCount(0);
  await open.click();
  const input = page.getByRole("textbox", { name: "描述设计需求", exact: true });
  await expect(input).toBeVisible();
  await input.fill("关闭角色时依然保留的草稿");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await open.click();
  await expect(input).toHaveValue("关闭角色时依然保留的草稿");
  expect(characterAssets).toBe(0);
  expect(state.oldModelRequests).toBe(0);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
