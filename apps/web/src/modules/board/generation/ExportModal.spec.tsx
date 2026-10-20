// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardProjectContext } from "../board-context";
import { ExportModal } from "./ExportModal";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
it("restores the server task and lets a queued export close immediately", async () => {
  const job = { id: "existing", status: "queued", format: "png", quality: "standard", createdAt: new Date().toISOString(), error: null };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") throw new Error("Restoring an export must not create another task");
    return new Response(JSON.stringify(String(input).includes("capabilities") ? { downloadLinkHours: 24 }
      : String(input).includes("exports?") ? { items: [job] } : job), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher);
  const close = vi.fn();
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={close} source={{ type: "asset", assetId: "asset", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  await screen.findByText("等待处理");
  fireEvent.click(screen.getByRole("button", { name: "关闭导出窗口" }));
  expect(close).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("/api/exports/existing"))).toBe(true));
  expect(fetcher.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true);
});

it("reuses an uncertain creation key after the window is reopened", async () => {
  const keys: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
      throw new Error("Response lost");
    }
    return new Response(JSON.stringify(String(input).includes("capabilities") ? { downloadLinkHours: 24 } : { items: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const modal = <BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "uncertain", previewUrl: "/image" }} /></BoardProjectContext.Provider>;
  const first = render(modal);
  const submit = await screen.findByRole("button", { name: "开始导出" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await screen.findByText("Response lost");
  first.unmount();
  render(modal);
  const retry = await screen.findByRole("button", { name: "开始导出" });
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(retry);
  await screen.findByText("Response lost");
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe("");
  expect(keys[1]).toBe(keys[0]);
});

it("uses a fresh key for an explicit new export even after changing its format", async () => {
  sessionStorage.setItem("export-request:asset:changed:jpg:standard", "old-jpg-request");
  const job = { id: "previous", status: "succeeded", format: "png", quality: "standard", createdAt: new Date().toISOString(), downloadUrl: "/download", error: null };
  const keys: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
    return new Response(JSON.stringify(String(input).includes("capabilities") ? { downloadLinkHours: 24 }
      : String(input).includes("exports?") ? { items: [job] } : job), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "changed", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "新建导出" }));
  fireEvent.click(screen.getByRole("button", { name: "JPG" }));
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
  await waitFor(() => expect(keys).toHaveLength(1));
  expect(keys[0]).not.toBe("");
  expect(keys[0]).not.toBe("old-jpg-request");
});
