// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThoughtLine } from "./ThoughtLine";
vi.mock("./motion/use-motion-activity", () => ({
  useMotionActivity: () => ({ visible: true, reduced: false }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const props = {
  startedAt: "2026-11-14T12:00:00Z",
  updatedAt: "2026-11-14T12:00:03Z",
  label: "正在分析设计需求",
};
it("只记录实际阶段，结束折叠并保留可回看的过程与固定耗时", () => {
  const view = render(<ThoughtLine {...props} status="pending" />);
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  view.rerender(
    <ThoughtLine {...props} label="正在补读资料" status="pending" />,
  );
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  view.rerender(<ThoughtLine {...props} status="completed" />);
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect(screen.getByText("3.0秒")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
it("历史完成回执不补造过程，之后的新执行仍能显示", () => {
  const view = render(<ThoughtLine {...props} status="completed" />);
  expect(view.container.textContent).toBe("");
  view.rerender(<ThoughtLine {...props} status="pending" />);
  expect(screen.getByRole("button")).toBeTruthy();
});
it("停止不将最后阶段标成成功", () => {
  const view = render(<ThoughtLine {...props} status="pending" />);
  view.rerender(<ThoughtLine {...props} status="canceled" />);
  expect(screen.getByRole("status").textContent).toBe("已停止回复");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("listitem").getAttribute("data-done")).toBe("false");
});

it("阶段更新保留展开选择，同一阶段不重复记录，完成时冻结首次终态耗时", () => {
  const view = render(<ThoughtLine {...props} status="pending" />);
  fireEvent.click(screen.getByRole("button"), { detail: 1 });
  view.rerender(<ThoughtLine {...props} status="pending" />);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  view.rerender(
    <ThoughtLine {...props} label="正在校验回复" status="pending" />,
  );
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  view.rerender(<ThoughtLine {...props} status="completed" />);
  expect(screen.getByText("3.0秒")).toBeTruthy();
  view.rerender(
    <ThoughtLine
      {...props}
      updatedAt="2026-11-14T12:05:00Z"
      status="completed"
    />,
  );
  expect(screen.getByText("3.0秒")).toBeTruthy();
});

it("新请求重置步骤与计时，不能把上次失败后的等待计入处理时间", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T12:10:00Z"));
  const view = render(
    <ThoughtLine {...props} status="pending" attemptId="first" />,
  );
  view.rerender(<ThoughtLine {...props} status="failed" attemptId="first" />);
  view.rerender(
    <ThoughtLine
      {...props}
      status="pending"
      attemptId="retry"
      updatedAt="2026-11-14T12:10:00Z"
    />,
  );
  expect(screen.getByText("0.0秒")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1200));
  expect(screen.getByText("1.2秒")).toBeTruthy();
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(
    view.container
      .querySelector("[data-thought-line]")
      ?.getAttribute("data-toggle-motion"),
  ).toBe("false");
});

it("计时不会自行结束思考，失败只标记当前阶段失败", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(props.startedAt));
  const view = render(<ThoughtLine {...props} status="pending" />);
  act(() => vi.advanceTimersByTime(180_000));
  expect(
    view.container
      .querySelector("[data-thought-line]")
      ?.getAttribute("data-working"),
  ).toBe("true");
  view.rerender(<ThoughtLine {...props} status="failed" />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("listitem").getAttribute("data-done")).toBe("false");
  expect(
    view.container.querySelector('[data-status-mark][data-status="failed"]'),
  ).toBeTruthy();
});
