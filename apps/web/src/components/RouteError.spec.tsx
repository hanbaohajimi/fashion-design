// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { RouteError } from "./RouteError";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("提供重新载入、返回项目库和错误编号", () => {
  const retry = vi.fn();
  const error = Object.assign(new Error("server detail"), { digest: "digest-123" });
  render(<RouteError error={error} retry={retry} />);

  expect(screen.getByRole("heading", { name: "页面暂时无法打开" })).toBeTruthy();
  expect(screen.getByText("错误编号：digest-123")).toBeTruthy();
  expect(screen.getByRole("link", { name: "返回项目库" })).toHaveProperty("href", "http://localhost:3000/");
  fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(captureException).toHaveBeenCalledWith(error);
});
