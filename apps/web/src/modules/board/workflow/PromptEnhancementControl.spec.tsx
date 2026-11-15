// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PromptEnhancementControl } from "./PromptEnhancementControl";
import { enhancePrompt } from "./prompt-enhancement-api";

vi.mock("../../../components/ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./prompt-enhancement-api", () => ({ enhancePrompt: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function deferred() {
  let resolve!: (value: { requestId: string; enhancedPrompt: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ requestId: string; enhancedPrompt: string }>(
    (yes, no) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve, reject };
}
function Harness({ scopeKey = "first" }: { scopeKey?: string }) {
  const [value, onChange] = useState("服装设计");
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <textarea
        aria-label="草稿"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div ref={setHost} />
      <PromptEnhancementControl
        scopeKey={scopeKey}
        projectId="project"
        value={value}
        referenceIds={["image-one"]}
        instances={{}}
        disabled={false}
        feedbackHost={host}
        onChange={onChange}
        onBusy={() => {}}
      />
    </>
  );
}
it("仅点击才增强并回填，撤销恢复原文", async () => {
  vi.mocked(enhancePrompt).mockResolvedValue({
    requestId: "request",
    enhancedPrompt: "请设计一件服装，先明确需求。",
  });
  render(<Harness />);
  expect(enhancePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "增强提示词" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
        .value,
    ).toBe("请设计一件服装，先明确需求。"),
  );
  fireEvent.click(screen.getByRole("button", { name: "撤销增强" }));
  expect(
    (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
      .value,
  ).toBe("服装设计");
  expect(enhancePrompt).toHaveBeenCalledTimes(1);
});
it("增强期间的新输入先保留，明确采用后撤销也恢复新输入", async () => {
  const result = deferred();
  vi.mocked(enhancePrompt).mockReturnValue(result.promise);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "增强提示词" }));
  fireEvent.change(screen.getByRole("textbox", { name: "草稿" }), {
    target: { value: "用户后来的修改" },
  });
  await act(async () =>
    result.resolve({ requestId: "request", enhancedPrompt: "增强后的要求" }),
  );
  expect(
    (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
      .value,
  ).toBe("用户后来的修改");
  fireEvent.click(screen.getByRole("button", { name: "使用增强结果" }));
  fireEvent.click(screen.getByRole("button", { name: "撤销增强" }));
  expect(
    (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
      .value,
  ).toBe("用户后来的修改");
});
it("切换会话取消旧请求，迟到结果不能改写新会话", async () => {
  const result = deferred();
  vi.mocked(enhancePrompt).mockReturnValue(result.promise);
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "增强提示词" }));
  await waitFor(() => expect(enhancePrompt).toHaveBeenCalledOnce());
  const signal = vi.mocked(enhancePrompt).mock.calls[0]?.[2];
  view.rerender(<Harness scopeKey="second" />);
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    result.resolve({ requestId: "request", enhancedPrompt: "旧结果" }),
  );
  expect(
    (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
      .value,
  ).toBe("服装设计");
});
it("失败和主动取消都保留原文", async () => {
  const result = deferred();
  vi.mocked(enhancePrompt).mockReturnValue(result.promise);
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "增强提示词" }));
  await act(async () => result.reject(new Error("连接失败")));
  expect(screen.getByRole("alert").textContent).toBe("连接失败");
  expect(
    (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
      .value,
  ).toBe("服装设计");
  const late = deferred();
  vi.mocked(enhancePrompt).mockReturnValue(late.promise);
  fireEvent.click(screen.getByRole("button", { name: "增强提示词" }));
  fireEvent.click(screen.getByRole("button", { name: "取消提示词增强" }));
  await act(async () =>
    late.resolve({ requestId: "request", enhancedPrompt: "取消的内容" }),
  );
  expect(
    (screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement)
      .value,
  ).toBe("服装设计");
});
