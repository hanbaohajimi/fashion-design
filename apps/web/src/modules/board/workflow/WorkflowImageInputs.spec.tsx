// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowImageInputs } from "./WorkflowImageInputs";
const upload = vi.hoisted(() => ({ sign: vi.fn(), ready: vi.fn() }));
vi.mock("../file-upload-api", () => ({
  validateImage: () => null,
  signImageUpload: upload.sign,
  waitForThumbnail: upload.ready,
  completeUpload: vi.fn(),
  putOriginal: vi.fn(),
}));
beforeEach(() => { vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:preview"); static override revokeObjectURL = vi.fn(); }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("retains uploaded files when node creation fails and retries only that item", async () => {
  upload.sign.mockImplementation(async (_project, file: File) => ({ file: { id: file.name }, upload: null }));
  upload.ready.mockImplementation(async (id: string) => ({ id, width: 100, height: 100, thumbnail1024Url: "/image.png" }));
  const add = vi.fn().mockRejectedValueOnce(new Error("节点保存失败")).mockResolvedValue(undefined);
  const { container } = render(<WorkflowImageInputs projectId="p" editor={() => null} onAdd={add}><div>画布</div></WorkflowImageInputs>);
  const input = container.querySelector("input");
  if (!input) throw new Error("缺少上传入口");
  fireEvent.change(input, { target: { files: [new File(["one"], "one.png", { type: "image/png" }), new File(["two"], "two.png", { type: "image/png" })] } });
  await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(3));
  expect(upload.sign).toHaveBeenCalledTimes(2);
  expect(upload.ready).toHaveBeenCalledTimes(2);
  expect(add.mock.calls[0]?.[3]).toEqual({ x: 0, y: 0 });
  expect(add.mock.calls[1]?.[3]).toEqual({ x: 60, y: 60 });
  expect(add.mock.calls[2]?.[2]).toMatchObject({ fileAssetId: "one.png" });
});

it("leaves text inputs in control of clipboard text", () => {
  const add = vi.fn();
  render(<WorkflowImageInputs projectId="p" editor={() => null} onAdd={add}><input aria-label="备注" /></WorkflowImageInputs>);
  const prevented = fireEvent.paste(screen.getByRole("textbox", { name: "备注" }), { clipboardData: { files: [], getData: () => "文字" } });
  expect(prevented).toBe(true);
  expect(add).not.toHaveBeenCalled();
});
