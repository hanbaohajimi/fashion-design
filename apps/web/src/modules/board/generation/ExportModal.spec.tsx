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

it("sends the selected aspect preset and keeps it in the idempotency fingerprint", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(String(input).includes("capabilities")
      ? { downloadLinkHours: 24 }
      : String(input).includes("exports?")
        ? { items: [] }
        : { id: "square-export", status: "queued", format: "png", quality: "standard", aspect: "square", createdAt: new Date().toISOString(), error: null }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "aspect", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "1:1" }));
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ aspect: "square", format: "png", sourceType: "asset" });
});

it("allows a single asset to be sent to the print PDF pipeline", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(String(input).includes("capabilities")
      ? { downloadLinkHours: 24 }
      : String(input).includes("exports?")
        ? { items: [] }
        : { id: "print-export", status: "queued", format: "pdf", quality: "standard", aspect: "original", createdAt: new Date().toISOString(), error: null }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "print", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "PDF" }));
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ aspect: "original", format: "pdf", sourceType: "asset" });
});

it("creates one independent export task for each batch aspect", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return new Response(JSON.stringify({ id: `batch-${String(body.aspect)}`, status: "queued", ...body, createdAt: new Date().toISOString(), error: null }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(String(input).includes("capabilities") ? { downloadLinkHours: 24 } : { items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "batch", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "批量导出四种比例" }));
  await waitFor(() => expect(bodies).toHaveLength(4));
  expect(bodies.map((body) => body.aspect).sort()).toEqual(["landscape", "original", "portrait", "square"]);
  expect(screen.getByRole("status", { name: "批量导出进度" })).toBeTruthy();
});

it("retries only the failed batch ratio with a new stable request key", async () => {
  const requests: { body: Record<string, unknown>; key: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const key = new Headers(init.headers).get("Idempotency-Key") ?? "";
      requests.push({ body, key });
      const failed = body.aspect === "square" && requests.filter(item => item.body.aspect === "square").length === 1;
      return new Response(JSON.stringify({ id: `retry-${requests.length}`, status: failed ? "failed" : "queued", ...body, createdAt: new Date().toISOString(), error: failed ? { message: "模拟失败" } : null }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(String(input).includes("capabilities") ? { downloadLinkHours: 24 } : { items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "batch-retry", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: "批量导出四种比例" }));
  await waitFor(() => expect(requests).toHaveLength(4));
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(requests).toHaveLength(5));
  expect(requests.at(-1)?.body.aspect).toBe("square");
  expect(requests.at(-1)?.key).toContain(":square:retry");
});

it("sends an explicitly selected brand revision with the export snapshot", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "brand-export", status: "queued", format: "png", quality: "standard", aspect: "original", brandRevisionId: "brand-r2", createdAt: new Date().toISOString(), error: null }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    const url = String(input);
    if (url.includes("/studio")) return new Response(JSON.stringify({ brandProfiles: [{ type: "BRAND_PROFILE", currentRevision: { id: "brand-r2", revision: 2, payload: { name: "森野" } } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(url.includes("capabilities") ? { downloadLinkHours: 24 } : { items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "brand-export", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  await screen.findByLabelText("导出品牌资料");
  fireEvent.click(screen.getByRole("radio", { name: /森野/ }));
  fireEvent.click(await screen.findByRole("button", { name: "开始导出" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ brandRevisionId: "brand-r2" });
});

it("defaults the only current brand revision into a new export snapshot", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "brand-default", status: "queued", format: "png", quality: "standard", aspect: "original", brandRevisionId: "brand-r2", createdAt: new Date().toISOString(), error: null }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    const url = String(input);
    if (url.includes("/studio")) return new Response(JSON.stringify({ brandProfiles: [{ type: "BRAND_PROFILE", currentRevision: { id: "brand-r2", revision: 2, payload: { name: "森野" } } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(url.includes("capabilities") ? { downloadLinkHours: 24 } : { items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<BoardProjectContext.Provider value="project"><ExportModal onClose={vi.fn()} source={{ type: "asset", assetId: "brand-default", previewUrl: "/image" }} /></BoardProjectContext.Provider>);
  await screen.findByLabelText("导出品牌资料");
  await waitFor(() => expect(screen.getByRole("radio", { name: /森野/ }).getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(await screen.findByRole("button", { name: "开始导出" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ brandRevisionId: "brand-r2" });
});
