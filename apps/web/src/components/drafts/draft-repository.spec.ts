import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { draftRepository, DraftConflict, serializeDraft } from "./draft-repository";

describe("本机草稿事务", () => {
  it("比较版本写入，冲突保留原稿且不覆盖，条件清除不删除更新版本", async () => {
    const key = crypto.randomUUID();
    const input = { key, accountId: "owner", baseline: "server-r1", value: { prompt: "第一份" } };
    const first = await draftRepository.write(input, 0);
    const second = await draftRepository.write({ ...input, value: { prompt: "另一标签" } }, first.revision);
    await expect(draftRepository.write({ ...input, value: { prompt: "本页编辑" } }, first.revision)).rejects.toBeInstanceOf(DraftConflict);
    expect((await draftRepository.read<{ prompt: string }>(key))?.value.prompt).toBe("另一标签");
    expect((await draftRepository.conflicts<{ prompt: string }>(key))[0]?.value.prompt).toBe("本页编辑");
    expect(await draftRepository.remove(key, first.revision)).toBe(false);
    expect(await draftRepository.remove(key, second.revision)).toBe(true);
  });
  it("账号清理只影响该账号，清理后迟到写入被阻止", async () => {
    const id = crypto.randomUUID();
    await draftRepository.write({ key: id, accountId: id, baseline: "", value: "草稿" }, 0);
    const other = await draftRepository.write({ key: `${id}-other`, accountId: "other", baseline: "", value: "保留" }, 0);
    await draftRepository.clearAccount(id);
    expect(await draftRepository.read(id)).toBeUndefined();
    expect(await draftRepository.read(other.key)).toBeDefined();
    await expect(draftRepository.write({ key: id, accountId: id, baseline: "", value: "迟到" }, 0)).rejects.toThrow("账号已退出");
  });
  it("基线也会过滤签名URL，不因轮换的签名制造冲突", async () => {
    const key = crypto.randomUUID();
    const record = await draftRepository.write({ key, accountId: "baseline-owner", baseline: JSON.stringify({ fileId: "asset", url: "https://host/image?X-Amz-Signature=secret" }), value: { fileId: "asset", url: "https://host/image?X-Amz-Signature=secret" } }, 0);
    expect(record.baseline).toBe(JSON.stringify({ fileId: "asset" }));
    expect(record.value).toEqual({ fileId: "asset" });
  });
  it("不会保存Blob URL与签名URL", () => {
    expect(JSON.parse(serializeDraft({ fileId: "asset-1", preview: "blob:test", signed: "https://host/image?X-Amz-Signature=secret" }))).toEqual({ fileId: "asset-1" });
  });
});
