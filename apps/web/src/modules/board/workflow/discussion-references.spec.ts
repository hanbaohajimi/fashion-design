import { describe, expect, it } from "vitest";
import {
  appendDraftReferences,
  resolveReferenceInstances,
  retainReferenceInstances,
  findDraftMention,
  insertDraftMention,
  removeReferenceMentions,
  resolveDraftReferences,
} from "./discussion-references";

const nodes = [
  { id: "a", title: "候选 A" },
  { id: "b", title: "候选 A 分支" },
  { id: "c", title: "棉麻(蓝)" },
];
describe("composer references", () => {
  it("appends batches after explicit and typed references without reordering or duplication", () => {
    expect(appendDraftReferences(nodes, "参考 @棉麻(蓝)", ["b"], ["a", "b", "a"])).toEqual({ ids: ["b", "c", "a"], error: null });
  });
  it("retains unavailable draft references until explicitly removed", () => {
    expect(appendDraftReferences(nodes, "", ["gone", "a"], ["b"]).ids).toEqual(["gone", "a", "b"]);
  });
  it("rejects an unavailable incoming item atomically", () => {
    expect(appendDraftReferences(nodes, "", ["a"], ["b", "gone"])).toMatchObject({ ids: ["a"], error: expect.any(String) });
  });
  it("checks the combined limit including typed references and accepts duplicates at the limit", () => {
    const many = Array.from({ length: 18 }, (_, index) => ({ id: String(index), title: `素材${index}` }));
    const ids = many.slice(0, 15).map(node => node.id);
    expect(appendDraftReferences(many, "@素材15", ids, ["16"])).toMatchObject({ ids, error: expect.stringContaining("16") });
    expect(appendDraftReferences(many, "@素材15", ids, ["0"])).toEqual({ ids: many.slice(0, 16).map(node => node.id), error: null });
  });
  it("lets an explicit selection disambiguate typed names without adding all namesakes", () => {
    const duplicates = [...nodes, { id: "d", title: "候选 A" }];
    const appended = appendDraftReferences(duplicates, "@候选 A", ["c"], ["d"]);
    expect(resolveDraftReferences(duplicates, "@候选 A", appended.ids)).toEqual({ ids: ["c", "d"], error: null });
  });
  it("counts newly resolved typed references after choosing a namesake", () => {
    const many = Array.from({ length: 16 }, (_, index) => ({ id: String(index), title: `素材${index}` }));
    const duplicates = [...many, { id: "x", title: "同名" }, { id: "y", title: "同名" }];
    expect(appendDraftReferences(duplicates, `${many.map(node => `@${node.title}`).join(" ")} @同名`, [], ["x"])).toMatchObject({ ids: [], error: expect.stringContaining("16") });
  });
  it("keeps each explicitly chosen placement through later selections and material forks", () => {
    const instances = { a: ["original", "copy"], b: ["other"] };
    const bindings = new Map([["original", "a"], ["copy", "new-a"], ["other", "b"]]);
    expect(resolveReferenceInstances(["a", "b", "c"], instances, bindings)).toEqual({
      nodeIds: ["a", "new-a", "b", "c"],
      instances: { a: ["original"], "new-a": ["copy"], b: ["other"] },
    });
    expect(retainReferenceInstances(instances, ["b"])).toEqual({ b: ["other"] });
  });
  it("keeps a historical material reference when its canvas placement is absent", () => {
    expect(resolveReferenceInstances(["a"], { a: ["removed"] }, new Map())).toEqual({ nodeIds: ["a"], instances: { a: ["removed"] } });
  });
  it("matches the longest exact title, merges selected references and ignores deleted nodes", () => {
    expect(
      resolveDraftReferences(nodes, "修改 @候选 A 分支，保留版型", [
        "a",
        "gone",
        "a",
      ]).ids,
    ).toEqual(["a", "b"]);
    expect(resolveDraftReferences(nodes, "查看候选 A", []).ids).toEqual([]);
  });
  it("requires an explicit choice for duplicated names", () => {
    const duplicates = [...nodes, { id: "d", title: "候选 A" }];
    expect(resolveDraftReferences(duplicates, "@候选 A", []).error).toContain(
      "多个",
    );
    expect(resolveDraftReferences(duplicates, "@候选 A", ["d"])).toEqual({
      ids: ["d"],
      error: null,
    });
  });
  it("removes every matching mention and preserves prose, other mentions and longer titles", () => {
    expect(
      removeReferenceMentions(
        "@候选 A 保留版型 @候选 A，@无关 @候选 A 分支 @棉麻(蓝)",
        nodes,
        ["a", "c"],
      ),
    ).toBe(" 保留版型 ，@无关 @候选 A 分支 ");
    expect(
      removeReferenceMentions("邮件 a@候选 A 和 @候选 A新款", nodes, ["a"]),
    ).toBe("邮件 a@候选 A 和 @候选 A新款");
  });
  it("recognizes Chinese-adjacent references consistently without interpreting email addresses", () => {
    const prompt =
      "参考@棉麻(蓝)，再看@候选 A。邮件designer+work@候选 A不作为引用";
    expect(resolveDraftReferences(nodes, prompt, []).ids).toEqual(["c", "a"]);
    expect(removeReferenceMentions(prompt, nodes, ["c", "a"])).toBe(
      "参考，再看。邮件designer+work@候选 A不作为引用",
    );
  });
  it("inserts at a caret in the middle without deleting prose or punctuation", () => {
    const prompt = "请参考@候选，保留领口。";
    const caret = "请参考@候".length;
    const mention = findDraftMention(prompt, caret, caret, nodes);
    if (!mention) throw new Error("应识别光标处的引用");
    expect(mention).toEqual({ start: 3, end: 6, query: "候" });
    expect(insertDraftMention(prompt, mention, "候选 A")).toEqual({
      value: "请参考@候选 A，保留领口。",
      caret: 8,
    });
  });
  it("supports multiword titles, longer alternatives and names with punctuation", () => {
    for (const title of ["候选 A", "候选 A 分支", "棉麻(蓝)"]) {
      const value = `前文\n@${title}，后文`;
      const caret = value.indexOf("，");
      expect(findDraftMention(value, caret, caret, nodes)?.query).toBe(title);
    }
    const value = "@候选 A 分支 后文";
    expect(findDraftMention(value, 3, 3, nodes)?.end).toBe(
      "@候选 A 分支".length,
    );
    expect(findDraftMention("@候选 A 保留袖型", 10, 10, nodes)).toBeNull();
  });
  it("ignores email, selected text, trailing separators and completed prose", () => {
    for (const value of [
      "owner+tag@example",
      "a.b@example",
      "a_@example",
      "@@候选",
      "@候选 A ",
      "@未知，正文",
      "@候选\n下一行",
    ]) {
      expect(
        findDraftMention(value, value.length, value.length, nodes),
        value,
      ).toBeNull();
    }
    expect(findDraftMention("@候选", 1, 3, nodes)).toBeNull();
    expect(findDraftMention("", 0, 0, nodes)).toBeNull();
    expect(findDraftMention("@未知", 3, 3, nodes)?.query).toBe("未知");
  });
  it("adds one separator at the end and retains existing newlines", () => {
    expect(
      insertDraftMention("@候", { start: 0, end: 2, query: "候" }, "候选 A"),
    ).toEqual({ value: "@候选 A ", caret: 6 });
    expect(
      insertDraftMention(
        "开始\n@候\n后文",
        { start: 3, end: 5, query: "候" },
        "候选 A",
      ).value,
    ).toBe("开始\n@候选 A\n后文");
  });
});
