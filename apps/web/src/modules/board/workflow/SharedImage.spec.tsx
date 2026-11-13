// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedImage } from "./SharedImage";

vi.mock("../../../components/ui", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} type="button">{children}</button>
  ),
  ImagePreview: ({ alt, src }: { alt: string; src: string }) => {
    // The mock intentionally keeps the test independent of Next's image loader.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} src={src} />;
  },
  Skeleton: ({ label }: { label: string }) => <span>{label}</span>,
}));

describe("SharedImage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ imageUrl: "/api/image-shares/token/content", width: 1024, height: 1536 }),
      ok: true,
    }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows delivery metadata and lets a viewer copy the read-only link", async () => {
    render(<SharedImage token={"a".repeat(43)} />);

    expect(await screen.findByText("只读预览 · 1024 × 1536")).toBeTruthy();
    expect(screen.getByRole("link", { name: "下载图片" }).getAttribute("href")).toBe(
      "/api/image-shares/token/content",
    );

    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已复制链接" })).toBeTruthy());
  });
});

