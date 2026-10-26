import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export const REVIEW_VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
];

export async function tabTo(page: Page, target: Locator, limit = 120) {
  for (let index = 0; index < limit; index++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/** WCAG relative luminance, compositing the actual foreground and ancestor backgrounds. */
export async function contrastFailures(page: Page, includeOffscreen = false, scope?: string) {
  return page.evaluate(
    ({ includeOffscreen, scope }) => {
      const rgba = (color: string) => {
        const numbers = color.match(/[\d.]+/g)?.map(Number) ?? [];
        return [
          numbers[0] ?? 0,
          numbers[1] ?? 0,
          numbers[2] ?? 0,
          numbers[3] ?? 1,
        ];
      };
      const blend = (front: number[], back: number[]) =>
        front
          .slice(0, 3)
          .map(
            (channel, index) =>
              channel * (front[3] ?? 1) +
              (back[index] ?? 255) * (1 - (front[3] ?? 1)),
          );
      const luminance = (color: number[]) =>
        color
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, value, index) =>
              sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0),
            0,
          );
      const failures: Array<{
        text: string;
        ratio: number;
        required: number;
        color: string;
        background: number[];
        selector: string;
      }> = [];
      const walker = document.createTreeWalker(
        (scope ? document.querySelector(scope) : null) ??
        Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
          .filter((element) => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))
          .at(-1) ??
          document.querySelector("main") ??
          document.body,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        const element = walker.currentNode.parentElement;
        if (
          !text ||
          !element ||
          element.closest(
            'button:disabled,input:disabled,textarea:disabled,[aria-disabled="true"],script,style,[data-testid="license-status"],.tl-watermark_SEE-LICENSE',
          )
        )
          continue;
        const rect = element.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          (!includeOffscreen &&
            (rect.right < 0 ||
              rect.bottom < 0 ||
              rect.left > innerWidth ||
              rect.top > innerHeight)) ||
          !element.checkVisibility({
            checkVisibilityCSS: true,
            checkOpacity: true,
          })
        )
          continue;
        const chain = [];
        let parent: Element | null = element;
        let opacity = 1;
        while (parent) {
          chain.unshift(parent);
          opacity *= Number(getComputedStyle(parent).opacity);
          parent = parent.parentElement;
        }
        let background = [255, 255, 255];
        for (const ancestor of chain)
          background = blend(
            rgba(getComputedStyle(ancestor).backgroundColor),
            background,
          );
        const style = getComputedStyle(element);
        const foreground = rgba(style.color);
        foreground[3] = (foreground[3] ?? 1) * opacity;
        const light = luminance(blend(foreground, background));
        const dark = luminance(background);
        const ratio =
          (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
        const large =
          Number.parseFloat(style.fontSize) >= 24 ||
          (Number.parseFloat(style.fontSize) >= 18.66 &&
            Number(style.fontWeight) >= 700);
        const required = large ? 3 : 4.5;
        if (ratio + 0.01 < required)
          failures.push({
            text: text.slice(0, 70),
            ratio: Math.round(ratio * 100) / 100,
            required,
            color: style.color,
            background,
            selector: `${element.tagName}.${element.className}`,
          });
      }
      return failures;
    },
    { includeOffscreen, scope },
  );
}

export async function controlFontFailures(page: Page, scope = page.locator("main")) {
  return scope
    .locator(
      'button,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,select,summary,nav a',
    )
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.checkVisibility({
              checkVisibilityCSS: true,
              checkOpacity: true,
            }) &&
            !element.closest('[class*="watermark"]') &&
            (element.textContent?.trim() ||
              element.matches("input,textarea,select")),
        )
        .filter(
          (element) =>
            Number.parseFloat(getComputedStyle(element).fontSize) < 14,
        )
        .map((element) => ({
          text: element.textContent?.trim().slice(0, 60),
          size: getComputedStyle(element).fontSize,
          class: element.className,
        })),
    );
}
