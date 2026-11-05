// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import type { WardrobeSummary } from "@fashion/shared";
import { WardrobeTryOn } from "./WardrobeTryOn";
import { emptyOutfit } from "./wardrobe-state";

const lifecycle = vi.hoisted(() => ({ leave: vi.fn() }));
vi.mock("./use-realtime-outfit", () => ({ useRealtimeOutfit: () => ({ snapshot: null, updating: false, error: null, retry: vi.fn() }) }));
vi.mock("../studio-ui", () => ({ AssetPicker: ({ label }: { label: string }) => <div>{label}</div> }));
vi.mock("../../../components/ui", async original => ({ ...await original<typeof import("../../../components/ui")>(), Dialog: ({ children, label }: { children: ReactNode; label: string }) => <div role="dialog" aria-label={label}>{children}</div> }));
vi.mock("../realtime-tryon/RealtimeTryOnPanel", () => ({ RealtimeTryOnPanel: ({ onDirty }: { onDirty: (dirty: boolean) => void }) => {
  useEffect(() => () => { lifecycle.leave(); onDirty(false); }, [onDirty]);
  return <div><p>本人试穿会话</p><button onClick={() => onDirty(true)}>模拟截图保存失败</button><button onClick={() => onDirty(false)}>模拟截图保存成功</button></div>;
} }));
const data: WardrobeSummary = { projectId: "project", canEdit: true, items: [], outfits: [], preparations: [], tryOns: [], capabilities: { enabled: true, preparationEnabled: true, staticTryOnEnabled: true, realtimeOutfitEnabled: true, realtimeMultiItemVerified: true, realtimeCategories: ["top"] } };
beforeEach(() => lifecycle.leave.mockReset());
afterEach(cleanup);
const fixture = () => render(<WardrobeTryOn projectId="project" assets={[]} data={data} snapshot={null} draft={emptyOutfit()} revisions={new Map()} dirty={false} canEdit onChanged={async () => {}} onDirty={vi.fn()} />);

it("keeps the self session and pending capture when a mode switch is canceled", () => {
  fixture();
  fireEvent.click(screen.getByRole("button", { name: "本人实时试衣" }));
  fireEvent.click(screen.getByRole("button", { name: "模拟截图保存失败" }));
  fireEvent.click(screen.getByRole("button", { name: "在模特上试衣" }));
  expect(screen.getByRole("dialog", { name: "切换试衣对象前处理截图" })).toBeTruthy();
  expect(lifecycle.leave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "返回保存截图" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("本人试穿会话")).toBeTruthy(); expect(lifecycle.leave).not.toHaveBeenCalled();
});

it("only discards the pending capture and ends self mode after the explicit discard action", () => {
  fixture();
  fireEvent.click(screen.getByRole("button", { name: "本人实时试衣" }));
  fireEvent.click(screen.getByRole("button", { name: "模拟截图保存失败" }));
  fireEvent.click(screen.getByRole("button", { name: "在模特上试衣" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃截图并切换" }));
  expect(screen.queryByText("本人试穿会话")).toBeNull();
  expect(lifecycle.leave).toHaveBeenCalledTimes(1);
  expect(screen.getByText("选择项目内的模特图片")).toBeTruthy();
});
