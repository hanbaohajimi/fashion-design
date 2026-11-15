// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StatusMark, type StatusMarkState } from "./StatusMark";

const activity = vi.hoisted(() => ({ visible: true, reduced: false }));
vi.mock("./motion/use-motion-activity", () => ({
  useMotionActivity: () => activity,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  activity.visible = true;
  activity.reduced = false;
});

it.each([
  ["pending", "等待处理"],
  ["running", "正在处理"],
  ["done", "已完成"],
  ["failed", "未完成"],
  ["cancelled", "已停止"],
  ["partial", "部分完成"],
  ["unconfirmed", "结果待确认"],
] as [StatusMarkState, string][])(
  "%s 提供准确状态名称，没有划线文本或伪造百分比",
  (status, name) => {
    const view = render(<StatusMark status={status} />);
    expect(screen.getByRole("img", { name })).toBeTruthy();
    expect(
      view.container
        .querySelector("[data-status-mark]")
        ?.getAttribute("data-status"),
    ).toBe(status);
    expect(view.container.textContent).toBe("");
    expect(view.container.querySelector("del,s,[data-strike]")).toBeNull();
  },
);

it("时间经过不能把处理中改成成功，组件只跟随真实状态更新", () => {
  vi.useFakeTimers();
  const view = render(<StatusMark status="running" />);
  act(() => vi.advanceTimersByTime(600_000));
  expect(screen.getByRole("img", { name: "正在处理" })).toBeTruthy();
  view.rerender(<StatusMark status="failed" />);
  expect(screen.getByRole("img", { name: "未完成" })).toBeTruthy();
  expect(view.container.querySelector('[data-status="done"]')).toBeNull();
});

it("离屏、后台或减弱动态只暂停表现，不改变实际状态", () => {
  const view = render(<StatusMark status="running" />);
  expect(view.container.firstElementChild?.getAttribute("data-motion")).toBe(
    "true",
  );
  activity.visible = false;
  view.rerender(<StatusMark status="running" />);
  expect(view.container.firstElementChild?.getAttribute("data-motion")).toBe(
    "false",
  );
  activity.visible = true;
  activity.reduced = true;
  view.rerender(<StatusMark status="done" />);
  expect(view.container.firstElementChild?.getAttribute("data-motion")).toBe(
    "false",
  );
  expect(screen.getByRole("img", { name: "已完成" })).toBeTruthy();
});

it("与已有结果标题配合时不重复播报，图标占位在状态间固定", () => {
  const view = render(<StatusMark status="pending" decorative size={16} />);
  const root = view.container.firstElementChild;
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(<StatusMark status="done" decorative size={16} />);
  expect(view.container.firstElementChild).toBe(root);
  expect(root?.getAttribute("aria-hidden")).toBe("true");
  expect(view.container.querySelector("svg")?.getAttribute("width")).toBe("16");
});
