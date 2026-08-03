import { test, expect } from "@playwright/test";

/**
 * 连接器功能端到端测试
 *
 * 测试场景：
 * 1. 创建两个图片元素
 * 2. 激活连接器工具
 * 3. 从第一个图片的锚点拖动到第二个图片的锚点
 * 4. 验证连接器创建成功
 * 5. 验证锚点在缩放和平移时不跳动
 */

test.describe("连接器功能", () => {
  test.beforeEach(async ({ page }) => {
    // 导航到测试项目
    await page.goto("http://localhost:3000/projects");

    // 等待项目列表加载
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

    // 点击第一个项目进入画布
    await page.click('[data-testid="project-card"]');

    // 等待画布加载完成
    await page.waitForSelector('.tl-canvas', { timeout: 10000 });
  });

  test("应该能够在连接器模式下创建图片之间的连接", async ({ page }) => {
    // 1. 创建第一个图片 (模拟上传)
    const image1X = 300;
    const image1Y = 300;

    // 通过点击上传按钮触发文件选择
    const uploadButton = page.locator('button[aria-label="上传图片"]');
    await uploadButton.click();

    // 等待文件上传完成并出现在画布上
    await page.waitForTimeout(2000);

    // 2. 创建第二个图片
    await uploadButton.click();
    await page.waitForTimeout(2000);

    // 3. 点击连接器工具按钮
    const connectorButton = page.locator('button[aria-label="连接器工具"]');
    await connectorButton.click();

    // 验证连接器工具已激活
    await expect(connectorButton).toHaveAttribute('aria-pressed', 'true');

    // 4. 等待锚点覆盖层渲染
    await page.waitForSelector('.anchorOverlay', { timeout: 5000 });

    // 5. 验证锚点可见
    const anchorPoints = page.locator('.anchorPoint');
    const anchorCount = await anchorPoints.count();
    expect(anchorCount).toBeGreaterThan(0);

    // 6. 获取第一个图片的右侧锚点
    const firstImageAnchors = anchorPoints.filter({ hasText: '', has: page.locator('[data-anchor-side="right"]') });
    const firstAnchor = firstImageAnchors.first();

    // 7. 获取第二个图片的左侧锚点
    const secondImageAnchors = anchorPoints.filter({ hasText: '', has: page.locator('[data-anchor-side="left"]') });
    const secondAnchor = secondImageAnchors.first();

    // 8. 从第一个锚点拖动到第二个锚点
    await firstAnchor.hover();
    await page.mouse.down();

    await secondAnchor.hover();
    await page.mouse.up();

    // 9. 验证连接器已创建
    await page.waitForTimeout(500);
    const connectorPath = page.locator('.connectorPath');
    await expect(connectorPath).toBeVisible();

    // 10. 验证工具仍然是连接器模式（不会自动切换）
    await expect(connectorButton).toHaveAttribute('aria-pressed', 'true');
  });

  test("锚点在画布缩放和平移时应该保持稳定", async ({ page }) => {
    // 1. 激活连接器工具
    const connectorButton = page.locator('button[aria-label="连接器工具"]');
    await connectorButton.click();

    // 2. 等待锚点渲染
    await page.waitForSelector('.anchorPoint', { timeout: 5000 });

    // 3. 获取第一个锚点的初始位置
    const firstAnchor = page.locator('.anchorPoint').first();
    const initialBox = await firstAnchor.boundingBox();

    expect(initialBox).not.toBeNull();
    const initialX = initialBox!.x;
    const initialY = initialBox!.y;

    // 4. 使用鼠标滚轮缩放画布 (Ctrl + Scroll)
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100); // 放大
    await page.keyboard.up('Control');

    await page.waitForTimeout(300);

    // 5. 验证锚点位置随缩放正确变化（不跳动）
    const zoomedBox = await firstAnchor.boundingBox();
    expect(zoomedBox).not.toBeNull();

    // 锚点应该相对于其父元素保持在相同位置
    // 实际像素位置会随缩放改变，但不应该跳到完全不相关的位置
    const deltaX = Math.abs(zoomedBox!.x - initialX);
    const deltaY = Math.abs(zoomedBox!.y - initialY);

    // 允许的位置变化范围（由于缩放导致）
    expect(deltaX).toBeLessThan(500); // 不应该跳得太远
    expect(deltaY).toBeLessThan(500);

    // 6. 平移画布 (按住空格 + 拖动)
    await page.keyboard.down(' ');
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(500, 500);
    await page.mouse.up();
    await page.keyboard.up(' ');

    await page.waitForTimeout(300);

    // 7. 验证锚点随画布平移
    const pannedBox = await firstAnchor.boundingBox();
    expect(pannedBox).not.toBeNull();

    // 锚点应该跟随画布移动
    expect(pannedBox!.x).not.toBe(zoomedBox!.x);
    expect(pannedBox!.y).not.toBe(zoomedBox!.y);
  });

  test("应该能够选中并删除连接器", async ({ page }) => {
    // 前提：先创建一个连接器（简化版本）
    const connectorButton = page.locator('button[aria-label="连接器工具"]');
    await connectorButton.click();

    await page.waitForSelector('.anchorPoint', { timeout: 5000 });

    // 创建连接（简化交互）
    const anchors = page.locator('.anchorPoint');
    if (await anchors.count() >= 2) {
      const first = anchors.nth(0);
      const second = anchors.nth(4); // 选择不同shape的锚点

      await first.hover();
      await page.mouse.down();
      await second.hover();
      await page.mouse.up();

      await page.waitForTimeout(500);
    }

    // 切换到选择工具
    const selectButton = page.locator('button[aria-label="选择工具"]');
    await selectButton.click();

    // 点击连接器选中它
    const connector = page.locator('.connectorPath').first();
    await connector.click();

    // 验证连接器被选中（线条会加粗）
    await expect(connector).toBeVisible();

    // 按Delete键删除
    await page.keyboard.press('Delete');

    // 验证连接器已被删除
    await page.waitForTimeout(500);
    const connectorCount = await page.locator('.connectorPath').count();
    expect(connectorCount).toBe(0);
  });

  test("按Esc键应该退出连接器模式", async ({ page }) => {
    // 激活连接器工具
    const connectorButton = page.locator('button[aria-label="连接器工具"]');
    await connectorButton.click();

    // 验证已激活
    await expect(connectorButton).toHaveAttribute('aria-pressed', 'true');

    // 按Esc键
    await page.keyboard.press('Escape');

    // 验证已退出连接器模式
    await page.waitForTimeout(300);
    await expect(connectorButton).toHaveAttribute('aria-pressed', 'false');

    // 应该自动切换到选择工具
    const selectButton = page.locator('button[aria-label="选择工具"]');
    await expect(selectButton).toHaveAttribute('aria-pressed', 'true');
  });
});
