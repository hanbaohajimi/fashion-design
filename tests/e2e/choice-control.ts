import { expect, type Locator, type Page } from "@playwright/test";
import { STUDIO_GROUPS } from "../../apps/web/src/modules/studio/studio-navigation";

export function valueControl(
  scope: Page | Locator,
  name: string | RegExp,
): Locator {
  return scope
    .getByRole("radiogroup", { name, exact: true })
    .or(scope.getByRole("button", { name, exact: true }))
    .or(
      scope
        .getByRole("group", { name, exact: true })
        .and(scope.locator("[data-asset-select]")),
    )
    .or(scope.getByRole("combobox", { name, exact: true }));
}

export async function chooseValue(
  control: Locator,
  value: string | readonly string[],
) {
  control = control.and(
    control
      .page()
      .locator(
        '[data-asset-select],[role="radiogroup"],button[aria-haspopup="listbox"],summary,input,select:not([aria-hidden])',
      ),
  );
  const selected = typeof value === "string" ? value : value[0];
  if (selected === undefined) throw new Error("请选择一个值");
  const tag = await control.evaluate((element) => element.tagName);
  if (tag === "SELECT") {
    await control.selectOption(selected);
    return;
  }
  if (tag === "INPUT") {
    await control.fill(selected);
    await control.press("Enter");
    return;
  }
  if ((await control.getAttribute("data-asset-select")) !== null) {
    const index = await control
      .locator("select")
      .evaluate(
        (element, next) =>
          [...(element as HTMLSelectElement).options].findIndex(
            (option) => option.value === next,
          ),
        selected,
      );
    if (index < 1) throw new Error(`选择器中不存在图片 ${selected}`);
    await control
      .getByRole("button", { name: /更换或添加图片|浏览全部图片/ })
      .click();
    const label = await control.getAttribute("aria-label");
    if (!label) throw new Error("图片选择器缺少名称");
    const dialog = control.page().getByRole("dialog", {
      name: label,
      exact: true,
    });
    await dialog
      .getByRole("button", { name: `选择图片 ${index}`, exact: true })
      .click();
    await dialog.getByRole("button", { name: /确认选择/ }).click();
    return;
  }
  if ((await control.getAttribute("aria-label")) === "当前功能") {
    const label = STUDIO_GROUPS.map(
      (group) => group.items.find((item) => item.value === selected)?.label,
    ).find(Boolean);
    if (!label) throw new Error(`未知功能 ${selected}`);
    await control.click();
    await control
      .page()
      .getByRole("group", { name: "当前功能选项", exact: true })
      .getByRole("button", { name: label, exact: true })
      .click();
    return;
  }
  const label = await control.evaluate((element, next) => {
    const proxy = element
      .closest("[data-choice-control]")
      ?.querySelector("select");
    return [...(proxy?.options ?? [])].find((option) => option.value === next)
      ?.textContent;
  }, selected);
  if (!label) throw new Error(`选择器中不存在 ${selected}`);
  if ((await control.getAttribute("role")) === "radiogroup")
    await control.getByRole("radio", { name: label, exact: true }).click();
  else {
    await control.click();
    await control
      .page()
      .getByRole("option", { name: label, exact: true })
      .click();
    // A mobile selector remains native-modal until its exit transition ends.
    await expect(control.page().locator('[role="listbox"]:visible')).toHaveCount(0);
  }
}

export async function expectValue(control: Locator, value: string) {
  const proxy = control
    .locator("xpath=ancestor-or-self::*[@data-choice-control][1]")
    .locator("select");
  await expect(proxy).toHaveValue(value);
}
