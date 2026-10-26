// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { AssetPicker } from "./studio-ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
const assets = Array.from({ length: 100 }, (_, index) => ({
  id: `asset-${index}`,
  url: `/image-${index}.png`,
  thumbnailUrl: null,
}));
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value() {
    this.setAttribute("open", "");
  },
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  },
});

it.each([0, 1, 30, 100])(
  "%i 张素材时正文最多显示四张，完整目录按需打开",
  (count) => {
    render(
      <AssetPicker
        assets={assets.slice(0, count)}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryAllByRole("button", { name: /^选择图片 \d+$/ }),
    ).toHaveLength(Math.min(count, 4));
    if (count) {
      fireEvent.click(screen.getByRole("button", { name: /浏览全部图片/ }));
      expect(
        within(screen.getByRole("dialog")).getAllByRole("button", {
          name: /^选择图片 \d+$/,
        }),
      ).toHaveLength(count);
    } else expect(screen.getByText(/还没有设计图片/)).toBeTruthy();
  },
);

it("选择暂存在弹窗中，取消不改草稿，单选可直接替换", () => {
  const change = vi.fn();
  render(
    <AssetPicker assets={assets} selected={["asset-0"]} onChange={change} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /更换或添加图片/ }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "选择图片 2",
    }),
  );
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /更换或添加图片/ }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "选择图片 2",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /确认选择/ }));
  expect(change).toHaveBeenCalledWith(["asset-1"]);
});
