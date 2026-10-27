"use client";

import { useSubmitFeedback } from "../../components/interactions/use-submit-feedback";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为真实款式位置与当前编辑对象；状态统计和历史为次级。保存为主操作，网格不引入排序行为。 */

import { useState } from "react";
import type {
  StudioDocumentInput,
  StudioDocumentView,
  StudioSummary,
} from "@fashion/shared";
import {
  Button,
  Field,
  Input,
  ImagePreview,
  Notice,
  Select,
  Textarea,
} from "../../components/ui";
import { createCollection } from "../board/generation/collection-api";
import { saveStudioDocument } from "./studio-api";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { SaveBar } from "./studio-ui";
import styles from "./studio.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";
import { StudioCount } from "./StudioCount";

type Slot = Extract<
  StudioDocumentInput,
  { type: "COLLECTION_SLOT" }
>["payload"];
const roles = { HERO: "主推款", CORE: "基础款", EXPERIMENTAL: "实验款" };
const states = {
  PLANNED: "待设计",
  DESIGNING: "设计中",
  REVIEW: "待评审",
  DONE: "已完成",
};

export function PlanningBoard(
  props: StudioPanelProps & { readonly data: StudioSummary },
) {
  const feedback = useSubmitFeedback();
  const beforeChange = async () => {
    const allowed = await props.beforeChange();
    if (allowed) feedback.reset();
    return allowed;
  };
  const [id, setId] = useState<string | null>(props.data.slots[0]?.id ?? null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [collectionId, setCollectionId] = useState(
    (props.data.slots[0]?.currentRevision.payload as Slot | undefined)
      ?.collectionId ??
      props.data.collections[0]?.id ??
      "",
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = props.data.slots.find((slot) => slot.id === id);
  const closeEditor = () => {
    setEditorOpen(false);
    requestAnimationFrame(() =>
      document
        .getElementById(`studio-slot-${id}`)
        ?.focus({ preventScroll: true }),
    );
  };
  return (
    <div className={styles.section}>
      <StudioPageHeader
        title={
          props.data.collections.find(
            (collection) => collection.id === collectionId,
          )?.name ?? "建立设计系列"
        }
        type="系列规划"
        description="安排款式位置，查看系列中的角色与进度"
        actions={
          <Button
            disabled={!props.canEdit}
            onClick={() =>
              void (async () => {
                if (await beforeChange()) {
                  setId(null);
                  setEditorOpen(true);
                  setDraftVersion((current) => current + 1);
                }
              })()
            }
          >
            新增计划位置
          </Button>
        }
      />
      {props.data.collections.length ? (
        <div className={styles.summary}>
          {Object.entries(states).map(([value, label]) => (
            <div key={value}>
              <strong>
                <StudioCount value={
                  props.data.slots.filter(
                    (slot) =>
                      (slot.currentRevision.payload as Slot).status === value &&
                      (!collectionId ||
                        (slot.currentRevision.payload as Slot).collectionId ===
                          collectionId),
                  ).length
                } />
              </strong>
              <small>{label}</small>
            </div>
          ))}
        </div>
      ) : null}
      {!props.data.collections.length ? (
        <div className={styles.planningStart}>
          {props.data.assets[0] ? (
            <span className={styles.assetImage}>
              <ImagePreview
                src={props.data.assets[0].url}
                alt="建立系列使用的第一张设计图"
              />
            </span>
          ) : null}
          <div>
            <h3>从核心设计图建立系列</h3>
            <p>
              以项目第一张设计图为起点，再安排品类、主推款与基础款位置。创建后可关联明确的款式修订。
            </p>
            <Button
              disabled={!props.canEdit || !props.data.assets.length}
              loading={creating}
              onClick={() => {
                const asset = props.data.assets[0];
                if (!asset) return;
                setCreating(true);
                setError(null);
                void createCollection(asset.id)
                  .then(props.onSaved)
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : "系列创建失败",
                    ),
                  )
                  .finally(() => setCreating(false));
              }}
            >
              用第一张设计图建立系列
            </Button>
            {error ? <Notice tone="error">{error}</Notice> : null}
          </div>
        </div>
      ) : null}
      <div
        className={styles.planningWorkspace}
        data-editing={editorOpen || undefined}
      >
        {props.data.collections.length > 1 ? (
          <Field label="当前系列">
            <Select searchable
              value={collectionId}
              onChange={(event) => {
                const value = event.target.value;
                void (async () => {
                  if (await beforeChange()) {
                    setCollectionId(value);
                    setId(
                      props.data.slots.find(
                        (slot) =>
                          (slot.currentRevision.payload as Slot)
                            .collectionId === value,
                      )?.id ?? null,
                    );
                    setEditorOpen(false);
                  }
                })();
              }}
            >
              {props.data.collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <aside className={styles.planningGrid} aria-label="系列款式位置">
          {props.data.slots
            .filter(
              (slot) =>
                !collectionId ||
                (slot.currentRevision.payload as Slot).collectionId ===
                  collectionId,
            )
            .map((slot) => {
              const payload = slot.currentRevision.payload as Slot;
              return (
                <button
                  type="button"
                  className={styles.planningCard}
                  key={slot.id}
                  id={`studio-slot-${slot.id}`}
                  aria-pressed={id === slot.id}
                  onClick={() =>
                    void (async () => {
                      if (slot.id === id || (await beforeChange())) {
                        setId(slot.id);
                        setEditorOpen(true);
                      }
                    })()
                  }
                >
                  <span className={styles.assetImage}>
                    <ImagePreview
                      retryable={false}
                      src={
                        props.data.styles
                          .flatMap((style) => style.revisions)
                          .find(
                            (revision) =>
                              revision.id === payload.styleRevisionId,
                          )?.views[0]?.url
                      }
                      alt={
                        payload.styleRevisionId ? "计划款式" : "待补款式位置"
                      }
                    />
                  </span>
                  <strong>{payload.name}</strong>
                  <small>
                    {roles[payload.role]} · {states[payload.status]}
                  </small>
                  {id === slot.id && editorOpen ? (
                    <small className={styles.currentPosition}>
                      正在编辑此位置
                    </small>
                  ) : null}
                </button>
              );
            })}
        </aside>
        <StudioEditSection
          title="编辑系列位置"
          open={editorOpen}
          onOpenChange={(next) => (next ? setEditorOpen(true) : closeEditor())}
          hideTrigger
        >
          <section className={styles.slotEditor}>
            <h3>
              {existing
                ? (existing.currentRevision.payload as Slot).name
                : "新系列位置"}
            </h3>
            <Button
              variant="ghost"
              onClick={() => {
                closeEditor();
              }}
            >
              关闭位置编辑
            </Button>
            <SlotEditor
              key={
                (existing?.id ?? "new") +
                ":" +
                (existing?.version ?? 0) +
                ":" +
                draftVersion
              }
              {...props}
          feedback={feedback}
          beforeChange={beforeChange}
              existing={existing}
              onCreated={setId}
              collectionId={collectionId}
            />
          </section>
        </StudioEditSection>
        {!editorOpen && props.data.collections.length > 0 ? (
          <p className={styles.muted}>
            选择一个款式位置进行编辑，或新增计划位置。
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SlotEditor({
  projectId,
  data,
  existing,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  feedback,
  onCreated,
  collectionId,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioDocumentView | undefined;
  readonly onCreated: (id: string) => void;
  readonly collectionId: string;
}) {
  const initial: Slot = existing
    ? (existing.currentRevision.payload as Slot)
    : {
        name: "",
        collectionId: collectionId || data.collections[0]?.id || "",
        category: "",
        role: "CORE",
        status: "PLANNED",
        notes: "",
      };
  const form = useStudioForm(initial, onDirty, { feedback });
  const { draft, setDraft } = form;
  const update = <K extends keyof Slot>(key: K, value: Slot[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    let id = "";
    if (
      await form.submit(async (key) => {
        const saved = await saveStudioDocument(
          projectId,
          { type: "COLLECTION_SLOT", payload: draft },
          key,
          existing,
        );
        id = saved.id;
      })
    ) {
      await onSaved();
      onCreated(id);
    }
  };
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {form.error ? (
        <Notice tone="error">
          {form.error}
          {form.conflict ? (
            <Button
              onClick={() =>
                void (async () => {
                  if (await beforeChange()) await onSaved();
                })()
              }
            >
              重新载入
            </Button>
          ) : null}
        </Notice>
      ) : null}
      <fieldset
        className={styles.form}
        disabled={!canEdit || form.busy || !data.collections.length}
      >
        <Field label="位置名称">
          <Input
            required
            value={draft.name}
            maxLength={120}
            onChange={(event) => update("name", event.target.value)}
            placeholder="例如：轻薄外套主推款"
          />
        </Field>
        <div className={styles.formGrid}>
          <Field label="所属系列">
            <Select searchable
              required
              value={draft.collectionId}
              onChange={(event) => update("collectionId", event.target.value)}
            >
              <option value="">选择系列</option>
              {data.collections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="品类">
            <Input
              value={draft.category}
              required
              onChange={(event) => update("category", event.target.value)}
            />
          </Field>
          <Field label="角色">
            <Select
              value={draft.role}
              onChange={(event) =>
                update("role", event.target.value as Slot["role"])
              }
            >
              {Object.entries(roles).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="进度">
            <Select
              value={draft.status}
              onChange={(event) =>
                update("status", event.target.value as Slot["status"])
              }
            >
              {Object.entries(states).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="关联款式修订"
          hint="绑定明确修订，后续款式修改不会改变本计划记录。"
        >
          <Select searchable
            value={draft.styleRevisionId ?? ""}
            onChange={(event) =>
              setDraft((current) => {
                const next = { ...current };
                if (event.target.value)
                  next.styleRevisionId = event.target.value;
                else delete next.styleRevisionId;
                return next;
              })
            }
          >
            <option value="">尚未选款</option>
            {data.styles.flatMap((style) =>
              style.revisions.map((revision) => (
                <option value={revision.id} key={revision.id}>
                  {style.code} · {revision.payload.name} · r{revision.revision}
                </option>
              )),
            )}
          </Select>
        </Field>
        <Field label="设计要求和缺口说明">
          <Textarea
            rows={4}
            value={draft.notes}
            maxLength={2000}
            onChange={(event) => update("notes", event.target.value)}
          />
        </Field>
      </fieldset>
      <SaveBar
        feedback={feedback?.snapshot}
        busy={form.busy}
        dirty={form.dirty}
        isNew={!existing}
        canEdit={canEdit && !!data.collections.length}
      />
    </form>
  );
}
