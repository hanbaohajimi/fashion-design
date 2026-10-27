// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ObjectSwitcher } from "./workspace-ui";
import { Button } from "./ui";

afterEach(cleanup);

it("searches object names and revisions without switching or discarding the current object", () => {
  const change = vi.fn();
  render(
    <ObjectSwitcher label="切换对象" current="当前夹克">
      <aside>
        {Array.from({ length: 12 }, (_, index) => (
          <Button key={index} onClick={() => change(index)}>
            <strong>夹克 {index + 1}</strong>
            <small>修订 r{index + 1}</small>
          </Button>
        ))}
      </aside>
    </ObjectSwitcher>,
  );
  fireEvent.click(screen.getByText("切换对象"));
  const search = screen.getByRole("textbox", { name: "搜索切换对象" });
  fireEvent.change(search, { target: { value: "r12" } });
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByText("当前夹克")).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /夹克 12/ }));
  expect(change).toHaveBeenCalledExactlyOnceWith(11);
  fireEvent.change(search, { target: { value: "不存在" } });
  expect(screen.getByRole("status").textContent).toContain("已加载对象");
});
