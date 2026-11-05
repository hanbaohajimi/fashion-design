// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WardrobeItemView } from "@fashion/shared";
import type { ReactNode } from "react";
import { WardrobeRack } from "./WardrobeRack";

vi.mock("../../../components/ui", async original => ({ ...await original<typeof import("../../../components/ui")>(), Dialog: ({ open, children, label }: { open: boolean; children: ReactNode; label: string }) => open ? <div role="dialog" aria-label={label}>{children}</div> : null }));
const fixture = (id: string, category: WardrobeItemView["currentRevision"]["category"] = "top"): WardrobeItemView => {
  const revision = { id: `${id}-r1`, itemId: id, version: 1, sourceAssetId: `${id}-source`, assetId: `${id}-asset`, name: id, category, display: "hanger" as const, anchor: { x: .5, y: .08 }, imageBounds: { width: 300, height: 460, x: 35, y: 20, contentWidth: 230, contentHeight: 400 }, reviewed: true, sourceKind: "isolated" as const, generatedCompletion: false, url: `/${id}.png`, createdAt: "2026-10-29T00:00:00Z" };
  return { id, projectId: "project", name: id, archived: false, version: 1, currentRevision: revision, revisions: [revision] };
};
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("hover and detail navigation never add a garment or send a request", () => {
  const onAdd = vi.fn(); const request = vi.fn(); vi.stubGlobal("fetch", request);
  render(<WardrobeRack projectId="project" items={[fixture("衬衫"), fixture("长裙", "onepiece")]} canEdit onAdd={onAdd} onPrepare={vi.fn()} onArchive={vi.fn()} onRevise={vi.fn()} />);
  const shirt = screen.getByRole("button", { name: "查看单品：衬衫" });
  fireEvent.pointerEnter(shirt, { pointerType: "mouse" });
  fireEvent.click(shirt);
  expect(screen.getByRole("dialog", { name: "单品：衬衫" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "下一件单品" }));
  expect(screen.getByRole("dialog", { name: "单品：长裙" })).toBeTruthy();
  expect(onAdd).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加入搭配" }));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "长裙-r1" }));
});

it("keeps an already selected item visible while disabling duplicate addition", () => {
  render(<WardrobeRack projectId="project" items={[fixture("衬衫")]} selectedRevisionIds={["衬衫-r1"]} canEdit onAdd={vi.fn()} onPrepare={vi.fn()} onArchive={vi.fn()} onRevise={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "查看单品：衬衫" }));
  expect(screen.getByRole("button", { name: "已加入搭配" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "准备新修订" }).hasAttribute("disabled")).toBe(false);
});

it("keeps focus inside details when previous or next becomes disabled at a boundary", () => {
  render(<WardrobeRack projectId="project" items={[fixture("衬衫"), fixture("裤装", "bottom"), fixture("长裙", "onepiece")]} canEdit onAdd={vi.fn()} onPrepare={vi.fn()} onArchive={vi.fn()} onRevise={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "查看单品：衬衫" }));
  const next = screen.getByRole("button", { name: "下一件单品" });
  next.focus(); fireEvent.click(next);
  expect(document.activeElement).toBe(next);
  fireEvent.click(next);
  expect(screen.getByRole("dialog", { name: "单品：长裙" }).contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.matches(":disabled")).toBe(false);
  const previous = screen.getByRole("button", { name: "上一件单品" });
  previous.focus(); fireEvent.click(previous);
  expect(document.activeElement).toBe(previous);
  fireEvent.click(previous);
  expect(screen.getByRole("dialog", { name: "单品：衬衫" }).contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.matches(":disabled")).toBe(false);
});

it("searches and pages without changing the project selection", () => {
  const onAdd = vi.fn();
  render(<WardrobeRack projectId="project" items={Array.from({ length: 9 }, (_, index) => fixture(`单品${index}`))} canEdit onAdd={onAdd} onPrepare={vi.fn()} onArchive={vi.fn()} onRevise={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "下一组" }));
  expect(screen.getByRole("button", { name: "查看单品：单品8" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "查找单品" }), { target: { value: "单品0" } });
  expect(screen.getByRole("button", { name: "查看单品：单品0" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "查看单品：单品8" })).toBeNull();
  expect(onAdd).not.toHaveBeenCalled();
});
