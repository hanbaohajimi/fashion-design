// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantStarters } from "./AssistantStarters";

afterEach(cleanup);

describe("AssistantStarters", () => {
  it("已有候选方案时提供设计审阅入口，并交给审阅动作处理", () => {
    const onChoose = vi.fn();
    const onReview = vi.fn();
    render(
      <AssistantStarters
        disabled={false}
        hasDraft={false}
        hasReferences={false}
        hasCandidates
        onChoose={onChoose}
        onReview={onReview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /审阅当前方案/ }));

    expect(onReview).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("没有候选方案时不展示审阅入口", () => {
    render(
      <AssistantStarters
        disabled={false}
        hasDraft={false}
        hasReferences={false}
        hasCandidates={false}
        onChoose={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /审阅当前方案/ })).toBeNull();
  });
});
