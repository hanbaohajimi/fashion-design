import { canvasCommandSchema, type CanvasCommand } from "@fashion/shared";
import {
  draftRepository,
  type DraftRecord,
} from "../../../components/drafts/draft-repository";
import { privateRequestSignal } from "../../auth/private-fetch";
import {
  completeUpload,
  fetchUploadedFile,
  imageMimeType,
  putOriginal,
  sha256Hex,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../file-upload-api";
import { isRejectedCanvasCommand, runCanvasCommand } from "./canvas-api";

type ImportCommand = Extract<CanvasCommand, { type: "import_reference_image" }>;
export type AssistantImageImportResult = Awaited<
  ReturnType<typeof runCanvasCommand>
>;
export type AttachmentStage =
  | "queued"
  | "signing"
  | "uploading"
  | "processing"
  | "importing"
  | "referencing"
  | "failed"
  | "canceled"
  | "needs_file"
  | "waiting";
interface SavedUpload {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  order?: number;
  sha256?: string;
  fileId?: string;
  uploaded?: boolean;
  command?: ImportCommand;
}
export interface AssistantImageUploadItem {
  id: string;
  name: string;
  stage: AttachmentStage;
  preview?: string;
  progress?: number;
  error?: string;
}
interface Entry {
  data: SavedUpload;
  record?: DraftRecord<SavedUpload>;
  file?: File;
  preview?: string;
  controller?: AbortController;
  admission?: Promise<void>;
  running?: Promise<void>;
  removed?: boolean;
}
export interface ImageUploadContext {
  accountId: string;
  projectId: string;
  editor: string;
  conversationId: string;
}
export interface ImageUploadActions {
  enabled: boolean;
  slots: number;
  checkpointDraft?: () => Promise<void>;
  beforeImport: (signal: AbortSignal) => Promise<void>;
  apply: (
    result: AssistantImageImportResult,
    signal: AbortSignal,
  ) => Promise<void>;
  reference: (
    result: AssistantImageImportResult,
    signal: AbortSignal,
  ) => Promise<void>;
}
interface QueueState {
  ready: boolean;
  items: readonly AssistantImageUploadItem[];
  error: string | null;
}
const working = new Set<AttachmentStage>([
  "queued",
  "signing",
  "uploading",
  "processing",
  "importing",
  "referencing",
]);
export const attachmentIsWorking = (item: AssistantImageUploadItem) =>
  working.has(item.stage);
const uploadScope = (context: ImageUploadContext) =>
  `${JSON.stringify([context.accountId, context.projectId, context.editor, "assistant-image-uploads", context.conversationId || "new"])}:`;

function validSaved(value: unknown): value is SavedUpload {
  if (!value || typeof value !== "object") return false;
  const item = value as SavedUpload;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    !item.name ||
    !Number.isFinite(item.size) ||
    item.size < 1 ||
    typeof item.mimeType !== "string"
  )
    return false;
  if (item.sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(item.sha256))
    return false;
  if (
    item.order !== undefined &&
    (!Number.isSafeInteger(item.order) || item.order < 0)
  )
    return false;
  if (
    item.fileId !== undefined &&
    (typeof item.fileId !== "string" || !item.fileId)
  )
    return false;
  if (item.command) {
    const command = canvasCommandSchema.safeParse(item.command);
    if (
      !command.success ||
      command.data.type !== "import_reference_image" ||
      command.data.fileId !== item.fileId ||
      command.data.mutationId !== item.id
    )
      return false;
  }
  return true;
}

/** One conversation owns its selected files and durable import receipts. No model runs here. */
export class AssistantImageUploadQueue {
  private state: QueueState = { ready: false, items: [], error: null };
  private listeners = new Set<() => void>();
  private entries = new Map<string, Entry>();
  private serial = Promise.resolve();
  private epoch = 0;
  private active = false;
  private nextOrder = Date.now() * 1000;
  private progressFrame: number | undefined;
  readonly prefix: string;
  constructor(
    readonly context: ImageUploadContext,
    private actions: () => ImageUploadActions,
  ) {
    this.prefix = uploadScope(context);
  }
  configure(actions: ImageUploadActions) {
    this.actions = () => actions;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private publish(change: Partial<QueueState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private update(
    entry: Entry,
    stage: AttachmentStage,
    error?: string,
    progress?: number,
  ) {
    if (!this.entries.has(entry.data.id) || entry.removed) return;
    const item: AssistantImageUploadItem = {
      id: entry.data.id,
      name: entry.data.name,
      stage,
      ...(entry.preview
        ? { preview: entry.preview }
        : entry.data.fileId && entry.data.uploaded
          ? {
              preview: `/api/files/${encodeURIComponent(entry.data.fileId)}/thumbnail/256`,
            }
          : {}),
      ...(error ? { error } : {}),
      ...(progress !== undefined ? { progress } : {}),
    };
    const known = this.state.items.some((value) => value.id === item.id);
    this.publish({
      items: known
        ? this.state.items.map((value) => (value.id === item.id ? item : value))
        : [...this.state.items, item],
    });
  }
  async activate() {
    this.active = true;
    const epoch = ++this.epoch;
    this.serial = Promise.resolve();
    this.publish({ ready: false, items: [], error: null });
    try {
      const records = await draftRepository.list<SavedUpload>(this.prefix);
      if (!this.active || epoch !== this.epoch) return;
      for (const record of records.sort(
        (a, b) =>
          (a.value?.order ?? a.updatedAt) - (b.value?.order ?? b.updatedAt) ||
          a.key.localeCompare(b.key),
      )) {
        if (
          !validSaved(record.value) ||
          record.key !== `${this.prefix}${record.value.id}` ||
          record.accountId !== this.context.accountId
        )
          throw new Error(
            "上次图片准备记录暂时无法读取，请保留当前页面后重试。",
          );
        const entry: Entry = { data: record.value, record };
        this.entries.set(entry.data.id, entry);
        this.update(
          entry,
          entry.data.uploaded || entry.data.command ? "waiting" : "needs_file",
        );
        this.nextOrder = Math.max(this.nextOrder, entry.data.order ?? 0);
      }
      this.publish({ ready: true });
    } catch (cause) {
      if (epoch === this.epoch)
        this.publish({
          error:
            cause instanceof Error ? cause.message : "上次图片记录读取失败。",
        });
    }
  }
  deactivate() {
    this.active = false;
    this.epoch++;
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      if (entry.preview) URL.revokeObjectURL(entry.preview);
    }
    this.entries.clear();
    if (this.progressFrame !== undefined)
      cancelAnimationFrame(this.progressFrame);
    this.progressFrame = undefined;
  }
  clearError = () => this.publish({ error: null });
  reload = () => {
    this.deactivate();
    return this.activate();
  };
  private async save(entry: Entry) {
    if (!this.active || entry.removed)
      throw new DOMException("对话已切换", "AbortError");
    const record = await draftRepository.write(
      {
        key: `${this.prefix}${entry.data.id}`,
        accountId: this.context.accountId,
        baseline: "null",
        value: entry.data,
      },
      entry.record?.revision ?? 0,
      { preserveConflict: false },
    );
    entry.record = record;
  }
  async add(files: readonly File[]) {
    if (!this.active || !this.state.ready || !this.actions().enabled) {
      this.publish({ error: "当前对话暂时不能添加图片，请稍后重试。" });
      return;
    }
    if (!files.length) return;
    const invalid = files
      .map(
        (file) =>
          validateImage(file) ??
          (file.size ? null : "图片内容为空，请重新选择。"),
      )
      .find(Boolean);
    if (invalid) {
      this.publish({ error: invalid });
      return;
    }
    if (files.length + this.state.items.length > this.actions().slots) {
      this.publish({ error: "合并后超过 16 项引用，请先移除部分附件或引用。" });
      return;
    }
    const fingerprints = new Set(
      [...this.entries.values()]
        .filter((entry) => entry.file)
        .map(
          (entry) =>
            `${entry.file?.name}:${entry.file?.size}:${entry.file?.lastModified}:${entry.file?.type}`,
        ),
    );
    for (const file of files) {
      const id = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
      if (fingerprints.has(id)) {
        this.publish({ error: "这张图片已在准备中，请先完成或移除原附件。" });
        return;
      }
      fingerprints.add(id);
    }
    this.publish({ error: null });
    for (const file of files) {
      const entry: Entry = {
        data: {
          id: crypto.randomUUID(),
          name: file.name || "粘贴图片.png",
          size: file.size,
          mimeType: imageMimeType(file),
          order: ++this.nextOrder,
        },
        file,
      };
      if (
        ["image/jpeg", "image/png", "image/webp"].includes(imageMimeType(file))
      )
        entry.preview = URL.createObjectURL(file);
      this.entries.set(entry.data.id, entry);
      this.update(entry, "queued");
      entry.admission = this.save(entry);
      void entry.admission.catch(() => {});
      this.enqueue(entry);
    }
  }
  private enqueue(entry: Entry) {
    if (
      entry.running ||
      entry.removed ||
      this.entries.get(entry.data.id) !== entry
    )
      return;
    const epoch = this.epoch;
    const controller = new AbortController();
    entry.controller = controller;
    const signal = privateRequestSignal(controller.signal);
    const live = () =>
      this.active && epoch === this.epoch && !signal.aborted && !entry.removed;
    const work = this.serial
      .catch(() => undefined)
      .then(async () => {
        if (!live()) return;
        try {
          if (!this.actions().enabled)
            throw new Error(
              "当前对话暂时不可添加图片，内容仍保留。请稍后继续。",
            );
          await this.actions().checkpointDraft?.();
          signal.throwIfAborted();
          await entry.admission;
          if (!entry.data.sha256) {
            if (!entry.file) throw new Error("请重新选择原图片后继续。");
            entry.data.sha256 = await sha256Hex(entry.file);
            signal.throwIfAborted();
          }
          if (
            entry.record?.value.sha256 !== entry.data.sha256 ||
            entry.record?.value.uploaded !== entry.data.uploaded
          ) {
            await this.save(entry);
            signal.throwIfAborted();
          }
          let restoredFile =
            entry.data.uploaded && !entry.data.command && entry.data.fileId
              ? await fetchUploadedFile(entry.data.fileId, signal)
              : undefined;
          signal.throwIfAborted();
          if (restoredFile?.status === "FAILED") {
            entry.data.uploaded = false;
            await this.save(entry);
            signal.throwIfAborted();
            if (!entry.file) {
              this.update(
                entry,
                "needs_file",
                "图片处理未完成，请重新选择原图片后重试。",
              );
              return;
            }
            restoredFile = undefined;
          }
          if (!entry.data.uploaded && !entry.data.command) {
            if (!entry.file) {
              this.update(
                entry,
                "needs_file",
                "原文件尚未上传完成，请重新选择同一张图片。",
              );
              return;
            }
            this.update(entry, "signing");
            const signed = await signImageUpload(
              this.context.projectId,
              entry.file,
              signal,
            );
            signal.throwIfAborted();
            entry.data.fileId = signed.file.id;
            await this.save(entry);
            signal.throwIfAborted();
            if (signed.upload) {
              this.update(entry, "uploading");
              await putOriginal(signed.upload, entry.file, {
                signal,
                onProgress: (value) => {
                  if (!live()) return;
                  const progress =
                    value.lengthComputable && value.total > 0
                      ? Math.min(1, value.loaded / value.total)
                      : undefined;
                  if (this.progressFrame !== undefined)
                    cancelAnimationFrame(this.progressFrame);
                  this.progressFrame = requestAnimationFrame(() => {
                    this.progressFrame = undefined;
                    if (live())
                      this.update(entry, "uploading", undefined, progress);
                  });
                },
              });
              if (this.progressFrame !== undefined)
                cancelAnimationFrame(this.progressFrame);
              this.progressFrame = undefined;
            }
            entry.data.uploaded = true;
            await this.save(entry);
            signal.throwIfAborted();
            this.update(entry, "processing");
            const initial =
              signed.upload || signed.file.status === "PENDING"
                ? await completeUpload(signed.file.id, signal)
                : signed.file;
            await waitForThumbnail(signed.file.id, initial, 60_000, signal);
          } else if (!entry.data.command) {
            this.update(entry, "processing");
            if (!entry.data.fileId)
              throw new Error("图片准备记录不完整，请移除后重新选择。");
            let initial =
              restoredFile ??
              (await fetchUploadedFile(entry.data.fileId, signal));
            if (initial.status === "PENDING" || initial.status === "PROCESSING")
              initial = await completeUpload(entry.data.fileId, signal);
            await waitForThumbnail(entry.data.fileId, initial, 60_000, signal);
          }
          signal.throwIfAborted();
          if (!this.actions().enabled)
            throw new Error(
              "当前对话暂时不可添加图片，上传结果已保留。请稍后继续。",
            );
          await this.actions().beforeImport(signal);
          signal.throwIfAborted();
          if (!entry.data.command) {
            if (!entry.data.fileId)
              throw new Error("图片记录不完整，请重新选择。");
            entry.data.command = {
              type: "import_reference_image",
              mutationId: entry.data.id,
              fileId: entry.data.fileId,
              placement: "reference",
            };
            await this.save(entry);
            signal.throwIfAborted();
          }
          this.update(entry, "importing");
          let result: AssistantImageImportResult;
          try {
            result = await runCanvasCommand(
              this.context.projectId,
              entry.data.command,
              signal,
            );
          } catch (cause) {
            if (isRejectedCanvasCommand(cause)) {
              delete entry.data.command;
              await this.save(entry);
            }
            throw cause;
          }
          if (!live()) return;
          await this.actions().apply(result, signal);
          signal.throwIfAborted();
          if (!live()) return;
          this.update(entry, "referencing");
          await this.actions().reference(result, signal);
          signal.throwIfAborted();
          if (!live()) return;
          if (entry.record)
            await draftRepository.remove(
              entry.record.key,
              entry.record.revision,
              entry.record.value,
            );
          this.entries.delete(entry.data.id);
          if (entry.preview) URL.revokeObjectURL(entry.preview);
          this.publish({
            items: this.state.items.filter((item) => item.id !== entry.data.id),
          });
        } catch (cause) {
          if (!this.active || epoch !== this.epoch || entry.removed) return;
          this.update(
            entry,
            signal.aborted ? "canceled" : "failed",
            signal.aborted
              ? undefined
              : cause instanceof Error
                ? cause.message
                : "图片准备尚未完成，请继续原操作。",
          );
        }
      })
      .finally(() => {
        if (entry.running === work) delete entry.running;
      });
    entry.running = work;
    this.serial = work;
  }
  retry = (id: string) => {
    const entry = this.entries.get(id);
    if (!entry || !this.actions().enabled) return;
    if (!entry.record) {
      entry.admission = this.save(entry);
      void entry.admission.catch(() => {});
    }
    this.update(entry, "queued");
    if (entry.running)
      void entry.running.then(() => {
        if (this.active && !entry.removed) this.enqueue(entry);
      });
    else this.enqueue(entry);
  };
  cancel = (id: string) => {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.controller?.abort();
    this.update(entry, "canceled");
  };
  async remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.removed = true;
    entry.controller?.abort();
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    this.entries.delete(id);
    this.publish({ items: this.state.items.filter((item) => item.id !== id) });
    await entry.running;
    await entry.admission?.catch(() => {});
    try {
      if (entry.record)
        await draftRepository.remove(
          entry.record.key,
          entry.record.revision,
          entry.record.value,
        );
    } catch {
      this.publish({
        error:
          "附件已从本页移除，本机记录暂未清除。刷新后如再次出现，可重新移除。",
      });
    }
  }
  async reselect(id: string, file: File) {
    const entry = this.entries.get(id);
    if (!entry || !this.actions().enabled) return;
    const epoch = this.epoch;
    const invalid = validateImage(file);
    if (invalid) {
      this.publish({ error: invalid });
      return;
    }
    let hash: string;
    try {
      hash = await sha256Hex(file);
    } catch {
      if (
        this.active &&
        epoch === this.epoch &&
        this.entries.get(id) === entry &&
        !entry.removed
      )
        this.publish({ error: "暂时无法读取所选图片，请重新选择原文件。" });
      return;
    }
    if (
      !this.active ||
      epoch !== this.epoch ||
      this.entries.get(id) !== entry ||
      entry.removed
    )
      return;
    if (
      entry.data.sha256
        ? hash !== entry.data.sha256
        : file.name !== entry.data.name ||
          file.size !== entry.data.size ||
          imageMimeType(file) !== entry.data.mimeType
    ) {
      this.publish({
        error: "所选文件与原图片不同，请选择原文件，或移除附件后重新上传。",
      });
      return;
    }
    entry.file = file;
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    if (["image/jpeg", "image/png", "image/webp"].includes(imageMimeType(file)))
      entry.preview = URL.createObjectURL(file);
    this.publish({ error: null });
    this.update(entry, "queued");
    this.enqueue(entry);
  }
}
