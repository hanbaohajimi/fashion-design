import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { contrastFailures } from "./review-accessibility";

const choices = [
  { id: "archive", label: "A 织物档案" },
  { id: "gallery", label: "B 作品展台" },
  { id: "relay", label: "C 任务接力" },
];

async function openPrototype(page: Page, label: string) {
  await page.goto("/prototypes/impeccable");
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function openProject(page: Page) {
  await page
    .getByRole("button", { name: "打开秋冬通勤系列", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "服装设计工作台" }),
  ).toBeVisible();
}

async function saveStyle(page: Page) {
  await page
    .getByRole("button", { name: "保存款式并继续", exact: true })
    .click();
  await expect(page.getByLabel("技术包名称", { exact: true })).toBeVisible();
}

async function setScenario(page: Page, value: string) {
  const field = page.getByLabel("测试状态");
  if (!(await field.isVisible()))
    await page.getByRole("button", { name: "比较设置", exact: true }).click();
  await field.selectOption(value);
}

async function captureState(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `output/impeccable-redesign/prototypes/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display:none !important }";
      document.head.append(style);
    });
  });
});

for (const mobile of [false, true])
  for (const choice of choices) {
    test(`${choice.id} ${mobile ? "mobile" : "desktop"} completes isolated creation and delivery`, async ({
      page,
    }) => {
      const apiCalls: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiCalls.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      await openPrototype(page, choice.label);
      await openProject(page);
      if (mobile) {
        await expect(
          page.getByRole("region", { name: "参考素材" }),
        ).toBeHidden();
        await expect(page.getByLabel("修改要求", { exact: true })).toBeHidden();
        await page
          .getByRole("navigation", { name: "工作台区域" })
          .getByRole("button", { name: "素材", exact: true })
          .click();
        await expect(
          page.getByRole("region", { name: "参考素材" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "并排比较", exact: true }),
        ).toBeHidden();
        await captureState(page, `${choice.id}-materials-390`);
      }
      await page
        .getByRole("button", { name: "引用藏蓝棉混纺", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "取消引用藏蓝棉混纺" }),
      ).toBeVisible();
      await page
        .getByLabel("修改要求", { exact: true })
        .fill("收窄袖口，保留翻领、双排扣和整体长度。");
      await page
        .getByRole("button", { name: "整理修改计划", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "确认并模拟生成" }),
      ).toBeVisible();
      if (mobile) {
        await expect(
          page.getByRole("region", { name: "参考素材" }),
        ).toBeHidden();
        await captureState(page, `${choice.id}-assistant-390`);
      }
      await page.getByRole("button", { name: "确认并模拟生成" }).click();
      await expect(
        page.getByText(
          "模拟生成完成：复用已有袖口编辑样图，未产生新的模型图像。",
          { exact: true },
        ),
      ).toBeVisible();
      if (mobile)
        await page
          .getByRole("navigation", { name: "工作台区域" })
          .getByRole("button", { name: "作品", exact: true })
          .click();
      await page.getByRole("button", { name: "并排比较", exact: true }).click();
      await expect(
        page.getByText("来自同一母图的局部编辑，需放大核对袖口细节。", {
          exact: true,
        }),
      ).toBeVisible();
      await saveStyle(page);
      await page
        .getByLabel("技术包名称", { exact: true })
        .fill("通勤风衣 · 袖口修改交付资料");
      await page
        .getByRole("navigation", { name: "技术包章节" })
        .getByRole("button", { name: "尺寸与公差", exact: true })
        .click();
      await page.getByLabel("衣长（cm）", { exact: true }).fill("114");
      await page
        .getByRole("navigation", { name: "技术包章节" })
        .getByRole("button", { name: "基本资料", exact: true })
        .click();
      await expect(page.getByLabel("技术包名称", { exact: true })).toHaveValue(
        "通勤风衣 · 袖口修改交付资料",
      );
      await page
        .getByRole("button", { name: "保存技术包", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "技术包章节" })
        .getByRole("button", { name: "复核与交付", exact: true })
        .click();
      await expect(
        page.getByText("114 cm / ± 1 cm", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "复核并模拟发布", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", { name: "我已核对本次模拟交付资料" })
        .check();
      if (mobile) await captureState(page, `${choice.id}-review-390`);
      await page
        .getByRole("button", { name: "复核并模拟发布", exact: true })
        .click();
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "下载模拟交付单", exact: true })
        .click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe("Atelier-模拟交付单.txt");
      const path = await download.path();
      expect(path).toBeTruthy();
      const body = await readFile(path as string, "utf8");
      expect(body).toContain("袖口修改版");
      expect(body).toContain("114 cm");
      expect(body).toContain("非生产文件");
      expect(apiCalls).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

test("drafts remain isolated by direction and project; failed state can recover", async ({
  page,
}) => {
  await openPrototype(page, choices[0].label);
  await openProject(page);
  await page.getByLabel("修改要求", { exact: true }).fill("项目一的草稿");
  await page
    .getByRole("button", { name: choices[1].label, exact: true })
    .click();
  await openProject(page);
  await expect(page.getByLabel("修改要求", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: choices[0].label, exact: true })
    .click();
  await expect(page.getByLabel("修改要求", { exact: true })).toHaveValue(
    "项目一的草稿",
  );
  await page.getByLabel("切换当前项目").selectOption("capsule");
  await expect(page.getByLabel("修改要求", { exact: true })).toHaveValue("");
  await page.getByLabel("切换当前项目").selectOption("commute");
  await expect(page.getByLabel("修改要求", { exact: true })).toHaveValue(
    "项目一的草稿",
  );
  await setScenario(page, "error");
  await expect(
    page.getByRole("heading", { name: "暂时无法读取项目" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByLabel("修改要求", { exact: true })).toHaveValue(
    "项目一的草稿",
  );
  await saveStyle(page);
  await page.getByLabel("技术包名称", { exact: true }).fill("");
  await page
    .getByRole("navigation", { name: "技术包章节" })
    .getByRole("button", { name: "复核与交付", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "我已核对本次模拟交付资料" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "保存技术包", exact: true }).click();
  await expect(page.getByLabel("技术包名称", { exact: true })).toBeVisible();
  await expect(
    page.getByText("请填写技术包名称。", { exact: true }),
  ).toBeVisible();
});

test("read-only mode disables mutations and a new selection does not silently rebind a saved style", async ({
  page,
}) => {
  await openPrototype(page, choices[0].label);
  await openProject(page);
  await saveStyle(page);
  await page
    .getByRole("navigation", { name: "原型应用导航" })
    .getByRole("button", { name: "设计工作台", exact: true })
    .click();
  await page
    .getByRole("button", { name: "选择袖口修改版", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "原型应用导航" })
    .getByRole("button", { name: "技术包", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "技术包当前款式：双排扣长风衣" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "原型应用导航" })
    .getByRole("button", { name: "设计工作台", exact: true })
    .click();
  await setScenario(page, "readonly");
  await expect(
    page.getByRole("button", { name: "引用藏蓝棉混纺", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "保存款式并继续", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("修改要求", { exact: true })).toBeDisabled();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 683, height: 384 },
]) {
  test(`all three directions fit ${viewport.width} and retain contrast`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const choice of choices) {
      await openPrototype(page, choice.label);
      for (const screen of ["projects", "workbench", "tech"]) {
        if (screen === "workbench") await openProject(page);
        if (screen === "tech") await saveStyle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page
          .locator("img")
          .evaluateAll((images) =>
            Promise.all(
              images.map((image) =>
                (image as HTMLImageElement).decode().catch(() => undefined),
              ),
            ),
          );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${choice.id} ${screen} overflow`,
        ).toBe(true);
        expect(
          await contrastFailures(page, true),
          `${choice.id} ${screen} contrast`,
        ).toEqual([]);
        if ([1440, 390].includes(viewport.width))
          await page.screenshot({
            path: `output/impeccable-redesign/prototypes/${choice.id}-${screen}-${viewport.width}.png`,
            fullPage: true,
            animations: "disabled",
          });
      }
    }
  });
}

test("empty, long, broken-image, loading and reduced-motion states remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openPrototype(page, choices[0].label);
  await setScenario(page, "long");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await setScenario(page, "empty");
  await page.getByRole("button", { name: "打开空白项目" }).click();
  await expect(
    page.getByRole("heading", { name: "让第一个想法成形" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "填写设计要求" }).click();
  await expect(page.getByLabel("修改要求", { exact: true })).toBeFocused();
  await page.getByLabel("切换当前项目").selectOption("commute");
  await page
    .getByRole("navigation", { name: "工作台区域" })
    .getByRole("button", { name: "作品", exact: true })
    .click();
  await setScenario(page, "image-error");
  await expect(
    page.getByText("图片暂不可用", { exact: true }).first(),
  ).toBeVisible();
  await setScenario(page, "loading");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator('[aria-busy="true"] span')
      .evaluateAll((elements) =>
        elements.every(
          (element) => getComputedStyle(element).animationName === "none",
        ),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "结束加载演示" }).click();
  await expect(
    page.getByRole("region", { name: "服装设计工作台" }),
  ).toBeVisible();
});
