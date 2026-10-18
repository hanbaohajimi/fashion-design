// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createShapeId } from "tldraw";
import { setUploadPreview, useUploadPreview, clearAllUploadPreviews } from "./upload-preview-store";

vi.hoisted(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => { clearAllUploadPreviews(); vi.unstubAllGlobals(); });

it("身份作用域销毁时撤销所有上传 Blob URL，后续工作区不能读取预览", () => {
  const revoke = vi.fn();
  vi.stubGlobal("URL", { revokeObjectURL: revoke });
  const id = createShapeId("private-upload");
  setUploadPreview(id, "blob:private-a");
  const hook = renderHook(() => useUploadPreview(id));
  expect(hook.result.current).toBe("blob:private-a");
  act(() => window.dispatchEvent(new Event("fashion:session-changed")));
  expect(hook.result.current).toBe("");
  expect(revoke).toHaveBeenCalledWith("blob:private-a");
});
