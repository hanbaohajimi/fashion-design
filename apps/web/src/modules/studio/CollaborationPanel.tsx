"use client";

import { AssetSelect } from "./studio-ui";

import { BoundStyleContext } from "./studio-object-context";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为确切修订的图片、意见与审批；成员管理移入次级页签。保留两份草稿，动作服从原权限。 */

import { useCallback, useEffect, useId, useState } from "react";
import type {
  StudioDocumentInput,
  StudioMemberView,
  StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  Dialog,
  Field,
  ImagePreview,
  Input,
  Notice,
  Select,
  Tabs,
  TabPanel,
  Textarea,
} from "../../components/ui";
import {
  removeMember,
  saveMember,
  saveStudioDocument,
  updateMember,
} from "./studio-api";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { AssetAnchor } from "./AssetAnchor";
import { errorMessage } from "./studio-ui";
import styles from "./studio.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";

type MemberRole = "EDITOR" | "REVIEWER" | "VIEWER";
type Comment = Extract<StudioDocumentInput, { type: "COMMENT" }>["payload"];
type Review = Extract<StudioDocumentInput, { type: "REVIEW" }>["payload"];
const ROLE_LABELS = {
  OWNER: "所有者",
  EDITOR: "编辑",
  REVIEWER: "评审",
  VIEWER: "只读",
};

export function CollaborationPanel(
  props: StudioPanelProps & { readonly data: StudioSummary },
) {
  const { onDirty } = props;
  const [memberDirty, setMemberDirty] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [section, setSection] = useState<"review" | "members">("review");
  const [sectionChanged, setSectionChanged] = useState(false);
  const tabsId = useId();
  const onMemberDirty = useCallback(
    (dirty: boolean) => setMemberDirty(dirty),
    [],
  );
  const onReviewDirty = useCallback(
    (dirty: boolean) => setReviewDirty(dirty),
    [],
  );
  useEffect(() => {
    onDirty(memberDirty || reviewDirty);
  }, [memberDirty, reviewDirty, onDirty]);
  return (
    <div className={styles.section}>
      <StudioPageHeader
        title="团队评审"
        description="批注与审批绑定明确修订，后续修改需要重新评审"
        actions={
          <Tabs
            animated
            id={tabsId}
            label="团队工作"
            value={section}
            options={[
              { value: "review", label: "修订评审" },
              { value: "members", label: "成员管理" },
            ]}
            onChange={(next) => { if (next !== section) { setSectionChanged(true); setSection(next); } }}
          />
        }
      />
      <TabPanel
        tabsId={tabsId}
        value="review"
        activeValue={section}
        keepMounted
        className={sectionChanged ? styles.shortPanel : undefined}
      >
        <ReviewForm {...props} onDirty={onReviewDirty} />
      </TabPanel>
      <TabPanel
        tabsId={tabsId}
        value="members"
        activeValue={section}
        keepMounted
        className={sectionChanged ? styles.shortPanel : undefined}
      >
        <MemberManager {...props} onDirty={onMemberDirty} />
      </TabPanel>
    </div>
  );
}

function MemberManager({
  data,
  projectId,
  onDirty,
  onSaved,
}: StudioPanelProps & { readonly data: StudioSummary }) {
  const initial = { email: "", role: "EDITOR" as MemberRole };
  const form = useStudioForm(initial, onDirty);
  const add = async () => {
    if (
      await form.submit((key) =>
        saveMember(projectId, form.draft.email, form.draft.role, key),
      )
    ) {
      form.reset(initial);
      await onSaved();
    }
  };
  return (
    <section className={styles.section}>
      <div className={styles.recordHeader}>
        <h3>工作区成员</h3>
        <Badge>{ROLE_LABELS[data.role]}</Badge>
      </div>
      <p className={styles.muted}>
        成员权限作用于此项目所属工作区的设计资料。成员需要先注册账户。
      </p>
      <div className={styles.list}>
        {data.members.map((member) => (
          <MemberRow
            key={member.id + ":" + member.version}
            member={member}
            projectId={projectId}
            canManage={data.capabilities.manageMembers}
            onSaved={onSaved}
          />
        ))}
      </div>
      {data.capabilities.manageMembers ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <div className={styles.formGrid}>
            <Field label="已注册成员邮箱">
              <Input
                type="email"
                required
                maxLength={254}
                value={form.draft.email}
                onChange={(event) =>
                  form.setDraft((draft) => ({
                    ...draft,
                    email: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="权限角色">
              <Select
                value={form.draft.role}
                onChange={(event) =>
                  form.setDraft((draft) => ({
                    ...draft,
                    role: event.target.value as MemberRole,
                  }))
                }
              >
                <option value="EDITOR">编辑</option>
                <option value="REVIEWER">评审</option>
                <option value="VIEWER">只读</option>
              </Select>
            </Field>
          </div>
          {form.error ? <Notice tone="error">{form.error}</Notice> : null}
          <div>
            <Button loading={form.busy} type="submit">
              添加工作区成员
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function MemberRow({
  projectId,
  member,
  canManage,
  onSaved,
}: {
  readonly projectId: string;
  readonly member: StudioMemberView;
  readonly canManage: boolean;
  readonly onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onSaved();
      setRemoveOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={styles.record}>
      <div className={styles.recordHeader}>
        <strong>{member.email}</strong>
        <div className={styles.row}>
          {canManage && member.role !== "OWNER" ? (
            <>
              <Select
                aria-label={member.email + " 的权限"}
                value={member.role}
                disabled={busy}
                onChange={(event) =>
                  void act(() =>
                    updateMember(
                      projectId,
                      member,
                      event.target.value as MemberRole,
                      crypto.randomUUID(),
                    ),
                  )
                }
              >
                <option value="EDITOR">编辑</option>
                <option value="REVIEWER">评审</option>
                <option value="VIEWER">只读</option>
              </Select>
              <Button
                disabled={busy}
                size="small"
                variant="ghost"
                onClick={() => setRemoveOpen(true)}
              >
                移除
              </Button>
            </>
          ) : (
            <Badge>{ROLE_LABELS[member.role]}</Badge>
          )}
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {removeOpen ? (
        <Dialog
          label="移除工作区成员"
          onClose={() => {
            if (!busy) setRemoveOpen(false);
          }}
        >
          <div className={styles.section}>
            <h3>移除 {member.email}</h3>
            <p>此成员将无法继续访问工作区的私有资料。</p>
            <div className={styles.toolbar}>
              <Button disabled={busy} onClick={() => setRemoveOpen(false)}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() =>
                  void act(() =>
                    removeMember(projectId, member, crypto.randomUUID()),
                  )
                }
              >
                确认移除
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </article>
  );
}

interface ReviewDraft {
  targetType: "STYLE" | "TECH_PACK";
  targetRevisionId: string;
  text: string;
  anchored: boolean;
  assetId: string;
  x: number;
  y: number;
}
function ReviewForm({
  projectId,
  data,
  onDirty,
  onSaved,
}: StudioPanelProps & { readonly data: StudioSummary }) {
  const initial: ReviewDraft = {
    targetType: "STYLE",
    targetRevisionId: data.styles[0]?.currentRevision.id ?? "",
    text: "",
    anchored: false,
    assetId: "",
    x: 0.5,
    y: 0.5,
  };
  const form = useStudioForm(initial, onDirty);
  const { draft, setDraft } = form;
  const [reviewMode, setReviewMode] = useState<"comment" | "decision">(
    data.capabilities.edit ? "comment" : "decision",
  );
  const targetOptions =
    draft.targetType === "STYLE"
      ? data.styles.flatMap((style) =>
          style.revisions.map((revision) => ({
            id: revision.id,
            label:
              style.code +
              " · " +
              revision.payload.name +
              " · r" +
              revision.revision,
          })),
        )
      : data.techPacks.flatMap((pack) =>
          pack.revisions.map((revision) => ({
            id: revision.id,
            label: revision.payload.name + " · r" + revision.revision,
          })),
        );
  const styleRevision = data.styles
    .flatMap((style) => style.revisions)
    .find((revision) => revision.id === draft.targetRevisionId);
  const packRevision = data.techPacks
    .flatMap((pack) => pack.revisions)
    .find((revision) => revision.id === draft.targetRevisionId);
  const viewAssetId =
    draft.targetType === "STYLE"
      ? styleRevision?.views[0]?.assetId
      : (packRevision?.payload as { views?: { assetId: string }[] } | undefined)
          ?.views?.[0]?.assetId;
  const previewUrl = data.assets.find((asset) => asset.id === viewAssetId)?.url;
  const post = async (decision?: Review["decision"]) => {
    const payload: Comment | Review = decision
      ? {
          name: "修订评审",
          targetType: draft.targetType,
          targetRevisionId: draft.targetRevisionId,
          text: draft.text,
          decision,
        }
      : {
          name: "修订批注",
          targetType: draft.targetType,
          targetRevisionId: draft.targetRevisionId,
          text: draft.text,
          ...(draft.anchored
            ? { assetId: draft.assetId, x: draft.x, y: draft.y }
            : {}),
        };
    if (!draft.text.trim() || !draft.targetRevisionId) {
      form.setError("请选择修订并填写评审意见。");
      return;
    }
    if (
      await form.submit((key) =>
        saveStudioDocument(
          projectId,
          { type: decision ? "REVIEW" : "COMMENT", payload },
          key + (decision ?? "-comment"),
        ),
      )
    ) {
      form.reset({ ...draft, text: "", anchored: false });
      await onSaved();
    }
  };
  const comments = data.comments.filter(
    (item) =>
      (item.currentRevision.payload as Comment).targetRevisionId ===
      draft.targetRevisionId,
  );
  const reviews = data.reviews.filter(
    (item) =>
      (item.currentRevision.payload as Review).targetRevisionId ===
      draft.targetRevisionId,
  );
  return (
    <section className={styles.section}>
      <BoundStyleContext
        data={data}
        revisionId={
          draft.targetType === "STYLE"
            ? draft.targetRevisionId
            : packRevision && "styleRevisionId" in packRevision.payload
              ? (packRevision.payload.styleRevisionId ?? "")
              : ""
        }
      />
      <StudioEditSection
        persistent
        title="切换评审对象"
        summary={
          targetOptions.find((item) => item.id === draft.targetRevisionId)
            ?.label ?? "选择需要评审的修订"
        }
        defaultOpen={!draft.targetRevisionId}
      >
        <div className={styles.reviewTarget}>
          <Field label="资料类型">
            <Select
              value={draft.targetType}
              onChange={(event) => {
                const targetType = event.target
                  .value as ReviewDraft["targetType"];
                setDraft((current) => ({
                  ...current,
                  targetType,
                  targetRevisionId:
                    targetType === "STYLE"
                      ? (data.styles[0]?.currentRevision.id ?? "")
                      : (data.techPacks[0]?.currentRevision.id ?? ""),
                  assetId: "",
                  anchored: false,
                }));
              }}
            >
              <option value="STYLE">款式</option>
              <option value="TECH_PACK">技术包</option>
            </Select>
          </Field>
          <Field label="被评审修订">
            <Select
              value={draft.targetRevisionId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  targetRevisionId: event.target.value,
                  anchored: false,
                  assetId: "",
                }))
              }
            >
              <option value="">选择修订</option>
              {targetOptions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </StudioEditSection>
      <div className={styles.reviewWorkspace}>
        <div className={styles.reviewImage}>
          {previewUrl ? (
            <ImagePreview src={previewUrl} alt="被评审修订的关联视图" />
          ) : (
            <p className={styles.muted}>选择有视图的修订后在此预览。</p>
          )}
        </div>
        <div className={styles.section}>
          <div className={styles.history} aria-label="当前修订的讨论与决定">
            <div className={styles.recordHeader}>
              <h3>修订记录</h3>
              <small className={styles.muted}>
                {comments.length} 条批注 · {reviews.length} 项决定
              </small>
            </div>
            {reviews.map((item) => {
              const review = item.currentRevision.payload as Review;
              return (
                <article key={item.id}>
                  <Badge
                    tone={
                      review.decision === "APPROVED" ? "success" : "warning"
                    }
                  >
                    {review.decision === "APPROVED"
                      ? "此修订已批准"
                      : "要求修改"}
                  </Badge>
                  <p>{review.text}</p>
                  <small className={styles.muted}>
                    {new Date(item.currentRevision.createdAt).toLocaleString(
                      "zh-CN",
                    )}
                  </small>
                </article>
              );
            })}
            {comments.map((item) => {
              const comment = item.currentRevision.payload as Comment;
              return (
                <article key={item.id}>
                  <p>{comment.text}</p>
                  {comment.assetId ? (
                    <small className={styles.muted}>
                      图片 {comment.assetId.slice(0, 12)} ·{" "}
                      {Math.round((comment.x ?? 0) * 100)}% /{" "}
                      {Math.round((comment.y ?? 0) * 100)}%
                    </small>
                  ) : null}
                  <small className={styles.muted}>
                    {new Date(item.currentRevision.createdAt).toLocaleString(
                      "zh-CN",
                    )}
                  </small>
                </article>
              );
            })}
            {!comments.length && !reviews.length ? (
              <p className={styles.muted}>
                {draft.targetRevisionId
                  ? "此修订还没有批注和评审记录。"
                  : "先选择已保存修订，再提交批注或审批。"}
              </p>
            ) : null}
          </div>
          {data.capabilities.edit || data.capabilities.review ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void post();
              }}
            >
              {form.error ? <Notice tone="error">{form.error}</Notice> : null}
              <Field label="评审意见">
                <Textarea
                  required
                  value={draft.text}
                  maxLength={2000}
                  rows={4}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      text: event.target.value,
                    }))
                  }
                />
              </Field>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.anchored}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      anchored: event.target.checked,
                      assetId: current.assetId || data.assets[0]?.id || "",
                    }))
                  }
                />
                为批注关联图片位置
              </label>
              {draft.anchored ? (
                <>
                  <Field label="批注图片">
                    <AssetSelect
                      value={draft.assetId}
                      required
                      onValueChange={(assetId) =>
                        setDraft((current) => ({
                          ...current,
                          assetId: assetId,
                          x: 0.5,
                          y: 0.5,
                        }))
                      }
                     assets={data.assets} />
                  </Field>
                  {draft.assetId ? (
                    <AssetAnchor
                      label="批注位置"
                      url={
                        data.assets.find((asset) => asset.id === draft.assetId)
                          ?.url ?? ""
                      }
                      x={draft.x}
                      y={draft.y}
                      onPoint={(x, y) =>
                        setDraft((current) => ({ ...current, x, y }))
                      }
                    />
                  ) : null}
                </>
              ) : null}
              {data.capabilities.edit && data.capabilities.review ? (
                <div className={styles.toolbar} aria-label="评审操作模式">
                  <Button
                    aria-pressed={reviewMode === "comment"}
                    onClick={() => setReviewMode("comment")}
                  >
                    编辑批注
                  </Button>
                  <Button
                    aria-pressed={reviewMode === "decision"}
                    onClick={() => setReviewMode("decision")}
                  >
                    审批修订
                  </Button>
                </div>
              ) : null}
              <div className={styles.toolbar}>
                <Button
                  type="submit"
                  variant={reviewMode === "comment" ? "primary" : "secondary"}
                  loading={form.busy}
                  disabled={!draft.targetRevisionId}
                >
                  提交批注
                </Button>
                {data.capabilities.review ? (
                  <>
                    <Button
                      variant={
                        reviewMode === "decision" ? "primary" : "secondary"
                      }
                      loading={form.busy}
                      disabled={!draft.targetRevisionId}
                      onClick={() => void post("APPROVED")}
                    >
                      批准此修订
                    </Button>
                    <Button
                      loading={form.busy}
                      disabled={!draft.targetRevisionId}
                      onClick={() => void post("CHANGES_REQUESTED")}
                    >
                      要求修改
                    </Button>
                  </>
                ) : null}
              </div>
            </form>
          ) : (
            <Notice>当前为只读权限，可查看设计资料与评审记录。</Notice>
          )}
        </div>
      </div>
    </section>
  );
}
