// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Menu, SegmentedControl, Tabs, TabPanel, Tooltip, ImagePreview } from "./ui";
afterEach(cleanup);

describe("shared controls", () => {
  it("recovers a failed preview through its original refresh action", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ImagePreview src="/private-look" alt="系列连衣裙" onRetry={refresh} />);
    fireEvent.error(screen.getByRole("img", { name: "系列连衣裙" }));
    expect(screen.getByText("图片暂时无法加载")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试预览" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("img", { name: "系列连衣裙" }).tagName).toBe("IMG"));
  });
  it("moves tab focus past disabled items without activating until Enter or click", () => {
    const change = vi.fn();
    render(<><Tabs id="work" label="工作区" value="preview" onChange={change} options={[{ value: "preview", label: "预览" }, { value: "busy", label: "忙碌", disabled: true }, { value: "history", label: "历史" }]} /><TabPanel tabsId="work" value="preview" activeValue="preview">预览内容</TabPanel><TabPanel tabsId="work" value="history" activeValue="preview">历史内容</TabPanel></>);
    const preview = screen.getByRole("tab", { name: "预览" });
    preview.focus();
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    const history = screen.getByRole("tab", { name: "历史" });
    expect(document.activeElement).toBe(history);
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(history);
    expect(change).toHaveBeenCalledWith("history");
    fireEvent.keyDown(history, { key: "Home" });
    expect(document.activeElement).toBe(preview);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(preview.id);
  });
  it("describes a focused control and dismisses its tooltip without moving focus", () => {
    render(<Tooltip content="画布操作说明"><button>帮助</button></Tooltip>);
    const button = screen.getByRole("button", { name: "帮助" });
    button.focus();
    fireEvent.focus(button);
    const tooltip = screen.getByRole("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
  it("prevents a loading button from submitting twice", () => {
    const click = vi.fn();
    render(
      <Button loading onClick={click}>
        保存
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  });
  it("moves through a menu and restores focus on Escape", () => {
    render(
      <Menu label="项目操作">
        <button>重命名</button>
        <button>归档</button>
      </Menu>,
    );
    const trigger = screen.getByText("项目操作");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("重命名"));
    fireEvent.keyDown(screen.getByText("重命名"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("归档"));
    fireEvent.keyDown(screen.getByText("归档"), { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.closest("details")?.open).toBe(false);
  });
  it("keeps a portaled menu outside clipping containers and supports keyboard dismissal", async () => {
    const { container } = render(
      <div style={{ overflow: "auto", height: 40 }}>
        <Menu label="对话操作" placement="top" portal>
          <button>旧设计运行</button>
          <button>暂停助手</button>
        </Menu>
      </div>,
    );
    const trigger = screen.getByText("对话操作");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const history = await screen.findByRole("button", { name: "旧设计运行" });
    expect(trigger.getAttribute("aria-controls")).toBe(screen.getByRole("group", { name: "对话操作选项" }).id);
    expect(container.contains(history)).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(history));
    fireEvent.keyDown(history, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "暂停助手" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "暂停助手" }), { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("button", { name: "旧设计运行" })).toBeNull();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await screen.findByRole("button", { name: "旧设计运行" });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "旧设计运行" })).toBeNull();
  });
  it("uses arrow keys to choose the next segment", () => {
    const change = vi.fn();
    render(
      <SegmentedControl
        label="工作视图"
        value="canvas"
        onChange={change}
        options={[
          { value: "canvas", label: "画布" },
          { value: "assistant", label: "助手" },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "画布" }), {
      key: "ArrowRight",
    });
    expect(change).toHaveBeenCalledWith("assistant");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "助手" }),
    );
  });
});
