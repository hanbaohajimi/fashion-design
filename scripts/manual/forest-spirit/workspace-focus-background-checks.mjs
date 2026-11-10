/* global window, document */

/** Supplement only: run after model validation, using one headed browser. */
export async function runFocusBackgroundChecks({ page, context, check, snapshot, report, expectedDrawableIds }) {
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const hit = page.locator("[data-real-spirit-wip-mount] [data-forest-spirit-hit]");
  const input = page.getByRole("textbox", { name: "描述设计需求", includeHidden: true });
  const point = () => hit.evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, outsideX: rect.x + 2, outsideY: rect.y + 2 }; });
  const state = () => page.evaluate(() => window.forestSpiritWip.snapshot());
  const closeChat = async () => {
    const button = page.getByRole("button", { name: "收起设计助手", exact: true });
    report.observations.push({ name: "real collapse button hit-test before click", evidence: await button.evaluate(node => {
      const rect = node.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const describe = el => ({ tag: el.tagName, id: el.id, role: el.getAttribute("role"), label: el.getAttribute("aria-label"), className: el.className, rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })() });
      return { button: describe(node), center: { x, y }, stack: document.elementsFromPoint(x, y).slice(0, 10).map(describe), dialogs: [...document.querySelectorAll('[role="dialog"],dialog')].map(describe), viewport: { width: innerWidth, height: innerHeight }, activeElement: document.activeElement?.tagName };
    }) });
    await button.click(); await hit.waitFor({ state: "visible" });
  };
  await snapshot(page, "focus-initial-before-input");
  await input.fill("真实生产展开回调补测：保留原会话草稿");
  await snapshot(page, "focus-initial-after-input");
  await closeChat();
  let before = await state();
  check("supplement binds the actual mounted production callback", before.bridgeMode === "production-callback" && before.productionBinding?.conversationId === "visual-chat" && before.productionBinding.focusRequest === 0, before.productionBinding);
  let p = await point(); await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.forestSpiritWip.snapshot().focusedComposer === true);
  let after = await snapshot(page, "production-callback-pointer-focus");
  check("actual production pointer callback increments focus and focuses the existing composer", after.productionBinding.focusRequest === before.productionBinding.focusRequest + 1 && after.focusedComposer && after.panelSame && after.characterHidden && after.raf === 0);
  check("production callback keeps the same unsent draft and conversation", await input.inputValue() === "真实生产展开回调补测：保留原会话草稿" && after.productionBinding.conversationId === before.productionBinding.conversationId);
  await closeChat(); before = await state(); await hit.focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.forestSpiritWip.snapshot().focusedComposer === true);
  after = await snapshot(page, "production-callback-keyboard-focus");
  check("keyboard invokes the same production focus request", after.productionBinding.focusRequest === before.productionBinding.focusRequest + 1 && after.focusedComposer && after.panelSame);
  await closeChat(); p = await point(); await page.mouse.move(p.outsideX, p.outsideY);
  before = await state(); await page.waitForFunction(count => window.forestSpiritWip.snapshot().drawCount > count, before.drawCount);
  const savedPosition = await hit.locator("..").evaluate(node => node.style.transform);
  const savedAnchor = (await state()).anchor;

  let otherPage, cdp, windowId, minimized = false;
  try {
    // Actual tab activation is attempted first. Never override document.hidden
    // and never dispatch a synthetic visibility event to manufacture a pass.
    otherPage = await context.newPage(); await otherPage.goto("about:blank"); await otherPage.bringToFront();
    try { await page.waitForFunction(() => document.hidden, undefined, { timeout: 2500, polling: 50 }); }
    catch {
      cdp = await context.newCDPSession(page);
      const actual = await cdp.send("Browser.getWindowForTarget"); windowId = actual.windowId;
      report.observations.push({ name: "native background trigger", method: "CDP Browser.setWindowBounds on this owned headed browser window", windowId, priorBounds: actual.bounds });
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } }); minimized = true;
      await page.waitForFunction(() => document.hidden, undefined, { timeout: 5000, polling: 50 });
    }
    await page.waitForFunction(() => { const s = window.forestSpiritWip.snapshot(); return s.documentHidden && s.characterHidden && s.paused && s.raf === 0; }, undefined, { timeout: 5000, polling: 50 });
    const hidden = await state(), events = await page.evaluate(() => window.forestSpiritWip.events);
    check("actual browser visibility event is trusted and hidden", hidden.documentHidden && events.some(event => event.event === "native-visibility" && event.trusted === true && event.hidden === true));
    check("actual background visibility pauses renderer and removes pointer target", hidden.characterHidden && hidden.paused && hidden.raf === 0 && hidden.panelSame);
    await delay(350); const stillHidden = await state();
    check("hidden instance completes no new draws", stillHidden.documentHidden && stillHidden.drawCount === hidden.drawCount, { before: hidden.drawCount, after: stillHidden.drawCount });
    report.observations.push({ name: "actual hidden state", state: stillHidden, trustedVisibilityEvents: events.filter(event => event.event === "native-visibility") });
    if (minimized) { await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); minimized = false; }
    await otherPage.close(); otherPage = undefined; await page.bringToFront();
    await page.waitForFunction(count => { const s = window.forestSpiritWip.snapshot(); return !s.documentHidden && !s.characterHidden && !s.paused && s.drawCount > count; }, hidden.drawCount, { timeout: 5000, polling: 50 });
    after = await snapshot(page, "actual-background-resumed");
    check("returning foreground resumes the same renderer and normalized position", after.panelSame && after.drawableCount === expectedDrawableIds.length && JSON.stringify(after.drawableIds) === JSON.stringify(expectedDrawableIds) && after.anchor === savedAnchor && await hit.locator("..").evaluate(node => node.style.transform) === savedPosition);
    check("background restoration does not invoke chat or change its focus counter", after.productionBinding.focusRequest === before.productionBinding.focusRequest && after.panelHidden);
    check("resumed foreground produces trusted visibility event", await page.evaluate(() => window.forestSpiritWip.events.some(event => event.event === "native-visibility" && event.trusted === true && event.hidden === false)));
  } finally {
    // Each resource cleans up independently; outer driver also closes its own
    // context/browser if the visibility assertion fails.
    if (minimized && cdp) try { await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); } catch (error) { report.cleanupErrors.push(`restore owned window: ${error}`); }
    try { await otherPage?.close(); } catch (error) { report.cleanupErrors.push(`supplement tab: ${error}`); }
    try { await cdp?.detach(); } catch (error) { report.cleanupErrors.push(`supplement CDP: ${error}`); }
  }
}
