import { FileStatus, RoleInferenceState, RoleSource } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";

import {
  createVlmInferenceProcessor,
  roleForVlmLabel,
} from "./vlm-inference.processor";

const data = {
  fileId: "file-1",
  projectId: "project-1",
  shapeId: "shape:one",
};

function element(
  roleSource: RoleSource = RoleSource.DEFAULT,
  roleInferenceState: RoleInferenceState = RoleInferenceState.PENDING,
) {
  return {
    deletedAt: null,
    fileAssetId: "file-1",
    roleInferenceState,
    roleSource,
  };
}

function file() {
  return {
    status: FileStatus.READY,
    thumbnail1024Key: "thumb.webp",
  };
}

describe("VLM role inference processor", () => {
  it("maps a fabric classification above 70% to fabric_ref", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const processor = createVlmInferenceProcessor({
      classifier: {
        classify: vi.fn().mockResolvedValue({
          confidence: 0.86,
          isFashion: true,
          label: "fabric_texture",
        }),
      },
      database: {
        boardElement: {
          findUnique: vi.fn().mockResolvedValue(element()),
          updateMany,
        },
        fileAsset: { findUnique: vi.fn().mockResolvedValue(file()) },
      } as never,
      storage: {
        delete: vi.fn(),
        get: vi.fn().mockResolvedValue(Buffer.from("webp")),
        put: vi.fn(),
      },
    });

    await processor(data);

    expect(roleForVlmLabel("fabric_texture")).toBe("fabric_ref");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "fabric_ref",
          roleConfidence: 0.86,
          roleInferenceState: RoleInferenceState.READY,
        }),
        where: expect.objectContaining({
          deletedAt: null,
          roleInferenceState: RoleInferenceState.PENDING,
          roleSource: { not: RoleSource.MANUAL },
        }),
      }),
    );
  });

  it("falls back to style_ref without failing the upload flow", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const processor = createVlmInferenceProcessor({
      classifier: {
        classify: vi.fn().mockRejectedValue(new Error("VLM unavailable")),
      },
      database: {
        boardElement: {
          findUnique: vi.fn().mockResolvedValue(element()),
          updateMany,
        },
        fileAsset: { findUnique: vi.fn().mockResolvedValue(file()) },
      } as never,
      storage: {
        delete: vi.fn(),
        get: vi.fn().mockResolvedValue(Buffer.from("webp")),
        put: vi.fn(),
      },
    });

    await expect(processor(data)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "style_ref",
          roleInferenceState: RoleInferenceState.FAILED,
          roleSource: RoleSource.DEFAULT,
        }),
        where: expect.objectContaining({
          deletedAt: null,
          roleInferenceState: RoleInferenceState.PENDING,
          roleSource: { not: RoleSource.MANUAL },
        }),
      }),
    );
  });

  it("never lets a delayed VLM result overwrite a manual role", async () => {
    const classify = vi.fn();
    const updateMany = vi.fn();
    const processor = createVlmInferenceProcessor({
      classifier: { classify },
      database: {
        boardElement: {
          findUnique: vi.fn().mockResolvedValue(element(RoleSource.MANUAL)),
          updateMany,
        },
        fileAsset: { findUnique: vi.fn().mockResolvedValue(file()) },
      } as never,
      storage: { delete: vi.fn(), get: vi.fn(), put: vi.fn() },
    });

    await processor(data);

    expect(classify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not classify a duplicate job after inference is already ready", async () => {
    const classify = vi.fn();
    const get = vi.fn();
    const updateMany = vi.fn();
    const processor = createVlmInferenceProcessor({
      classifier: { classify },
      database: {
        boardElement: {
          findUnique: vi
            .fn()
            .mockResolvedValue(
              element(RoleSource.INFERRED, RoleInferenceState.READY),
            ),
          updateMany,
        },
        fileAsset: { findUnique: vi.fn().mockResolvedValue(file()) },
      } as never,
      storage: { delete: vi.fn(), get, put: vi.fn() },
    });

    await processor(data);

    expect(get).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("caps non-fashion confidence so the UI shows a warning", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const processor = createVlmInferenceProcessor({
      classifier: {
        classify: vi.fn().mockResolvedValue({
          confidence: 0.91,
          isFashion: false,
          label: "non_fashion",
        }),
      },
      database: {
        boardElement: {
          findUnique: vi.fn().mockResolvedValue(element()),
          updateMany,
        },
        fileAsset: { findUnique: vi.fn().mockResolvedValue(file()) },
      } as never,
      storage: {
        delete: vi.fn(),
        get: vi.fn().mockResolvedValue(Buffer.from("webp")),
        put: vi.fn(),
      },
    });

    await processor(data);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "style_ref",
          roleConfidence: 0.49,
          roleLabel: "non_fashion",
        }),
      }),
    );
  });
});
