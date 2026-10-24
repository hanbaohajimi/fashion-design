"use client";

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
  const [id, setId] = useState<string | null>(props.data.slots[0]?.id ?? null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = props.data.slots.find((slot) => slot.id === id);
  return (
    <div className={styles.section}>
      <div className={styles.recordHeader}>
        <div>
          <h2>系列规划</h2>
          <p className={styles.muted}>
            给每个品类安排位置，用已保存的款式修订填补设计缺口。
          </p>
        </div>
        <Button
          disabled={!props.canEdit}
          onClick={() =>
            void (async () => {
              if (await props.beforeChange()) {
                setId(null);
                setDraftVersion((current) => current + 1);
              }
            })()
          }
        >
          新增计划位置
        </Button>
      </div>
      <div className={styles.summary}>
        {Object.entries(states).map(([value, label]) => (
          <div key={value}>
            <strong>
              {
                props.data.slots.filter(
                  (slot) =>
                    (slot.currentRevision.payload as Slot).status === value,
                ).length
              }
            </strong>
            <small>{label}</small>
          </div>
        ))}
      </div>
      {!props.data.collections.length ? (
        <div className={styles.note}>
          <p>先从一张核心设计图建立系列，再安排品类和款式位置。</p>
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
      ) : null}
      <div className={styles.split}>
        <aside className={styles.planningGrid} aria-label="系列款式位置">
          {props.data.slots.map((slot) => {
            const payload = slot.currentRevision.payload as Slot;
            return (
              <button
                type="button"
                className={styles.planningCard}
                key={slot.id}
                aria-pressed={id === slot.id}
                onClick={() =>
                  void (async () => {
                    if (await props.beforeChange()) setId(slot.id);
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
                          (revision) => revision.id === payload.styleRevisionId,
                        )?.views[0]?.url
                    }
                    alt={payload.styleRevisionId ? "计划款式" : "待补款式位置"}
                  />
                </span>
                <strong>{payload.name}</strong>
                <small>
                  {roles[payload.role]} · {states[payload.status]}
                </small>
              </button>
            );
          })}
        </aside>
        <SlotEditor
          key={
            (existing?.id ?? "new") +
            ":" +
            (existing?.version ?? 0) +
            ":" +
            draftVersion
          }
          {...props}
          existing={existing}
          onCreated={setId}
        />
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
  onCreated,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioDocumentView | undefined;
  readonly onCreated: (id: string) => void;
}) {
  const initial: Slot = existing
    ? (existing.currentRevision.payload as Slot)
    : {
        name: "",
        collectionId: data.collections[0]?.id ?? "",
        category: "",
        role: "CORE",
        status: "PLANNED",
        notes: "",
      };
  const form = useStudioForm(initial, onDirty);
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
            <Select
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
          <Select
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
        busy={form.busy}
        dirty={form.dirty || !existing}
        canEdit={canEdit && !!data.collections.length}
      />
    </form>
  );
}
