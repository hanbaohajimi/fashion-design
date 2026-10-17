import { describe, expect, it } from "vitest";
import { mergeDialogSummary } from "./design-context.summary";
import { projectVersionEpisodes, semanticVersionChanges } from "./information-integration.projector";

describe("source-backed semantic memory", () => {
  it("扫描整条原文，保留尾部纠正与问题并绑定逐字证据", () => {
    const summary = mergeDialogSummary(null, [{ id: "user-1", role: "USER", content: `${"过程描述。".repeat(120)}现在目标改为轻量通勤外套。不要再理解为运动夹克。保留藏蓝色。袖口为什么仍然太宽？` }]);
    expect(summary.semanticMemory.goalEvolution).toContainEqual(expect.objectContaining({ text: "现在目标改为轻量通勤外套。", evidenceRefIds: [expect.any(String)] }));
    expect(summary.semanticMemory.rejectedUnderstandings).toContainEqual(expect.objectContaining({ text: "不要再理解为运动夹克。" }));
    expect(summary.semanticMemory.openQuestions).toContainEqual(expect.objectContaining({ text: "袖口为什么仍然太宽？" }));
    expect(summary.semanticMemory.evidenceRefs).toContainEqual(expect.objectContaining({ messageId: "user-1", quote: "现在目标改为轻量通勤外套。" }));
  });

  it("助手推测不变成用户目标，滚动重建不恢复已覆盖问题且保留纠正CAS元数据", () => {
    const lastCorrection = { mutationId: "manual-1", requestHash: "hash-1" };
    const first = mergeDialogSummary({ lastCorrection }, [{ id: "u1", role: "USER", content: "目标是通勤外套。" }]);
    const merged = mergeDialogSummary(first, [{ id: "a1", role: "ASSISTANT", content: "目标改为红色运动夹克？" }, { id: "u2", role: "USER", content: "不对，仍然保留藏蓝色。" }]);
    expect(merged.semanticMemory.goalEvolution).toHaveLength(1);
    expect(merged.semanticMemory.rejectedUnderstandings).toContainEqual(expect.objectContaining({ text: "不对，仍然保留藏蓝色。" }));
    expect(merged.lastCorrection).toEqual(lastCorrection);
    expect(new Set(merged.semanticMemory.evidenceRefs.map((ref) => ref.id)).size).toBe(merged.semanticMemory.evidenceRefs.length);
  });
});

const version = (id: string, ordinal: number, payload: unknown, origin = "user") => ({ id, nodeId: "tool-a", projectId: "p", version: ordinal, graphRevision: ordinal, kind: "tool", type: "generate", title: "通勤方案", payload, inputBindings: [], previousVersionId: ordinal === 1 ? null : `v${ordinal - 1}`, origin, baseline: ordinal === 1, createdAt: new Date(ordinal * 1000) });

describe("version-backed episodes", () => {
  it("只采用真实用户语义变更，保留前后参数和不可变版本ID", () => {
    const versions = [version("v1", 1, { params: { prompt: "通勤外套", count: 2 } }), version("v2", 2, { params: { prompt: "收窄袖口", count: 3 } }), version("v3", 3, { params: { prompt: "系统填充" } }, "system")];
    const changes = semanticVersionChanges(versions);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ beforeVersionId: "v1", afterVersionId: "v2", before: { parameters: { count: 2 } }, after: { parameters: { count: 3 } } });
    const episodes = projectVersionEpisodes(versions, [], []);
    expect(episodes).toContainEqual(expect.objectContaining({ nodeVersionId: "v2", previousVersionId: "v1", changes: expect.any(Array) }));
    expect(JSON.stringify(changes)).not.toContain("系统填充");
  });

  it("基线不补造历史，状态或布局变化不构成设计意图证据", () => {
    const versions = [version("v1", 1, { params: { prompt: "藏蓝外套" }, status: "ready" }), version("v2", 2, { params: { prompt: "藏蓝外套" }, status: "running", position: { x: 100 } })];
    expect(semanticVersionChanges(versions)).toEqual([]);
    expect(projectVersionEpisodes(versions, [], [])[0]).toMatchObject({ baseline: true, historyMissing: true });
  });

  it("输入只换不可变版本标识或系统补齐同样的合法默认值不会成为人工意图", () => {
    const before = { ...version("v1", 1, { params: { prompt: "藏蓝外套" } }), type: "generate_design", inputBindings: [{ sourceNodeId: "constraint", sourceNodeVersionId: "source-v1", sourcePort: "out", targetPort: "constraint" }] };
    const after = { ...version("v2", 2, { params: { prompt: "藏蓝外套", count: 2, width: 768, height: 1024, quality: "high", referenceInputs: [], negativePrompt: "", taskType: "t2i" } }), type: "generate_design", inputBindings: [{ sourceNodeId: "constraint", sourceNodeVersionId: "source-v2", sourcePort: "out", targetPort: "constraint" }] };
    expect(semanticVersionChanges([before, after])).toEqual([]);
  });

  it("跨节点派生使用精确的同项目同类型历史版本，不能把普通祖先或外项目引用当来源", () => {
    const original = { ...version("v1", 1, { params: { prompt: "灰色" } }), nodeId: "tool-a" };
    const fork = { ...version("fork-v1", 1, { params: { prompt: "银色窄袖口" }, forkedFromNodeId: "tool-a", forkedFromNodeVersionId: "v1" }, "proposal"), nodeId: "tool-b", baseline: false };
    expect(semanticVersionChanges([original, fork])).toMatchObject([{ beforeNodeId: "tool-a", beforeVersionId: "v1", afterVersionId: "fork-v1", fork: true }]);
    expect(projectVersionEpisodes([original, fork], [], [])).toContainEqual(expect.objectContaining({ nodeId: "tool-b", sourceNodeId: "tool-a", sourceNodeVersionId: "v1", historyMissing: false }));
    for (const invalid of [
      { ...original, projectId: "foreign-project" },
      { ...original, nodeId: "another-node" },
      { ...original, type: "another-tool" },
      { ...original, graphRevision: fork.graphRevision + 1 },
    ]) expect(semanticVersionChanges([invalid, fork])).toEqual([]);
    expect(semanticVersionChanges([original, { ...fork, origin: "user" }])).toEqual([]);
  });

  it("同节点前驱必须是更早的不可变版本，损坏链不形成变化证据", () => {
    const previous = { ...version("v1", 3, { params: { prompt: "灰色" } }), previousVersionId: null, baseline: true };
    const current = version("v2", 2, { params: { prompt: "银色" } });
    expect(semanticVersionChanges([previous, current])).toEqual([]);
    expect(projectVersionEpisodes([previous, current], [], [])).toContainEqual(expect.objectContaining({ nodeVersionId: "v2", historyMissing: true }));
  });
});
