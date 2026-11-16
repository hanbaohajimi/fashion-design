import { expect, test } from "@playwright/test";
import { loadZhiya, prepareZhiya } from "./zhiya-fixture";

test("外部SDK CDN不可用时，画布仍从同源加载字体和完整中文翻译", async ({ page }) => {
  const state = await prepareZhiya(page, { count: 1, realClock: true });
  const external: string[] = [], fonts: string[] = [], loadedFonts: string[] = [];
  await page.route("https://cdn.tldraw.com/**", route => {
    external.push(route.request().url());
    return route.abort();
  });
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".woff2")) fonts.push(request.url());
  });
  page.on("response", response => {
    if (new URL(response.url()).pathname.endsWith(".woff2") && response.ok() && response.headers()["content-type"]?.includes("font")) loadedFonts.push(response.url());
  });
  const translation = page.waitForResponse(response => new URL(response.url()).pathname === "/tldraw-translations/zh-cn" && response.ok());
  await loadZhiya(page);
  await expect(page.getByRole("group", { name: "通勤外套 1", exact: true })).toBeVisible();
  const messages = await (await translation).json();
  expect(messages["action.copy-hovered-styles"]).toBe("复制悬停样式");
  expect(Object.keys(messages).length).toBeGreaterThan(100);
  await expect.poll(() => loadedFonts.filter(url => /Shantell|IBMPlex/u.test(url)).length).toBeGreaterThan(0);
  expect(fonts.every(url => new URL(url).origin === "http://127.0.0.1:3000")).toBe(true);
  expect(external).toEqual([]);
  expect(state.errors).toEqual([]);
});
