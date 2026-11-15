import {
  canvasCreationDraftSchema,
  type CanvasCreation,
  type CanvasCreationDraft,
} from "@fashion/shared";

export interface AssistantCreationContext {
  canvasObservation?: import("@fashion/shared").AssistantCanvasObservation;
  focusCreationId: string | null;
  focusCreationRevision?: number;
}

/** Apply only the saved connection delta; text and references edited while waiting remain local. */
export function mergeAssistantConnectionDraft(
  local: CanvasCreationDraft,
  baseline: CanvasCreationDraft,
  saved: CanvasCreationDraft,
): CanvasCreationDraft {
  const baseIds = new Set(baseline.inputs.map((input) => input.id));
  const removed = new Set(
    baseline.inputs
      .filter((input) => !saved.inputs.some((next) => next.id === input.id))
      .map((input) => input.id),
  );
  const inputs = local.inputs
    .filter((input) => !removed.has(input.id))
    .map((input) => {
      const previous = baseline.inputs.find((base) => base.id === input.id);
      return previous && JSON.stringify(input) === JSON.stringify(previous)
        ? (saved.inputs.find((next) => next.id === input.id) ?? input)
        : input;
    });
  const keys = new Set(inputs.map((input) => input.creationId ?? input.nodeId));
  for (const input of saved.inputs)
    if (!baseIds.has(input.id) && !keys.has(input.creationId ?? input.nodeId)) {
      inputs.push(input);
      keys.add(input.creationId ?? input.nodeId);
    }
  if (inputs.length > 16)
    throw new Error(
      "连接已保存，但期间新增的本机引用合并后超过16项。当前草稿已保留，请核对引用后继续确认。",
    );
  const previous = baseline as Record<string, unknown>,
    current = local as Record<string, unknown>;
  const changes = Object.fromEntries(
    [...new Set([...Object.keys(previous), ...Object.keys(current)])]
      .filter(
        (key) =>
          key !== "inputs" &&
          key !== "basedOnInputId" &&
          JSON.stringify(previous[key]) !== JSON.stringify(current[key]),
      )
      .map((key) => [key, current[key]]),
  );
  const basedOn =
    local.basedOnInputId === baseline.basedOnInputId
      ? saved.basedOnInputId
      : local.basedOnInputId;
  const basedOnInputId =
    basedOn && inputs.some((input) => input.id === basedOn) ? basedOn : null;
  return canvasCreationDraftSchema.parse({
    ...saved,
    ...changes,
    inputs,
    basedOnInputId,
  });
}

/** Save the clicked snapshot only. Later edits stay in the composer; no run/creation operation is available here. */
export async function syncAssistantCreationDraft(input: {
  target: CanvasCreation;
  draft: CanvasCreationDraft;
  revision: number | undefined;
  canEdit: boolean;
  assertCurrent: () => void;
  flush: () => Promise<void>;
  save: (
    draft: CanvasCreationDraft,
    revision: number,
  ) => Promise<CanvasCreation>;
  accepted: (saved: CanvasCreation) => Promise<void>;
}): Promise<AssistantCreationContext> {
  input.assertCurrent();
  const draft = canvasCreationDraftSchema.parse(input.draft);
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(canvasCreationDraftSchema.parse(input.target.draft));
  if (dirty && !input.canEdit)
    throw new Error("当前创作要求尚未保存且没有编辑权限，未发送给助手。");
  await input.flush();
  input.assertCurrent();
  const saved = dirty
    ? await input.save(draft, input.revision ?? input.target.revision)
    : input.target;
  input.assertCurrent();
  if (
    saved.removed ||
    saved.id !== input.target.id ||
    saved.projectId !== input.target.projectId ||
    JSON.stringify(canvasCreationDraftSchema.parse(saved.draft)) !==
      JSON.stringify(draft)
  )
    throw new Error("创作要求或引用已变化，请核对当前草稿后再发送。");
  if (dirty) await input.accepted(saved);
  input.assertCurrent();
  return { focusCreationId: saved.id, focusCreationRevision: saved.revision };
}
