/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(cleanup);

describe("ErrorBoundary", () => {
  it("隐藏技术错误，自动上报并允许重试核心区域", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let shouldThrow = true;

    function CorePath() {
      if (shouldThrow) throw new Error("technical prompt secret");
      return <div>核心区域已恢复</div>;
    }

    render(
      <ErrorBoundary area="generation">
        <CorePath />
      </ErrorBoundary>,
    );

    expect(screen.getByText("出现了一点问题，已自动上报")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("technical prompt secret");
    expect(sentryMock.captureException).toHaveBeenCalledOnce();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("核心区域已恢复")).toBeTruthy();

    consoleError.mockRestore();
  });
});
