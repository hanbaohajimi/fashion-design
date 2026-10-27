// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCard } from "./ProjectCard";
import type { Project } from "./project-types";

afterEach(cleanup);
const project: Project = {
  id: "rename-test",
  name: "原有设计项目",
  archived: false,
  assetCount: 0,
  coverAssetId: null,
  coverUrl: null,
  createdAt: "2026-10-25",
  updatedAt: "2026-10-25",
};
function setup(onRename = vi.fn(async () => {})) {
  render(
    <ProjectCard
      project={project}
      index={0}
      duplicating={false}
      onRename={onRename}
      onDelete={vi.fn()}
      onArchive={vi.fn()}
      onDuplicate={vi.fn()}
      onRestore={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText("原有设计项目 项目操作"));
  fireEvent.click(screen.getByRole("button", { name: "重命名" }));
  return screen.getByRole("textbox", { name: "项目名称" });
}
it("重复提交只发送一次，在途取消无效，完成后恢复菜单焦点", async () => {
  let resolve!: () => void;
  const rename = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const input = setup(rename);
  fireEvent.change(input, { target: { value: "更新后的设计项目" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(rename).toHaveBeenCalledTimes(1);
  expect(input.isConnected).toBe(true);
  await act(async () => resolve());
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "原有设计项目 项目操作",
  );
});
it("失败保留草稿和唯一错误，取消恢复原名称和焦点", async () => {
  const input = setup(
    vi.fn(async () => {
      throw new Error("网络连接失败，请重试");
    }),
  );
  fireEvent.change(input, { target: { value: "失败后保留的草稿" } });
  await act(async () =>
    fireEvent.submit(input.closest("form") as HTMLFormElement),
  );
  expect((input as HTMLInputElement).value).toBe("失败后保留的草稿");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(document.activeElement?.tagName).toBe("SUMMARY");
});
it("按服务端 UTF-16 长度拒绝超过 80 的 emoji 名称", () => {
  const rename = vi.fn(async () => {});
  const input = setup(rename);
  fireEvent.change(input, { target: { value: "衣" + "🧵".repeat(40) } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(rename).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("3–80");
});
