import {
  createStudioStyleSchema,
  updateStudioStyleSchema,
  studioDocumentInputSchema,
  type StudioDocumentInput,
  type StudioDocumentView,
  type StudioStyleView,
  type StudioTechPack,
} from "@fashion/shared";
import {
  DraftConflict,
  draftRepository,
  serializeDraft,
  type DraftRecord,
} from "../../components/drafts/draft-repository";
import { createTechPackDraft } from "./tech-pack-draft";

export type StudioSaveOperation =
  | {
      kind: "style";
      styleId?: string;
      input:
        | ReturnType<typeof createStudioStyleSchema.parse>
        | ReturnType<typeof updateStudioStyleSchema.parse>;
    }
  | { kind: "document"; input: StudioDocumentInput };

export interface StudioSaveContext {
  accountId: string;
  projectId: string;
  editor: string;
  objectKey: string;
  draft: unknown;
  isActive: () => boolean;
}

export interface PendingStudioSave {
  schema: 1;
  projectId: string;
  editor: string;
  objectKey: string;
  operation: StudioSaveOperation;
  draft?: { key: string; revision: number; value: unknown };
}

export const STUDIO_SAVES_CHANGED = "fashion:studio-saves-changed";
export const STUDIO_SAVE_CONFIRMED = "fashion:studio-save-confirmed";
const flights = new Map<string, Promise<unknown>>();
const forms = new Map<
  string,
  () => Promise<{ value: unknown; acknowledge: () => Promise<void> }>
>();
export function registerStudioSaveForm(
  key: string,
  capture: () => Promise<{ value: unknown; acknowledge: () => Promise<void> }>,
) {
  forms.set(key, capture);
  return () => {
    if (forms.get(key) === capture) forms.delete(key);
  };
}
const formKey = (record: DraftRecord<PendingStudioSave>) =>
  JSON.stringify([
    record.accountId,
    record.value.projectId,
    record.value.editor,
    record.value.objectKey,
  ]);
export const hasActiveStudioSaveForm = (
  record: DraftRecord<PendingStudioSave>,
) => forms.has(formKey(record));
const prefix = (accountId: string, projectId: string) =>
  `${JSON.stringify([accountId, projectId, "studio:pending"]).slice(0, -1)},`;
export const studioSaveKey = (
  scope: Pick<
    StudioSaveContext,
    "accountId" | "projectId" | "editor" | "objectKey"
  >,
) =>
  `${prefix(scope.accountId, scope.projectId)}${JSON.stringify([scope.editor, scope.objectKey]).slice(1)}`;

function announce() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(STUDIO_SAVES_CHANGED));
}

function signature(operation: StudioSaveOperation) {
  const { requestKey: _requestKey, ...input } = operation.input;
  void _requestKey;
  return JSON.stringify({ ...operation, input });
}

function checkedRecord(
  record: DraftRecord,
  accountId: string,
  projectId: string,
): DraftRecord<PendingStudioSave> {
  const value = record.value as Partial<PendingStudioSave> | null;
  if (
    record.accountId !== accountId ||
    value?.schema !== 1 ||
    value.projectId !== projectId ||
    typeof value.editor !== "string" ||
    typeof value.objectKey !== "string"
  )
    throw new Error("有一份保存记录无法读取，请保留当前页面并联系管理员。");
  if (
    record.key !==
    studioSaveKey({
      accountId,
      projectId,
      editor: value.editor,
      objectKey: value.objectKey,
    })
  )
    throw new Error("保存记录与当前项目不一致。");
  const operation = value.operation;
  if (operation?.kind === "style") {
    if (
      operation.styleId !== undefined &&
      (typeof operation.styleId !== "string" || !operation.styleId)
    )
      throw new Error("保存记录的款式信息不完整。");
    (operation.styleId
      ? updateStudioStyleSchema
      : createStudioStyleSchema
    ).parse(operation.input);
  } else if (operation?.kind === "document")
    studioDocumentInputSchema.parse(operation.input);
  else throw new Error("保存记录的操作类型无法识别。");
  if (
    value.draft &&
    (value.draft.key !==
      JSON.stringify([accountId, projectId, value.editor, value.objectKey]) ||
      !Number.isInteger(value.draft.revision) ||
      value.draft.revision < 1)
  )
    throw new Error("保存记录的草稿信息不完整。");
  return record as DraftRecord<PendingStudioSave>;
}

export async function pendingStudioSaves(accountId: string, projectId: string) {
  return (await draftRepository.list(prefix(accountId, projectId)))
    .map((record) => checkedRecord(record, accountId, projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const studioSaveInFlight = (key: string) => flights.has(key);

/** Replay only an admitted, validated operation, including its original target and expected version. */
export function confirmStudioSave<T>(
  record: DraftRecord<PendingStudioSave>,
  send: (operation: StudioSaveOperation) => Promise<T>,
): Promise<T> {
  const flight = flights.get(record.key);
  if (flight) return flight as Promise<T>;
  const work = (async () => {
    try {
      const result = await send(record.value.operation);
      // Compare the exact value as well as the revision: another tab can recreate revision 1.
      const draft = record.value.draft;
      if (draft)
        await draftRepository.remove(draft.key, draft.revision, draft.value);
      // Keep the original operation until a newer local draft is moved onto the
      // confirmed object. Otherwise a new-style form could create a second style.
      const newer = await draftRepository.read(formKey(record));
      const active = await forms.get(formKey(record))?.();
      const changed =
        active && serializeDraft(active.value) !== serializeDraft(draft?.value);
      if (!newer && !changed)
        await draftRepository.remove(record.key, record.revision, record.value);
      return result;
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? error.status
          : undefined;
      // Validation/not-found/version conflicts are definitive rejections. Connection loss,
      // server errors and expired authorization remain recoverable with the same request.
      if ([400, 404, 409, 422].includes(status as number))
        await draftRepository
          .remove(record.key, record.revision, record.value)
          .catch(() => undefined);
      throw error;
    } finally {
      flights.delete(record.key);
      announce();
    }
  })();
  flights.set(record.key, work);
  announce();
  return work;
}

export async function saveStudioOperation<T>(
  projectId: string,
  operation: StudioSaveOperation,
  context: StudioSaveContext | undefined,
  send: (operation: StudioSaveOperation) => Promise<T>,
): Promise<T> {
  // Standalone components without an authenticated workspace retain their existing API contract.
  if (!context) return send(operation);
  if (context.projectId !== projectId || !context.isActive())
    throw new Error("工作区已切换，请回到原资料继续保存。");
  const key = studioSaveKey(context);
  let record: DraftRecord<PendingStudioSave> | undefined;
  try {
    const stored = await draftRepository.read(key);
    if (stored) record = checkedRecord(stored, context.accountId, projectId);
    if (!record) {
      const draftKey = JSON.stringify([
        context.accountId,
        projectId,
        context.editor,
        context.objectKey,
      ]);
      const draft = await draftRepository.read(draftKey);
      const matches =
        draft && serializeDraft(draft.value) === serializeDraft(context.draft);
      const value: PendingStudioSave = {
        schema: 1,
        projectId,
        editor: context.editor,
        objectKey: context.objectKey,
        operation,
        ...(matches
          ? {
              draft: {
                key: draftKey,
                revision: draft.revision,
                value: draft.value,
              },
            }
          : {}),
      };
      try {
        record = await draftRepository.write(
          { key, accountId: context.accountId, baseline: "null", value },
          0,
          { preserveConflict: false },
        );
      } catch (error) {
        if (!(error instanceof DraftConflict)) throw error;
        record = checkedRecord(error.current, context.accountId, projectId);
      }
    }
  } catch {
    throw new Error(
      "尚未发送：浏览器暂时无法保留保存记录。请检查本机存储后重试，当前输入仍保留在页面中。",
    );
  }
  if (signature(record.value.operation) !== signature(operation)) {
    announce();
    throw new Error("上一份保存尚未确认。请先在上方继续确认，再保存当前修改。");
  }
  if (!context.isActive()) {
    announce();
    throw new Error("工作区已切换，原保存内容已保留，返回后可继续确认。");
  }
  return confirmStudioSave(record, send);
}

export function acknowledgeRecoveredStudioSave(
  record: DraftRecord<PendingStudioSave>,
) {
  if (typeof window !== "undefined" && record.value.draft)
    window.dispatchEvent(
      new CustomEvent(STUDIO_SAVE_CONFIRMED, { detail: record.value.draft }),
    );
}

/** Carry edits made after the interrupted save onto the confirmed object's identity. */
export async function carryStudioSaveDraft(
  record: DraftRecord<PendingStudioSave>,
  result: StudioStyleView | StudioDocumentView,
) {
  const key = formKey(record);
  const active = await forms.get(key)?.();
  const stored = await draftRepository.read(key);
  const value = active?.value ?? stored?.value;
  const original = record.value.draft?.value;
  if (
    value !== undefined &&
    serializeDraft(value) !== serializeDraft(original)
  ) {
    const targetKey = JSON.stringify([
      record.accountId,
      record.value.projectId,
      record.value.editor,
      result.id,
    ]);
    const target =
      targetKey === key ? stored : await draftRepository.read(targetKey);
    if (
      targetKey !== key &&
      target &&
      serializeDraft(target.value) !== serializeDraft(value)
    )
      throw new Error(
        "已保存资料还有另一份本机草稿。请先打开资料核对，当前修改仍已保留。",
      );
    const operation = record.value.operation;
    const payload =
      result.version > studioSaveRevision(operation)
        ? operation.kind === "style"
          ? createStudioStyleSchema
              .omit({ requestKey: true })
              .strip()
              .parse(operation.input)
          : operation.input.payload
        : result.currentRevision.payload;
    const baseline =
      operation.kind === "document" && operation.input.type === "TECH_PACK"
        ? createTechPackDraft(payload as StudioTechPack)
        : payload;
    await draftRepository.write(
      {
        key: targetKey,
        accountId: record.accountId,
        baseline: JSON.stringify(baseline),
        value,
      },
      target?.revision ?? 0,
      { preserveConflict: false },
    );
    if (active) await active.acknowledge();
    else if (stored && key !== targetKey)
      await draftRepository.remove(key, stored.revision, stored.value);
  } else if (active) await active.acknowledge();
  await draftRepository.remove(record.key, record.revision, record.value);
  announce();
}

export function studioSaveLabel(operation: StudioSaveOperation) {
  return operation.kind === "style"
    ? operation.input.name
    : operation.input.payload.name;
}

export function studioSaveRevision(operation: StudioSaveOperation) {
  return (
    ("expectedVersion" in operation.input
      ? (operation.input.expectedVersion ?? 0)
      : 0) + 1
  );
}
