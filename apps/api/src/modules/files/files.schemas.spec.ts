import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, signUploadSchema } from "./files.schemas";

const valid = {
  mimeType: "image/heic",
  name: "sample.heic",
  projectId: "project-1",
  sha256: "f".repeat(64),
  size: 1024,
};

describe("signUploadSchema", () => {
  it("接受 HEIC", () => {
    expect(signUploadSchema.safeParse(valid).success).toBe(true);
  });

  it("拒绝超过 50MB 的文件", () => {
    expect(
      signUploadSchema.safeParse({
        ...valid,
        size: MAX_IMAGE_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it("拒绝非图片 MIME", () => {
    expect(
      signUploadSchema.safeParse({
        ...valid,
        mimeType: "application/pdf",
      }).success,
    ).toBe(false);
  });
});
