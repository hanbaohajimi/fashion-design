// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowLibraryDialog } from "./WorkflowMaterialDialogs";

HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("makes the 31st and 61st library materials accessible", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input), "http://local").searchParams.get("page"));
    return new Response(JSON.stringify({ total: 61, hasMore: page < 3, items: Array.from({ length: page === 3 ? 1 : 30 }, (_, i) => ({ id: String((page - 1) * 30 + i + 1), title: `趋势 ${(page - 1) * 30 + i + 1}` })) }));
  }));
  const add = vi.fn(async () => undefined);
  render(<WorkflowLibraryDialog kind="trend" onAdd={add} onClose={() => undefined} />);
  await screen.findByRole("button", { name: "趋势 30" });
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  await screen.findByRole("button", { name: "趋势 31" });
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  fireEvent.click(await screen.findByRole("button", { name: "趋势 61" }));
  expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: "61" }));
});
