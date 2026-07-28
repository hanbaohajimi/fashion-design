import {
  act,
  create,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentryMock.captureException,
  withScope: (
    callback: (scope: { setTag: typeof sentryMock.setTag }) => unknown,
  ) => callback({ setTag: sentryMock.setTag }),
}));

import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("隐藏技术错误，自动上报并允许重试核心区域", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let shouldThrow = true;
    let renderer: ReactTestRenderer | null = null;

    function CorePath() {
      if (shouldThrow) throw new Error("technical prompt secret");
      return <div>核心区域已恢复</div>;
    }

    await act(() => {
      renderer = create(
        <ErrorBoundary area="generation">
          <CorePath />
        </ErrorBoundary>,
      );
    });

    const mounted = renderer as ReactTestRenderer | null;
    if (!mounted) throw new Error("ErrorBoundary test renderer 未挂载");
    const fallback = JSON.stringify(mounted.toJSON());
    expect(fallback).toContain("出现了一点问题，已自动上报");
    expect(fallback).toContain("重试");
    expect(fallback).not.toContain("technical prompt secret");
    expect(sentryMock.captureException).toHaveBeenCalledOnce();

    shouldThrow = false;
    await act(() => {
      mounted.root.findByType("button").props.onClick();
    });
    expect(JSON.stringify(mounted.toJSON())).toContain("核心区域已恢复");

    consoleError.mockRestore();
  });
});
