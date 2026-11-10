import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { draftRepository, DraftConflict, serializeDraft, sameDraftBaseline } from "./draft-repository";

describe("本机草稿事务", () => {
  it("白板记录顺序和视野不构成内容差异，存储仍保留视野与真实改动", async () => {
    const first = {
      document: {
        store: { a: { x: 10, props: { text: "原文" } }, b: { x: 20 } },
        schema: { schemaVersion: 2 },
      },
      session: { camera: { x: 50 } },
    };
    const reordered = {
      document: {
        schema: { schemaVersion: 2 },
        store: { b: { x: 20 }, a: { props: { text: "原文" }, x: 10 } },
      },
      session: { camera: { x: 200 } },
    };
    expect(sameDraftBaseline(JSON.stringify(first), JSON.stringify(reordered))).toBe(true);
    const changed = structuredClone(reordered);
    changed.document.store.a.props.text = "新文字";
    expect(sameDraftBaseline(JSON.stringify(first), JSON.stringify(changed))).toBe(false);
    const saved = await draftRepository.write({
      key: crypto.randomUUID(),
      accountId: "canvas-view-owner",
      baseline: JSON.stringify(first),
      value: reordered,
    }, 0);
    expect(saved.value.session.camera.x).toBe(200);
    expect(JSON.parse(saved.baseline).session.camera.x).toBe(50);
  });
  it("技术表格基线忽略重建的行身份，但存储与恢复保留身份和数值中间态", async () => {
    const first = { bom: [{ uiId: "old", quantity: "1." }], pom: [] };
    const latest = { bom: [{ uiId: "new", quantity: "1." }], pom: [] };
    expect(sameDraftBaseline(JSON.stringify(first), JSON.stringify(latest))).toBe(true);
    expect(sameDraftBaseline(JSON.stringify(first), JSON.stringify({ ...latest, bom: [{ uiId: "new", quantity: "2" }] }))).toBe(false);
    const record = await draftRepository.write({ key: crypto.randomUUID(), accountId: "table-owner", baseline: JSON.stringify(first), value: latest }, 0);
    expect(JSON.parse(record.baseline).bom[0].uiId).toBe("old");
    expect(record.value.bom[0]).toEqual({ uiId: "new", quantity: "1." });
  });
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
  it("条件清除同时匹配操作内容，不误删删除后重建且修订号相同的新操作", async () => {
    const key = crypto.randomUUID();
    const first = await draftRepository.write({ key, accountId: "owner", baseline: "null", value: { requestId: "first" } }, 0);
    await draftRepository.remove(key, first.revision, first.value);
    const next = await draftRepository.write({ key, accountId: "owner", baseline: "null", value: { requestId: "next" } }, 0);
    expect(next.revision).toBe(first.revision);
    expect(await draftRepository.remove(key, first.revision, first.value)).toBe(false);
    expect((await draftRepository.read(key))?.value).toEqual(next.value);
    expect(await draftRepository.remove(key, next.revision, next.value)).toBe(true);
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
