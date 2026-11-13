import type { AssistantSkillView } from "@fashion/shared";

export interface AssistantSkill {
  readonly createdAt: string;
  readonly description: string;
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly updatedAt: string;
  readonly scope?: "PERSONAL" | "WORKSPACE";
  readonly serverId?: string;
  readonly workspaceId?: string | null;
}

export interface AssistantSkillStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const MAX_ASSISTANT_SKILLS = 24;
const MAX_NAME_LENGTH = 48;
const MAX_DESCRIPTION_LENGTH = 120;
const MAX_PROMPT_LENGTH = 4_000;
const keyFor = (accountId: string): string =>
  `fashion:assistant-skills:${accountId}`;

export const BUILT_IN_ASSISTANT_SKILLS: readonly AssistantSkill[] = [
  {
    id: "builtin-brief",
    name: "整理设计方向",
    description: "把目标、场景、保留项和未知项整理成可确认简报。",
    prompt:
      "请先整理当前项目的设计目标、目标人群、穿着场景、必须保留的条件、可以调整的方向和仍需确认的问题，区分明确事实与推测，暂不生成图片。",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-reference",
    name: "拆解参考素材",
    description: "从廓形、材质、配色和细节提取可观察依据。",
    prompt:
      "请分析当前引用的参考素材，整理廓形、配色、面料观感、细节和共通设计语言，并区分图片中可观察到的信息与需要人工确认的推测，暂不生成图片。",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-review",
    name: "审阅当前方案",
    description: "逐项检查设计要求、偏离风险和下一步。",
    prompt:
      "请审阅当前画布中的服装方案：逐项检查设计要求、廓形、材质、配色与细节的一致性，区分已确认事实、可观察问题和需要人工确认的推测，给出依据、风险和下一步建议，暂不生成图片。",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-delivery",
    name: "准备交付核对",
    description: "核对品牌、修订、视图和交付资料是否完整。",
    prompt:
      "请根据当前项目目标和已选方案，列出交付前需要核对的款式修订、品牌规则、视图、图片说明、人工评审和导出资料；不要把未知信息补写成事实，也不要直接发布或导出。",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function validSkill(value: unknown): value is AssistantSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const required = ["id", "name", "prompt", "createdAt", "updatedAt"];
  return required.every(
    (key) => typeof record[key] === "string" && Boolean(record[key]),
  ) && typeof record.description === "string";
}

export function readAssistantSkills(
  storage: AssistantSkillStorage,
  accountId: string,
): AssistantSkill[] {
  if (!accountId) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(keyFor(accountId));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Older versions mixed workspace records into this account-wide cache.
    // Workspace access must be re-established by the current project's server.
    return parsed.filter(validSkill).filter(skill => skill.scope !== "WORKSPACE").slice(0, MAX_ASSISTANT_SKILLS);
  } catch {
    return [];
  }
}

export function writeAssistantSkills(
  storage: AssistantSkillStorage,
  accountId: string,
  skills: readonly AssistantSkill[],
): void {
  if (!accountId) return;
  try {
    storage.setItem(
      keyFor(accountId),
      JSON.stringify(skills.filter(skill => skill.scope !== "WORKSPACE").slice(0, MAX_ASSISTANT_SKILLS)),
    );
  } catch {
    // Browser storage is optional; the current session still keeps its in-memory copy.
  }
}

export function mergeAssistantSkills(
  remote: readonly AssistantSkillView[],
  local: readonly AssistantSkill[],
): AssistantSkill[] {
  const mapped = remote.map(item => ({ ...item, serverId: item.id }));
  const keys = new Set(mapped.filter(item => item.scope === "PERSONAL").map(item => `${item.name}\0${item.prompt}`));
  return [...mapped, ...local.filter(item => item.scope !== "WORKSPACE" && !item.serverId && !keys.has(`${item.name}\0${item.prompt}`))];
}

export function createAssistantSkill(input: {
  readonly description?: string;
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly now: string;
  readonly scope?: "PERSONAL" | "WORKSPACE";
}): AssistantSkill | null {
  const name = input.name.trim().slice(0, MAX_NAME_LENGTH);
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!name || !prompt) return null;
  return {
    id: input.id,
    name,
    description: (input.description?.trim() || prompt.slice(0, 96)).slice(
      0,
      MAX_DESCRIPTION_LENGTH,
    ),
    prompt,
    ...(input.scope ? { scope: input.scope } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

