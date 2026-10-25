import { describe, expect, it } from "vitest";
import { removeReferenceMentions, resolveDraftReferences } from "./discussion-references";

const nodes = [{ id: "a", title: "候选 A" }, { id: "b", title: "候选 A 分支" }, { id: "c", title: "棉麻(蓝)" }];
describe("composer references", () => {
  it("matches the longest exact title, merges selected references and ignores deleted nodes", () => {
    expect(resolveDraftReferences(nodes, "修改 @候选 A 分支，保留版型", ["a", "gone", "a"]).ids).toEqual(["a", "b"]);
    expect(resolveDraftReferences(nodes, "查看候选 A", []).ids).toEqual([]);
  });
  it("requires an explicit choice for duplicated names", () => {
    const duplicates = [...nodes, { id: "d", title: "候选 A" }];
    expect(resolveDraftReferences(duplicates, "@候选 A", []).error).toContain("多个");
    expect(resolveDraftReferences(duplicates, "@候选 A", ["d"])).toEqual({ ids: ["d"], error: null });
  });
  it("removes every matching mention and preserves prose, other mentions and longer titles", () => {
    expect(removeReferenceMentions("@候选 A 保留版型 @候选 A，@无关 @候选 A 分支 @棉麻(蓝)", nodes, ["a", "c"]))
      .toBe(" 保留版型 ，@无关 @候选 A 分支 ");
    expect(removeReferenceMentions("邮件 a@候选 A 和 @候选 A新款", nodes, ["a"])).toBe("邮件 a@候选 A 和 @候选 A新款");
  });
});
