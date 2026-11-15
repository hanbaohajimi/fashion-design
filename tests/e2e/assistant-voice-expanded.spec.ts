import { expect, test } from "@playwright/test";
import { prepareZhiya, loadZhiya, elementBox } from "./zhiya-fixture";
import { useCanvasPhotograph } from "./canvas-photo-fixture";
import { mockVoice } from "./assistant-voice-fixture";

for (const width of [1440, 390])
  test(`${width}px展开创作框的长语音与超限恢复保持可达`, async ({ page }) => {
    await mockVoice(page);
    const state = await prepareZhiya(page, {
      realClock: true,
      count: 3,
      viewport: { width, height: 700 },
    });
    await useCanvasPhotograph(page);
    await loadZhiya(page);
    const node = page.locator(
      '.tl-shape[data-shape-id="shape:canvas-material-1"]',
    );
    const bounds = await elementBox(node);
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    const composer = page.getByRole("region", { name: "图片创作框" });
    await composer
      .getByRole("button", { name: "展开创作框", exact: true })
      .click();
    const field = composer.getByRole("textbox", { name: "本次创作要求" });
    await field.fill("稿".repeat(4000));
    await field.evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(4000, 4000),
    );
    await composer
      .getByRole("button", { name: "开始语音输入", exact: true })
      .click();
    const stop = composer.getByRole("button", {
      name: "结束语音输入",
      exact: true,
    });
    await expect(stop).toBeVisible();
    await page.evaluate(() =>
      window.voiceFixture.instances
        .at(-1)
        ?.emit("调整风衣的领型，保持肩部与袖子的结构。".repeat(12), false),
    );
    await expect(
      composer.getByRole("button", { name: "取消", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(stop).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: `output/assistant-motion/screenshots/expanded-voice-${width}.png`,
    });
    await page.evaluate(() =>
      window.voiceFixture.instances.at(-1)?.emit("补充语音要求"),
    );
    await stop.click();
    await expect(composer.getByRole("alert")).toContainText("超出");
    for (const name of ["加入草稿", "复制文字", "放弃这段语音"]) {
      const button = composer.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({
      path: `output/assistant-motion/screenshots/expanded-recovery-${width}.png`,
    });
    await field.fill("精简后的设计要求");
    await composer
      .getByRole("button", { name: "加入草稿", exact: true })
      .click();
    await expect(field).toHaveValue("精简后的设计要求\n补充语音要求");
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
