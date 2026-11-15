// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandPalette } from "./command-palette";

vi.mock("./ui", () => ({ Dialog: ({ children }: { children: ReactNode }) => children }));
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

it("受控关闭再打开时重置搜索和高亮项", () => {
  const first = vi.fn(), second = vi.fn();
  const commands = [{ id: "first", label: "图片创作", onSelect: first }, { id: "second", label: "系列工作台", onSelect: second }];
  const view = render(<CommandPalette commands={commands} open />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "系列" } });
  expect(screen.getByRole("option").textContent).toContain("系列工作台");
  view.rerender(<CommandPalette commands={commands} open={false} />);
  view.rerender(<CommandPalette commands={commands} open />);
  expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
});

it("列表收缩后键盘仍执行当前可见命令", () => {
  const first = vi.fn(), second = vi.fn();
  const commands = [{ id: "first", label: "图片", onSelect: first }, { id: "second", label: "系列", onSelect: second }];
  const view = render(<CommandPalette commands={commands} open />);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  view.rerender(<CommandPalette commands={commands.slice(0, 1)} open />);
  expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBe("cmd-first");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
});

it("空搜索结果和禁用命令不会被Enter执行", () => {
  const select = vi.fn();
  render(<CommandPalette commands={[{ id: "locked", label: "锁定命令", disabled: true, onSelect: select }]} open />);
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "不存在" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  expect(select).not.toHaveBeenCalled();
});
