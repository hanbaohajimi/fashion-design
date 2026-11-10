import { expect, type Locator, type Page } from "@playwright/test";
import sharp from "../../apps/worker/node_modules/sharp";
import { prepareImageEditing } from "./image-editing-fixture";

export const imageTextRegions = [
  { text: "SENZHI", rect: { x: 0.1, y: 0.065, width: 0.64, height: 0.085 } },
  { text: "Autumn 2026", rect: { x: 0.1, y: 0.165, width: 0.65, height: 0.06 } },
] as const;

export async function prepareImageText(page: Page, width = 1440, height = 900, count?: number) {
  const state = await prepareImageEditing(page, width, height, count);
  const source = state.assets.get("look-0");
  if (!source) throw new Error("文字编辑测试缺少原图");
  state.assets.set("look-0", await sharp(source)
    .composite([{
      input: Buffer.from('<svg width="600" height="210"><rect width="600" height="210" fill="#f8f6f0"/><text x="60" y="115" font-family="Arial" font-size="64" font-weight="600" fill="#164a35">SENZHI</text><text x="60" y="170" font-family="Arial" font-size="30" fill="#42554a">Autumn 2026</text></svg>'),
      top: 0, left: 0,
    }]).png().toBuffer());
  let scans = 0;
  let failure = false;
  let empty = false;
  await page.route("**/api/design-assets/look-0/text-regions", route => {
    scans++;
    expect(route.request().method()).toBe("POST");
    if (failure) {
      failure = false;
      return route.fulfill({ status: 503, json: { message: "识别暂不可用，可手动添加区域" } });
    }
    return route.fulfill({ json: {
      regions: empty ? [] : imageTextRegions, width: 600, height: 800, sourceHash: "a".repeat(64),
    } });
  });
  return { ...state, scans: () => scans, failScan: () => { failure = true; }, emptyScan: () => { empty = true; } };
}

export async function openText(workspace: Locator) {
  await workspace.getByRole("button", { name: "修改文字", exact: true }).click();
}

export async function scanText(workspace: Locator) {
  await workspace.getByRole("button", { name: "识别图片文字", exact: true }).click();
  await expect(workspace.getByLabel("原文", { exact: true })).toHaveValue("SENZHI");
}
