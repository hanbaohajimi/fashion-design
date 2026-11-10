import { afterEach, expect, it, vi } from "vitest";
import { requireRestoreSourceFile } from "./restore-source-file";
afterEach(() => vi.unstubAllEnvs());

it("私有来源需为非空图片，错误存储类型不视为恢复成功", async () => {
  const head = vi.fn().mockResolvedValueOnce({ contentLength: 12, contentType: "image/png" }).mockResolvedValueOnce({ contentLength: 0, contentType: "image/png" }).mockResolvedValueOnce({ contentLength: 12, contentType: "text/html" }).mockRejectedValueOnce(new Error("offline"));
  await expect(requireRestoreSourceFile({ head }, "s3://history/original.png")).resolves.toBeUndefined();
  for (let i = 0; i < 3; i++) await expect(requireRestoreSourceFile({ head }, "s3://history/original.png")).rejects.toMatchObject({ status: 503 });
});

it("识别部署存储地址但不探测任意历史外部地址", async () => {
  vi.stubEnv("S3_ENDPOINT", "https://storage.test"); vi.stubEnv("S3_BUCKET", "private");
  const head = vi.fn().mockResolvedValue({ contentLength: 12, contentType: "image/png" });
  await requireRestoreSourceFile({ head }, "https://storage.test/private/history/original.png?old-signature=1");
  expect(head).toHaveBeenCalledWith("history/original.png");
  head.mockClear();
  await requireRestoreSourceFile({ head }, "https://old-external.example/image.png");
  expect(head).not.toHaveBeenCalled();
});
