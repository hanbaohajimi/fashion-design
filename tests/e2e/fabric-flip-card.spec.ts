import { expect, test, type Locator, type Page } from "@playwright/test";

import type { Fabric } from "../../apps/web/src/modules/fabrics/fabric-types";
import { NOW, PROJECT, seedVisualApp } from "../visual/fixtures";

async function shadowCuts(card: Locator) {
  return card.locator("[data-flipped]").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const outsets = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const shadow of getComputedStyle(element).boxShadow.split(
      /,(?![^(]*\))/u,
    )) {
      const lengths = shadow
        .replace(/rgba?\([^)]*\)/gu, "")
        .match(/-?\d+(?:\.\d+)?px/gu)
        ?.map(parseFloat);
      if (!lengths || shadow.includes("inset")) continue;
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
      const radius = Math.max(0, blur * 1.5 + spread);
      outsets.left = Math.max(outsets.left, radius - x);
      outsets.right = Math.max(outsets.right, radius + x);
      outsets.top = Math.max(outsets.top, radius - y);
      outsets.bottom = Math.max(outsets.bottom, radius + y);
    }
    const paint = {
      top: box.top - outsets.top,
      right: box.right + outsets.right,
      bottom: box.bottom + outsets.bottom,
      left: box.left - outsets.left,
    };
    const findings: Array<{ ancestor: string; cut: number }> = [];
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const clipsX = /^(hidden|clip|auto|scroll)$/u.test(style.overflowX);
      const clipsY = /^(hidden|clip|auto|scroll)$/u.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const rect = ancestor.getBoundingClientRect();
      const cut = Math.max(
        0,
        ...(clipsX
          ? [
              rect.left + ancestor.clientLeft - paint.left,
              paint.right -
                rect.left -
                ancestor.clientLeft -
                ancestor.clientWidth,
            ]
          : []),
        ...(clipsY
          ? [
              rect.top + ancestor.clientTop - paint.top,
              paint.bottom -
                rect.top -
                ancestor.clientTop -
                ancestor.clientHeight,
            ]
          : []),
      );
      if (cut > 0.5) findings.push({ ancestor: ancestor.className, cut });
    }
    const viewportCut = Math.max(
      0,
      -paint.left,
      paint.right - innerWidth,
      -paint.top,
      paint.bottom - innerHeight,
    );
    if (viewportCut > 0.5)
      findings.push({ ancestor: "viewport", cut: viewportCut });
    return findings;
  });
}

function fabrics(): Fabric[] {
  const first: Fabric = {
    id: "fabric-flip-0",
    canManage: true,
    scope: "user",
    mainFileId: "flip-file-0",
    mainImageUrl: "/flip-fabric-0.svg",
    tags: ["棉麻", "透气", "春夏"],
    createdAt: NOW,
    updatedAt: NOW,
    details: {
      name: "棉麻斜纹",
      code: "FM-017",
      category: "梭织",
      composition: [
        { fiber: "棉", percent: 60 },
        { fiber: "亚麻", percent: 40 },
      ],
      weightGsm: 185,
      widthCm: 148,
      stretch: "微弹",
      weave: "斜纹",
      supplier: "苏州面料工坊",
      provenance: {
        composition: { source: "supplier" },
        weightGsm: { source: "measured", note: "裁片称重" },
        widthCm: { source: "measured" },
        stretch: { source: "supplier" },
        weave: { source: "supplier" },
        supplier: { source: "manual" },
      },
    },
  };
  return Array.from({ length: 24 }, (_, index) => ({
    ...first,
    id: `fabric-flip-${index}`,
    mainImageUrl: `/flip-fabric-${index % 4}.svg`,
    scope: index === 0 ? "user" : "preset",
    canManage: index === 0,
    details:
      index === 1
        ? null
        : index === 2
          ? {
              ...first.details,
              name: "长名称棉麻混纺面料".repeat(8),
              supplier: "很长的供应商资料与产地说明".repeat(10),
              composition: Array.from({ length: 12 }, (_, i) => ({
                fiber: `复合纤维${i + 1}的完整名称`,
                percent: i === 11 ? 12 : 8,
              })),
            }
          : {
              ...first.details,
              name: index === 0 ? "棉麻斜纹" : `面料样本 ${index + 1}`,
            },
  }));
}

async function seedFabrics(page: Page) {
  await seedVisualApp(page, { realClock: true });
  const items = fabrics();
  await page.route("**/flip-fabric-*.svg", (route) => {
    const index = Number(
      /flip-fabric-(\d+)/u.exec(route.request().url())?.[1] ?? 0,
    );
    const colors = ["#b3a28a", "#6e8270", "#a58e83", "#708193"];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><defs><pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${colors[index]}"/><path d="M0 1h6M1 0v6" stroke="#ffffff" stroke-opacity=".2"/><path d="M0 4h6M4 0v6" stroke="#182b21" stroke-opacity=".14"/></pattern></defs><rect width="600" height="800" fill="url(#weave)"/></svg>`,
    });
  });
  await page.route("**/api/fabrics?*", (route) =>
    route.fulfill({
      json: { items, total: items.length, totalPages: 1, page: 1, limit: 48 },
    }),
  );
  return items;
}

for (const width of [1440, 1280, 390]) {
  test.describe(`面料双面卡片 ${width}`, () => {
    test.use({
      viewport: { width, height: width < 768 ? 844 : 900 },
      hasTouch: width < 768,
      isMobile: width < 768,
    });

    test("纯图、规格、键盘及档案往返保持布局和焦点", async ({
      page,
    }, testInfo) => {
      await seedFabrics(page);
      await page.goto(`/fabrics?from=board&boardId=${PROJECT}`);
      const card = page.getByRole("article", {
        name: "棉麻斜纹，面料卡片",
        exact: true,
      });
      const front = card.getByRole("button", {
        name: "查看面料规格：棉麻斜纹",
      });
      await expect(front).toBeVisible();
      await card
        .getByRole("img")
        .evaluate((image: HTMLImageElement) => image.decode());
      expect(await card.getAttribute("draggable")).toBe("false");
      await expect(
        card.getByRole("button", { name: "加入当前项目" }),
      ).toHaveCount(0);
      expect(await front.locator("..").innerText()).toBe("");
      const before = await card.boundingBox();
      expect(before).not.toBeNull();
      expect(await shadowCuts(card)).toEqual([]);
      expect(
        Math.abs((before?.width ?? 0) / (before?.height ?? 1) - 0.75),
      ).toBeLessThan(0.01);
      await page.screenshot({
        path: testInfo.outputPath(`面料正面-${width}.png`),
      });

      await front.click();
      const back = card.getByRole("button", { name: "返回面料图片：棉麻斜纹" });
      await expect(back).toBeFocused();
      await expect(back.getByText("棉 60% / 亚麻 40%")).toBeVisible();
      await expect(back.getByText("185 g/m²")).toBeVisible();
      await expect(
        card.getByRole("button", { name: "加入当前项目" }),
      ).toBeVisible();
      expect(await card.boundingBox()).toEqual(before);
      expect(await shadowCuts(card)).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await card
          .locator('[aria-hidden="true"]')
          .evaluateAll((faces) =>
            faces.every((face) => face.hasAttribute("inert")),
          ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`面料背面-${width}.png`),
      });

      await page.keyboard.press("Space");
      await expect(front).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(back).toBeFocused();
      const archive = card.getByRole("button", { name: "完整档案：棉麻斜纹" });
      await archive.click();
      const dialog = page.getByRole("dialog", { name: "管理或删除面料" });
      await expect(dialog.getByText("实测 裁片称重")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`面料完整档案-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(archive).toBeFocused();
      await expect(back).toBeVisible();
    });
  });
}

test("翻面状态在真实虚拟列表卸载及重挂后保持，切换页面后重置", async ({
  page,
}) => {
  await seedFabrics(page);
  await page.goto("/fabrics");
  const card = page.getByRole("article", {
    name: "棉麻斜纹，面料卡片",
    exact: true,
  });
  await card.getByRole("button", { name: "查看面料规格：棉麻斜纹" }).click();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(card).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    card.getByRole("button", { name: "返回面料图片：棉麻斜纹" }),
  ).toBeVisible();
  await page.goto("/fabrics");
  await expect(
    card.getByRole("button", { name: "查看面料规格：棉麻斜纹" }),
  ).toBeVisible();
});

test("档案保存失败保留输入，重试成功立即更新背面", async ({ page }) => {
  const items = await seedFabrics(page);
  let attempts = 0;
  await page.route("**/api/fabrics/fabric-flip-0", async (route) => {
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { message: "面料保存暂时失败" },
      });
    const body = route.request().postDataJSON();
    items[0] = { ...items[0], ...body, updatedAt: "2026-11-14T03:00:00Z" };
    return route.fulfill({ json: items[0] });
  });
  await page.goto("/fabrics");
  await page.getByRole("button", { name: "查看面料规格：棉麻斜纹" }).click();
  await page.getByRole("button", { name: "完整档案：棉麻斜纹" }).click();
  const dialog = page.getByRole("dialog", { name: "管理或删除面料" });
  await dialog.getByRole("button", { name: "编辑档案" }).click();
  await dialog
    .getByRole("textbox", { name: "面料名称", exact: true })
    .fill("棉麻斜纹 · 新档案");
  await dialog.getByRole("button", { name: "保存档案" }).click();
  await expect(dialog.getByRole("alert")).toContainText("面料保存暂时失败");
  await expect(
    dialog.getByRole("textbox", { name: "面料名称", exact: true }),
  ).toHaveValue("棉麻斜纹 · 新档案");
  await dialog.getByRole("button", { name: "保存档案" }).click();
  await expect(dialog.getByRole("button", { name: "编辑档案" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "完整档案：棉麻斜纹 · 新档案" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "返回面料图片：棉麻斜纹 · 新档案" }),
  ).toContainText("棉麻斜纹 · 新档案");
});

test("加入项目失败可重试，期间按钮锁定且卡片保持背面", async ({ page }) => {
  await seedFabrics(page);
  let attempts = 0;
  await page.route(
    `**/api/projects/${PROJECT}/canvas/commands`,
    async (route) => {
      attempts += 1;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { message: "面料暂时未能加入，请重试" },
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return route.fulfill({ json: { nodeId: "fabric-reference" } });
    },
  );
  await page.goto(`/fabrics?from=board&boardId=${PROJECT}`);
  const card = page.getByRole("article", {
    name: "棉麻斜纹，面料卡片",
    exact: true,
  });
  await card.getByRole("button", { name: "查看面料规格：棉麻斜纹" }).click();
  await card.getByRole("button", { name: "加入当前项目" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "面料暂时未能加入",
  );
  await expect(
    card.getByRole("button", { name: "返回面料图片：棉麻斜纹" }),
  ).toBeVisible();
  await card.getByRole("button", { name: "加入当前项目" }).click();
  await expect(card.getByRole("button", { name: "正在加入…" })).toBeDisabled();
  await expect(page.getByText("面料已在当前项目中。")).toBeVisible();
  expect(attempts).toBe(2);
});

test("普通动态可连续打断并收敛到目标面，减弱动态立即切换", async ({ page }) => {
  await seedFabrics(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/fabrics");
  const card = page.getByRole("article", {
    name: "棉麻斜纹，面料卡片",
    exact: true,
  });
  const front = card.getByRole("button", { name: "查看面料规格：棉麻斜纹" });
  await expect(front).toBeVisible();
  const box = await card.boundingBox();
  if (!box) throw new Error("卡片不可见");
  for (let i = 0; i < 9; i += 1)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await shadowCuts(card)).toEqual([]);
  await expect(
    card.getByRole("button", { name: "返回面料图片：棉麻斜纹" }),
  ).toBeFocused();
  const rotor = card.locator("[data-flipped] > div");
  await expect
    .poll(() =>
      rotor.evaluate(
        (element) =>
          new DOMMatrixReadOnly(getComputedStyle(element).transform).m11,
      ),
    )
    .toBeCloseTo(-1, 3);
  expect(await shadowCuts(card)).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Enter");
  await expect(front).toBeFocused();
  expect(
    await rotor.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
});

test.describe("手机长资料与原生滚动", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("卡片内部滑动只滚动规格，操作保持可见且只读档案不能编辑", async ({
    page,
  }) => {
    await seedFabrics(page);
    await page.goto("/fabrics");
    const name = "长名称棉麻混纺面料".repeat(8);
    const card = page.getByRole("article", {
      name: `${name}，面料卡片`,
      exact: true,
    });
    await expect(
      page.getByRole("button", { name: "查看面料规格：棉麻斜纹" }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1000));
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: `查看面料规格：${name}` }).tap();
    const back = card.getByRole("button", { name: `返回面料图片：${name}` });
    const specs = back.locator("[id]");
    const box = await specs.boundingBox();
    if (!box) throw new Error("规格区不可见");
    const x = box.x + box.width / 2;
    const y = box.y + box.height - 12;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - i * 18 }],
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    // Hold before lifting so this checks a deliberate scroll, without fling.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const hold = () => {
            if (++frames === 8) resolve();
            else requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }),
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect
      .poll(() => specs.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(back).toBeVisible();
    await expect(
      card.getByRole("button", { name: `完整档案：${name}` }),
    ).toBeInViewport();
    await card.getByRole("button", { name: `完整档案：${name}` }).tap();
    const dialog = page.getByRole("dialog", { name: "面料档案", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "编辑档案" })).toHaveCount(
      0,
    );
    await expect(dialog.getByRole("button", { name: "删除" })).toHaveCount(0);
    await expect(dialog.getByText("此面料为只读资料")).toBeVisible();
  });
});
