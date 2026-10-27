"use client";
import { discardWorkspaceDrafts, flushWorkspaceDrafts } from "../../components/drafts/draft-repository";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  ImagePreview,
  Input,
  Notice,
} from "../../components/ui";
import { ActionBar } from "../../components/workspace-ui";
import {
  HISTORY_POSITION,
  navigationPosition,
  registerNavigationGuard,
  registerTraversalGuard,
} from "../navigation";
import styles from "./studio.module.css";
import { useStudioAssetName } from "./studio-object-context";
import { userFacingError } from "../../components/user-facing-error";
import { PresentationPreview as AssetPreview } from "./PresentationGallery";
import type { SubmitFeedbackSnapshot } from "../../components/interactions/use-submit-feedback";
import choiceStyles from "../../components/choice-controls.module.css";

export interface StudioAsset {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly name?: string;
}

/** The same searchable image picker used by multi-image fields, with native form validation. */
export function AssetSelect({ assets, value, onValueChange, label = "选择设计图片", ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue" | "onChange" | "children" | "multiple"> & {
  readonly assets: readonly StudioAsset[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly label?: string;
}) {
  const proxy = useRef<HTMLSelectElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [invalid, setInvalid] = useState(false);
  return <div ref={container} id={props.id} role="group" data-asset-select aria-label={props["aria-label"] ?? label} data-invalid={invalid || props["aria-invalid"]} aria-describedby={props["aria-describedby"]}>
    <AssetPicker assets={assets} selected={assets.some(asset => asset.id === value) ? [value] : []}
      label={props["aria-label"] ?? label} max={1} compact selectionPreview={false} disabled={Boolean(props.disabled)}
      onChange={(ids) => { if (!proxy.current?.matches(":disabled")) { setInvalid(false); onValueChange(ids[0] ?? ""); } }} />
    <select {...props} id={props.id ? `${props.id}-value` : undefined} aria-label={undefined} aria-labelledby={undefined} ref={proxy} value={assets.some(asset => asset.id === value) ? value : ""} aria-hidden="true" tabIndex={-1} className={choiceStyles.formValue}
      onChange={(event) => onValueChange(event.currentTarget.value)} onInvalid={(event) => {
        event.preventDefault(); setInvalid(true); container.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); props.onInvalid?.(event);
      }}>
      <option value="">请选择图片</option>
      {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.id}</option>)}
    </select>
    {invalid ? <small role="alert" className={choiceStyles.error}>请选择图片后再提交。</small> : null}
  </div>;
}
export function errorMessage(error: unknown): string {
  return userFacingError(error);
}

export function AssetPicker({
  assets,
  selected,
  onChange,
  max = 1,
  label = "选择设计图片",
  disabled = false,
  compact = false,
  selectionPreview = true,
}: {
  readonly assets: readonly StudioAsset[];
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly max?: number;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly selectionPreview?: boolean;
}) {
  const [limit, setLimit] = useState(false);
  const [preview, setPreview] = useState<StudioAsset | null>(null);
  const [previewSource, setPreviewSource] = useState<HTMLElement | null>(null);
  const [previewKeyboard, setPreviewKeyboard] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const assetName = useStudioAssetName();
  const nameOf = (id: string) => assets.find(asset => asset.id === id)?.name ?? assetName(id);
  const visibleAssets = (
    selected.length && (max === 1 || selected.length > 4)
      ? assets.filter((asset) => selected.includes(asset.id))
      : assets
  ).slice(0, 4);
  const toggle = (
    id: string,
    ids: readonly string[],
    change: (ids: string[]) => void,
  ) => {
    if (ids.includes(id)) {
      change(ids.filter((value) => value !== id));
      setLimit(false);
    } else if (ids.length < max) {
      change([...ids, id]);
      setLimit(false);
    } else if (max === 1) {
      change([id]);
      setLimit(false);
    } else setLimit(true);
  };
  const choices = (
    items: readonly StudioAsset[],
    ids: readonly string[],
    change: (ids: string[]) => void,
  ) => (
    <div
      className={`${styles.materialGrid} ${styles.pickerGrid} ${compact ? styles.materialCompact : ""}`}
    >
      {items.map((asset) => (
        <article className={styles.materialCard} key={asset.id}>
          <button
            aria-label={"选择图片 " + (assets.indexOf(asset) + 1)}
            title={nameOf(asset.id)}
            aria-pressed={ids.includes(asset.id)}
            className={styles.assetButton}
            disabled={disabled}
            onClick={() => toggle(asset.id, ids, change)}
            type="button"
          >
            <span className={styles.assetImage}>
              <ImagePreview
                retryable={false}
                src={asset.thumbnailUrl ?? asset.url}
                alt={nameOf(asset.id)}
              />
            </span>
            <span className={styles.assetLabel}>{nameOf(asset.id)}</span>
            <span className={styles.selectionLabel}>
              {ids.includes(asset.id)
                ? `已选 第 ${ids.indexOf(asset.id) + 1} 张`
                : "选择图片"}
            </span>
          </button>
          <Button
            variant="ghost"
            size="small"
            aria-label={`查看大图：${nameOf(asset.id)}`}
            onClick={(event) => { setPreviewKeyboard(event.detail === 0); setPreviewSource(event.currentTarget.closest("article")?.querySelector("img") ?? event.currentTarget); setPreview(asset); }}
          >
            查看大图
          </Button>
        </article>
      ))}
    </div>
  );
  return (
    <div className={styles.stack}>
      <div className={styles.recordHeader}>
        <strong>{label}</strong>
        <small className={styles.muted}>
          {selected.length} / {max}
        </small>
      </div>
      {assets.length ? (
        <Button
          disabled={disabled}
          onClick={() => {
            setDraft([...selected]);
            setSearch("");
            setLimit(false);
            setBrowsing(true);
          }}
        >
          {selected.length ? "更换或添加图片" : "浏览全部图片"} {" "}
          {assets.length}
        </Button>
      ) : null}
      {assets.length ? (
        selected.length && !selectionPreview ? (
          <div className={styles.selectedAssetSummary}>
            {visibleAssets.map((asset) => (
              <Button
                key={asset.id}
                variant="ghost"
                onClick={(event) => { setPreviewKeyboard(event.detail === 0); setPreviewSource(event.currentTarget); setPreview(asset); }}
                aria-label={`查看大图：${nameOf(asset.id)}`}
              >
                {nameOf(asset.id)} 查看大图
              </Button>
            ))}
          </div>
        ) : (
          choices(visibleAssets, selected, onChange)
        )
      ) : (
        <p className={styles.note}>
          还没有设计图片。先从任务入口上传草图或在画布生成候选。
        </p>
      )}
      {limit ? (
        <Notice tone="error">最多选择 {max} 张，请先取消一张。</Notice>
      ) : null}
      {browsing ? (
        <Dialog
          label={label}
          className={styles.assetPickerDialog}
          onClose={() => {
            setBrowsing(false);
            setLimit(false);
          }}
        >
          <div className={styles.recordHeader}>
            <h2>{label}</h2>
            <Button onClick={() => setBrowsing(false)}>关闭</Button>
          </div>
          <Input
            aria-label="搜索设计图片"
            placeholder="按图片或款式名称搜索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <p className={styles.muted} role="status">
            已选 {draft.length} / {max} 张，确认后应用到当前资料。
          </p>
          {choices(
            assets.filter((asset) =>
              nameOf(asset.id)
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase()),
            ),
            draft,
            setDraft,
          )}
          {!assets.some((asset) =>
            nameOf(asset.id)
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          ) ? (
            <p>没有匹配的图片，请调整搜索。</p>
          ) : null}
          {limit ? (
            <Notice tone="error">最多选择 {max} 张，请先取消一张。</Notice>
          ) : null}
          <div className={styles.pickerActions}>
            <Button onClick={() => setBrowsing(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={disabled}
              onClick={() => {
                onChange(draft);
                setBrowsing(false);
                setLimit(false);
              }}
            >
              确认选择 {draft.length} 张
            </Button>
          </div>
        </Dialog>
      ) : null}
      {preview ? (
        <AssetPreview
          name={nameOf(preview.id)}
          src={preview.url}
          sourceElement={previewSource}
          keyboardOpened={previewKeyboard}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

export function SaveBar({
  busy,
  dirty,
  canEdit = true,
  children,
  formId,
  primary = true,
  label = "保存修订",
  error,
  isNew = false,
  hint,
  feedback,
  feedbackAction = "save",
  interaction = "ripple",
}: {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly canEdit?: boolean;
  readonly children?: ReactNode;
  readonly formId?: string;
  readonly primary?: boolean;
  readonly label?: string;
  readonly error?: ReactNode;
  readonly isNew?: boolean;
  readonly hint?: ReactNode;
  readonly feedback?: SubmitFeedbackSnapshot | undefined;
  readonly feedbackAction?: string;
  readonly interaction?: "ripple" | "spring";
}) {
  return (
    <ActionBar
      status={
        <div className={styles.saveStatus}>
          <span role="status">
            {busy
              ? "正在保存…"
              : !canEdit
                ? "只读资料"
                : dirty
                  ? "有未保存的修改"
                  : isNew
                    ? "新资料尚未保存"
                    : "已保存"}
          </span>
          {hint ? <span className={styles.muted}>{hint}</span> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
      }
      secondary={children}
    >
      <Button
        type="submit"
        form={formId}
        interaction={interaction}
        variant={primary ? "primary" : "secondary"}
        loading={busy}
        feedback={feedback}
        feedbackAction={feedbackAction}
        disabled={!canEdit || (!dirty && !isNew)}
      >
        {busy ? "正在保存…" : label}
      </Button>
    </ActionBar>
  );
}

export function useStudioLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const resolveRef = useRef<((leave: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const confirmLeave = async (): Promise<boolean> => {
    await flushWorkspaceDrafts();
    if (!dirtyRef.current) return true;
    setOpen(true);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  };
  useEffect(() => {
    let leaving = false;
    let restoring = false;
    let permitted = false;
    let traversal = 0;
    const ask = async () => {
      if (!dirtyRef.current) return;
      setOpen(true);
      const leave = await new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
      if (!leave) throw new Error("保留未保存内容");
      dirtyRef.current = false;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const unregister = registerNavigationGuard(ask);
    const click = (event: MouseEvent) => {
      if (
        !dirtyRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href, location.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (leaving) return;
      leaving = true;
      void ask()
        .then(() => router.push(url.pathname + url.search + url.hash))
        .catch(() => undefined)
        .finally(() => {
          leaving = false;
        });
    };
    const popstate = (event: PopStateEvent) => {
      if (permitted) {
        permitted = false;
        return;
      }
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        void ask()
          .then(() => {
            permitted = true;
            history.go(-traversal);
          })
          .catch(() => {
            leaving = false;
          });
        return;
      }
      if (!dirtyRef.current) return;
      event.stopImmediatePropagation();
      if (leaving) return;
      traversal =
        navigationPosition() - Number(event.state?.[HISTORY_POSITION] ?? 0);
      if (!traversal) return;
      leaving = true;
      restoring = true;
      history.go(traversal);
    };
    const untraverse = registerTraversalGuard(popstate);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      unregister();
      untraverse();
      resolveRef.current?.(false);
    };
  }, [router]);
  const dialog = open ? (
    <Dialog
      label="保留未保存的修改"
      className={styles.unsavedDialog}
      onClose={() => {
        resolveRef.current?.(false);
        setOpen(false);
      }}
    >
      <div className={styles.section}>
        <h2>当前内容尚未保存</h2>
        <p>继续离开会丢弃这次表单修改。</p>
        <div className={styles.toolbar}>
          <Button
            onClick={() => {
              resolveRef.current?.(false);
              setOpen(false);
            }}
          >
            继续编辑
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await discardWorkspaceDrafts();
              resolveRef.current?.(true);
              setOpen(false);
            }}
          >
            丢弃并离开
          </Button>
        </div>
      </div>
    </Dialog>
  ) : null;
  return { confirmLeave, dialog };
}
