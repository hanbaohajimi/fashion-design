import { describe, expect, it } from "vitest";

import {
  MAX_ASSISTANT_SKILLS,
  createAssistantSkill,
  mergeAssistantSkills,
  readAssistantSkills,
  writeAssistantSkills,
  type AssistantSkill,
  type AssistantSkillStorage,
} from "./assistant-skills";

function storage(): AssistantSkillStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

const skill = (id: string): AssistantSkill => ({
  id,
  name: `技能 ${id}`,
  description: "测试技能",
  prompt: "整理当前设计目标",
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
});

describe("assistant skills", () => {
  it("丢弃旧版本混入账号缓存的工作区技能，个人离线草稿仍保留", () => {
    const store = storage();
    store.setItem("fashion:assistant-skills:account", JSON.stringify([{ ...skill("shared"), scope: "WORKSPACE", serverId: "shared" }, skill("personal")]));
    expect(readAssistantSkills(store, "account").map(item => item.id)).toEqual(["personal"]);
    writeAssistantSkills(store, "account", [{ ...skill("shared"), scope: "WORKSPACE" }, skill("personal")]);
    expect(JSON.parse(store.getItem("fashion:assistant-skills:account") ?? "[]")).toEqual([skill("personal")]);
  });

  it("服务端成功响应移除已撤销的远端技能，只合入尚未同步的个人草稿", () => {
    const local = [{ ...skill("old-shared"), scope: "WORKSPACE" as const }, { ...skill("deleted-personal"), serverId: "deleted-personal" }, skill("offline")];
    expect(mergeAssistantSkills([], local).map(item => item.id)).toEqual(["offline"]);
    expect(mergeAssistantSkills([{ ...skill("current-shared"), ownerId: "other", workspaceId: "current-workspace", scope: "WORKSPACE" }], local)).toMatchObject([
      { id: "current-shared", workspaceId: "current-workspace", scope: "WORKSPACE" }, { id: "offline" },
    ]);
  });

  it("keeps personal skills isolated by account and survives storage round trips", () => {
    const store = storage();
    writeAssistantSkills(store, "account-a", [skill("a")]);

    expect(readAssistantSkills(store, "account-a")).toEqual([skill("a")]);
    expect(readAssistantSkills(store, "account-b")).toEqual([]);
  });

  it("ignores malformed records and enforces the bounded library", () => {
    const store = storage();
    const skills = Array.from({ length: MAX_ASSISTANT_SKILLS + 4 }, (_, index) => skill(String(index)));
    writeAssistantSkills(store, "account", skills);

    expect(readAssistantSkills(store, "account")).toHaveLength(MAX_ASSISTANT_SKILLS);
  });

  it("does not create an executable skill from an empty draft", () => {
    expect(createAssistantSkill({ id: "empty", name: " ", prompt: " ", now: "now" })).toBeNull();
    expect(createAssistantSkill({ id: "valid", name: "审阅", prompt: "检查当前方案", now: "now" })).toMatchObject({
      id: "valid",
      name: "审阅",
      prompt: "检查当前方案",
    });
  });
});

