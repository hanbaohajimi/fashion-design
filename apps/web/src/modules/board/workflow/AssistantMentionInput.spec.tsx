// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantMentionInput } from "./AssistantMentionInput";

const nodes = [
  { id: "a", title: "候选 A", kind: "asset" },
  { id: "b", title: "候选 B", kind: "asset" },
  { id: "c", title: "棉麻(蓝)", kind: "asset" },
];
beforeEach(() => vi.stubGlobal("CSS", { supports: () => true }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup({
  maxLength = 2000,
  allow = true,
  initial = "",
  candidates = nodes,
}: {
  maxLength?: number;
  allow?: boolean;
  initial?: string;
  candidates?: ComponentProps<typeof AssistantMentionInput>["nodes"];
} = {}) {
  const send = vi.fn();
  const add = vi.fn((id: string) => Boolean(id) && allow);
  function Harness() {
    const [value, setValue] = useState(initial);
    const [ids, setIds] = useState<string[]>([]);
    return (
      <AssistantMentionInput
        id="prompt"
        aria-label="需求"
        value={value}
        contextKey="one"
        nodes={candidates}
        referencedIds={ids}
        onValueChange={setValue}
        maxLength={maxLength}
        onAddReference={(id) => {
          if (!add(id)) return false;
          setIds((current) => [...current, id]);
          return true;
        }}
        onSend={send}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  act(() => input.focus());
  const fill = (value: string, caret = value.length) => {
    fireEvent.change(input, {
      target: { value, selectionStart: caret, selectionEnd: caret },
    });
    fireEvent.select(input, {
      target: { selectionStart: caret, selectionEnd: caret },
    });
  };
  return { input, fill, send, add };
}

it("chooses with arrows and Enter at the caret without sending or losing surrounding text", () => {
  const { input, fill, send, add } = setup();
  fill("请参考@候，保留衣领。", "请参考@候".length);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const chosen = screen.getByRole("option", { name: "候选 B" });
  expect(chosen.getAttribute("aria-selected")).toBe("true");
  expect(input.getAttribute("aria-activedescendant")).toBe(chosen.id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("请参考@候选 B，保留衣领。");
  expect(input.selectionStart).toBe("请参考@候选 B".length);
  expect(document.activeElement).toBe(input);
  expect(add).toHaveBeenCalledWith("b");
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("Tab accepts a choice, Escape only dismisses suggestions, and empty matches cannot send by mistake", () => {
  const { input, fill, send, add } = setup();
  fill("@棉");
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input.value).toBe("@棉麻(蓝) ");
  expect(add).toHaveBeenCalledWith("c");
  fill("@未知");
  expect(screen.getByText(/没有匹配/)).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(input.value).toBe("@未知");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(send).toHaveBeenCalledOnce();
});

it("lets IME candidate confirmation finish before reference selection or sending", () => {
  const { input, fill, send, add } = setup();
  fill("@");
  fireEvent.compositionStart(input);
  fill("@候");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(add).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(add).toHaveBeenCalledWith("a");
  expect(send).not.toHaveBeenCalled();
});

it("keeps the draft when the reference limit rejects a choice or insertion exceeds max length", () => {
  const { input, fill, send, add } = setup({ allow: false });
  fill("@候");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(add).toHaveBeenCalledOnce();
  expect(input.value).toBe("@候");
  expect(send).not.toHaveBeenCalled();
  cleanup();
  const limited = setup({ maxLength: 4 });
  limited.fill("@候");
  fireEvent.keyDown(limited.input, { key: "Enter" });
  expect(limited.input.value).toBe("@候");
  expect(screen.getByRole("alert").textContent).toContain("超出输入长度");
  expect(limited.add).not.toHaveBeenCalled();
});

it("preserves explicit identity when titles are duplicated and pointer focus moves into the list", () => {
  const { input, fill, send, add } = setup({
    candidates: [...nodes, { id: "d", title: "候选 A", kind: "asset" }],
  });
  fill("@候选 A");
  const choice = screen.getByRole("option", { name: "候选 A（2）" });
  fireEvent.blur(input, { relatedTarget: choice });
  fireEvent.click(choice);
  expect(add).toHaveBeenCalledWith("d");
  expect(input.value).toBe("@候选 A ");
  expect(send).not.toHaveBeenCalled();
});

it("renders image thumbnails and clean names without node IDs, type metadata or background tools", () => {
  const { fill } = setup({
    candidates: [
      {
        id: "image-resource-103938",
        title: "4be5c6b871ac012345678901234567890.png",
        kind: "asset",
        type: "candidate",
        payload: {
          imageUrl: "/coat.png",
          model: "内部模型参数",
          quality: "high",
        },
      },
      {
        id: "tool-resource-293824",
        title: "后台执行参数",
        kind: "tool",
        type: "generate_design",
        payload: {},
      },
      {
        id: "draft-resource-182938",
        title: "未确认输出",
        kind: "asset",
        type: "candidate",
        status: "proposed",
      },
    ],
  });
  fill("@");
  const option = screen.getByRole("option", { name: "设计方案" });
  expect(option.querySelector("img")?.getAttribute("src")).toBe("/coat.png");
  expect(option.textContent).toBe("设计方案");
  expect(option.getAttribute("title")).toBe("设计方案");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.queryByText("后台执行参数")).toBeNull();
  expect(screen.queryByText("内部模型参数")).toBeNull();
});

it("searches the readable image label and retains the actual reference identity", () => {
  const { fill, add, input } = setup({
    candidates: [
      {
        id: "original-image",
        title: "4be5c6b871ac012345678901234567890.png",
        kind: "asset",
        type: "reference_image",
        payload: { imageUrl: "/reference.png" },
      },
    ],
  });
  fill("@参考图");
  fireEvent.click(screen.getByRole("option", { name: "参考图片" }));
  expect(add).toHaveBeenCalledWith("original-image");
  expect(input.value).toBe("@4be5c6b871ac012345678901234567890.png ");
});

it("falls back to the image icon after a thumbnail fails and still permits choosing the object", () => {
  const { fill, add } = setup({
    candidates: [
      {
        id: "missing-image",
        title: "长外套",
        kind: "asset",
        type: "candidate",
        payload: { imageUrl: "/missing.png" },
      },
    ],
  });
  fill("@");
  const option = screen.getByRole("option", { name: "长外套" });
  const thumbnail = option.querySelector("img");
  if (!thumbnail) throw new Error("缩略图未渲染");
  fireEvent.error(thumbnail);
  expect(option.querySelector("img")).toBeNull();
  expect(option.querySelector("svg")).toBeTruthy();
  fireEvent.click(option);
  expect(add).toHaveBeenCalledWith("missing-image");
});
