import { fireEvent, screen, within } from "@testing-library/react";

/** Select by its stored value, then exercise the visible radio/listbox control. */
export function chooseValue(name: string | RegExp, value: string) {
  const group = screen.queryByRole("radiogroup", { name });
  const imageGroup = screen.queryByRole("group", { name });
  if (imageGroup?.hasAttribute("data-asset-select")) {
    if (!HTMLDialogElement.prototype.showModal)
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
    if (!HTMLDialogElement.prototype.close)
      HTMLDialogElement.prototype.close = function () {
        this.open = false;
      };
    const proxy = imageGroup.querySelector("select");
    const index = [...(proxy?.options ?? [])].findIndex(
      (option) => option.value === value,
    );
    if (index < 1) throw new Error(`未找到图片 ${value}`);
    fireEvent.click(
      within(imageGroup).getByRole("button", {
        name: /更换或添加图片|浏览全部图片/,
      }),
    );
    const dialog = screen.getByRole("dialog", { name });
    fireEvent.click(
      within(dialog).getByRole("button", { name: `选择图片 ${index}` }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /确认选择/ }));
    return;
  }
  const control = group ?? screen.getByRole("button", { name });
  const proxy = control.parentElement?.querySelector("select");
  const label = [...(proxy?.options ?? [])].find(
    (option) => option.value === value,
  )?.textContent;
  if (!label) throw new Error(`未找到选项 ${value}`);
  if (group) fireEvent.click(within(group).getByRole("radio", { name: label }));
  else {
    fireEvent.click(control);
    fireEvent.click(screen.getByRole("option", { name: label }));
  }
}
