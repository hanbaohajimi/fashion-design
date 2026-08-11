import { expect, test, type Locator, type Page } from "@playwright/test";

const PROJECT_ID = "e2e-connector";
const NOW = "2026-08-05T06:00:00.000Z";

test.describe("连接器功能", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspace(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto(`/${PROJECT_ID}`);
    await expect(page.locator(".tl-canvas")).toBeVisible();
  });

  test("连接器模式显示素材锚点，退出后全部隐藏", async ({ page }) => {
    await createSeparatedNotes(page);
    const connectorButton = page.getByRole("button", { name: "连接器工具" });
    await connectorButton.click();
    await expect(connectorButton).toHaveAttribute("aria-pressed", "true");

    const anchors = page.locator("[data-anchor-side][data-shape-id]");
    await expect(anchors).toHaveCount(8);
    const shapeIds = await uniqueShapeIds(anchors);
    expect(shapeIds).toHaveLength(2);

    await page.keyboard.press("Escape");
    await expect(anchors).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "选择工具" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("锚点在画布缩放和平移时保持在对应元素附近", async ({ page }) => {
    await createSeparatedNotes(page);
    await page.getByRole("button", { name: "连接器工具" }).click();
    const anchor = page.locator("[data-anchor-side][data-shape-id]").first();
    const initial = await anchor.boundingBox();
    expect(initial).not.toBeNull();

    await page.mouse.move(initial?.x ?? 400, initial?.y ?? 350);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -220);
    await page.keyboard.up("Control");
    const zoomed = await anchor.boundingBox();
    expect(zoomed).not.toBeNull();
    expect(Math.abs((zoomed?.x ?? 0) - (initial?.x ?? 0))).toBeLessThan(500);
    expect(Math.abs((zoomed?.y ?? 0) - (initial?.y ?? 0))).toBeLessThan(500);

    await page.mouse.move(440, 420);
    await page.mouse.wheel(140, 90);
    const panned = await anchor.boundingBox();
    expect(panned).not.toBeNull();
    expect(Math.abs((panned?.x ?? 0) - (zoomed?.x ?? 0))).toBeGreaterThan(20);
  });

  test("Esc 退出连接器模式并回到选择工具", async ({ page }) => {
    const connectorButton = page.getByRole("button", { name: "连接器工具" });
    await connectorButton.click();
    await expect(connectorButton).toHaveAttribute("aria-pressed", "true");

    await page.mouse.click(900, 160);
    await page.keyboard.press("Escape");

    await expect(connectorButton).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: "选择工具" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("固定工具创建红色图钉", async ({ page }) => {
    await page.getByRole("button", { name: "添加灵感便签" }).click();
    const anchors = page.locator("[data-anchor-side][data-shape-id]");
    await page.getByRole("button", { name: "连接器工具" }).click();
    await expect(anchors).toHaveCount(4);
    const topAnchorBounds = await page
      .locator('[data-anchor-side="top"]')
      .boundingBox();
    expect(topAnchorBounds).not.toBeNull();

    const pinButton = page.getByRole("button", { name: "固定素材" });
    await expect(pinButton).toHaveAttribute("aria-pressed", "false");
    const pinStyles = await pinButton.evaluate((button) => {
      const styles = window.getComputedStyle(button);
      const icon = button.querySelector("svg");
      return {
        background: styles.backgroundColor,
        borderWidth: styles.borderWidth,
        color: styles.color,
        height: styles.height,
        iconHeight: icon?.getAttribute("height"),
        iconTransform: icon ? window.getComputedStyle(icon).transform : "none",
        iconWidth: icon?.getAttribute("width"),
        width: styles.width,
      };
    });
    expect(pinStyles).toMatchObject({
      background: "rgba(0, 0, 0, 0)",
      borderWidth: "0px",
      color: "rgb(184, 90, 86)",
      height: "32px",
      iconHeight: "16",
      iconWidth: "16",
      width: "32px",
    });
    expect(pinStyles.iconTransform).not.toBe("none");
    await pinButton.click();
    await expect(pinButton).toHaveAttribute("aria-pressed", "true");
    await expect(anchors).toHaveCount(0);
    await page.mouse.click(
      (topAnchorBounds?.x ?? 0) + (topAnchorBounds?.width ?? 0) / 2,
      (topAnchorBounds?.y ?? 0) + (topAnchorBounds?.height ?? 0) / 2 + 20,
    );

    await expect(page.locator('radialGradient[id^="rp-"]')).toHaveCount(1);
    await expect(page.locator('radialGradient[id^="bp-"]')).toHaveCount(0);
  });
});

async function createSeparatedNotes(page: Page): Promise<void> {
  await page.getByRole("button", { name: "添加灵感便签" }).click();
  await page.getByRole("button", { name: "添加色卡" }).click();
}

async function uniqueShapeIds(anchors: Locator): Promise<string[]> {
  const ids = await anchors.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-shape-id") ?? ""),
  );
  return [...new Set(ids.filter(Boolean))];
}

async function mockWorkspace(page: Page): Promise<void> {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 600, remaining: 540, used: 60 },
        user: {
          authId: "auth-connector",
          avatar: null,
          createdAt: NOW,
          deletedAt: null,
          email: "connector@example.com",
          id: "user-connector",
          name: "Connector E2E",
        },
      },
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/board`, (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? { batchId: "connector-save", revision: 1, savedAt: NOW }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: NOW,
        id: PROJECT_ID,
        name: "连接器验收项目",
        updatedAt: NOW,
      },
    }),
  );
  await page.route(`**/api/collections?projectId=${PROJECT_ID}`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(
    `**/api/projects/${PROJECT_ID}/agent-conversations*`,
    (route) =>
      route.fulfill({
        json: {
          items: [conversationFixture()],
          nextCursor: null,
        },
      }),
  );
  await page.route("**/api/agent-conversations/*/messages*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
}

function conversationFixture() {
  return {
    archivedAt: null,
    createdAt: NOW,
    id: "conversation-connector",
    projectId: PROJECT_ID,
    title: "连接器测试",
    updatedAt: NOW,
  };
}
