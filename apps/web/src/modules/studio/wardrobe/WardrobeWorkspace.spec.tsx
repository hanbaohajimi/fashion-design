// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect, useState, type ReactNode } from "react";
import type { WardrobeSummary } from "@fashion/shared";
import { WardrobeWorkspace } from "./WardrobeWorkspace";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
const data: WardrobeSummary = { projectId: "project", canEdit: true, items: [], outfits: [], preparations: [], tryOns: [], capabilities: { enabled: true, preparationEnabled: true, staticTryOnEnabled: true, realtimeOutfitEnabled: true, realtimeMultiItemVerified: true, realtimeCategories: ["top"] } };
vi.mock("./use-wardrobe-data", () => ({ useWardrobeData: () => ({ data, loading: false, error: null, refresh: vi.fn(async () => {}) }) }));
vi.mock("../../../components/WorkspaceSplit", () => ({ WorkspaceSplit: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./WardrobeRack", () => ({ WardrobeRack: () => <section aria-label="模拟衣架">衣架内容</section> }));
vi.mock("./OutfitEditor", () => ({ OutfitEditor: () => <section aria-label="模拟搭配">搭配内容</section> }));
vi.mock("./WardrobeTryOn", () => ({ WardrobeTryOn: function SessionProbe({ onDirty }: { onDirty: (value: boolean) => void }) {
  const [value, setValue] = useState("本人实时试衣");
  useEffect(() => { lifecycle.mount(); return () => { lifecycle.unmount(); }; }, []);
  return <section aria-label="模拟试穿"><input aria-label="会话标记" value={value} onChange={event => setValue(event.target.value)} /><button onClick={() => onDirty(true)}>模拟未保存截图</button></section>;
} }));
beforeEach(() => {
  lifecycle.mount.mockReset(); lifecycle.unmount.mockReset();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("max-width: 767px") || query.includes("prefers-reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the same self-try-on component while mobile users browse and edit garments", () => {
  render(<WardrobeWorkspace projectId="project" assets={[]} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "试穿" }));
  fireEvent.change(screen.getByRole("textbox", { name: "会话标记" }), { target: { value: "会话仍在运行" } });
  fireEvent.click(screen.getByRole("button", { name: "模拟未保存截图" }));
  fireEvent.click(screen.getByRole("button", { name: "衣架" }));
  expect(screen.getByRole("region", { name: "模拟衣架" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "搭配" }));
  expect(screen.getByRole("region", { name: "模拟搭配" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "试穿" }));
  expect((screen.getByRole("textbox", { name: "会话标记" }) as HTMLInputElement).value).toBe("会话仍在运行");
  expect(lifecycle.mount).toHaveBeenCalledTimes(1); expect(lifecycle.unmount).not.toHaveBeenCalled();
});

it("returns to a visible rack when collapsing the mobile outfit panel", () => {
  render(<WardrobeWorkspace projectId="project" assets={[]} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "搭配" }));
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.getByRole("region", { name: "模拟衣架" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "衣架" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("region", { name: "模拟搭配" })).toBeNull();
});
