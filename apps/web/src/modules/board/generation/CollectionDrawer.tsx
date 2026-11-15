"use client";

import { Select } from "../../../components/ui";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Dialog, Tabs, TabPanel } from "../../../components/ui";
import controls from "../../../components/ui.module.css";

import {
  fetchCollection,
  fetchCollectionConsistency,
  updateCollection,
  updateCollectionDna,
} from "./collection-api";
import type {
  CollectionConsistency,
  CollectionDetail,
  CollectionDna,
  GarmentType,
} from "./collection-types";
import { GARMENT_TYPE_OPTIONS } from "./collection-types";
import { DNACard } from "./DNACard";
import { ExportModal } from "./ExportModal";
import styles from "./generation.module.css";
import { LookGrid } from "./LookGrid";
import { MotionReceipt } from "../../../components/motion/MotionReceipt";
import { flushWorkspaceDrafts, registerDraftFlush } from "../../../components/drafts/draft-repository";
import { CollectionPlanning } from "../../studio/CollectionPlanning";

type SaveState = "error" | "saved" | "saving" | "unsaved";
export type CollectionTab = "dna" | "planning" | "looks";

export function CollectionDrawer({
  collectionId,
  onClose,
  embedded = false,
  canEdit = true,
  onRecord,
  initialTab = "dna",
  onDirty,
  onPlanningSaved,
}: {
  readonly collectionId: string;
  readonly onClose: () => void;
  readonly embedded?: boolean;
  readonly canEdit?: boolean;
  readonly onRecord?: (() => void | Promise<void>) | undefined;
  readonly initialTab?: CollectionTab;
  readonly onDirty?: ((dirty: boolean) => void) | undefined;
  readonly onPlanningSaved?: (() => Promise<unknown>) | undefined;
}) {
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [consistency, setConsistency] = useState<CollectionConsistency | null>(
    null,
  );
  const [draft, setDraft] = useState<CollectionDna | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [consistencyError, setConsistencyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [loadingConsistency, setLoadingConsistency] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [tab, setTab] = useState<CollectionTab>(initialTab);
  const [planningVisited, setPlanningVisited] = useState(initialTab === "planning");
  const [exportOpen, setExportOpen] = useState(false);
  const [failedHeroUrl, setFailedHeroUrl] = useState("");
  const lastSaved = useRef("");
  const draftRef = useRef<CollectionDna | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const tabsId = useId();
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const collectionRequestId = useRef(0);
  const consistencyRequestId = useRef(0);

  const enqueueSave = useCallback(
    (snapshot: CollectionDna): Promise<void> => {
      if (!canEdit) return Promise.resolve();
      const payload = {
        fabrics: snapshot.fabrics,
        locks: snapshot.locks,
        moodWords: snapshot.moodWords,
        palette: snapshot.palette,
        referenceFileIds: snapshot.referenceFileIds,
        signatureDetails: snapshot.signatureDetails,
        silhouettes: snapshot.silhouettes,
      };
      setSaveState("saving");
      setSaveError(null);
      const operation = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await updateCollectionDna(collectionId, payload);
          lastSaved.current = dnaSignature(saved);
          if (dnaSignature(draftRef.current) === dnaSignature(snapshot)) {
            draftRef.current = saved;
            setDraft(saved);
            setSaveState("saved");
            setSaveError(null);
          }
        })
        .catch((reason: unknown) => {
          setSaveState("error");
          setSaveError(
            reason instanceof Error ? reason.message : "DNA 自动保存失败",
          );
          throw reason;
        });
      saveQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [canEdit, collectionId],
  );

  const flushDna = useCallback(async (): Promise<void> => {
    const current = draftRef.current;
    if (current && dnaSignature(current) !== lastSaved.current) {
      await enqueueSave(current);
    } else {
      await saveQueue.current;
    }
  }, [enqueueSave]);

  useEffect(() => registerDraftFlush(flushDna), [flushDna]);

  const closeAfterSave = useCallback(async (): Promise<void> => {
    try {
      await flushDna();
      await flushWorkspaceDrafts();
    } catch {
      setSaveError("当前修改尚未保存，请重试关闭或切换系列。");
      return;
    }
    onClose();
  }, [flushDna, onClose]);

  const closeExport = (): void => {
    setExportOpen(false);
    window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
  };

  const loadCollection = useCallback(async (): Promise<CollectionDetail> => {
    const requestId = ++collectionRequestId.current;
    setLoadingCollection(true);
    setCollectionError(null);
    try {
      const result = await fetchCollection(collectionId);
      if (!mountedRef.current || requestId !== collectionRequestId.current) {
        return result;
      }
      const signature = dnaSignature(result.dna);
      lastSaved.current = signature;
      draftRef.current = result.dna;
      setCollection(result);
      setDraft(result.dna);
      return result;
    } catch (reason) {
      if (mountedRef.current && requestId === collectionRequestId.current) {
        setCollectionError(
          reason instanceof Error ? reason.message : "系列 DNA 读取失败",
        );
      }
      throw reason;
    } finally {
      if (mountedRef.current && requestId === collectionRequestId.current) {
        setLoadingCollection(false);
      }
    }
  }, [collectionId]);

  const refreshConsistency = useCallback(async () => {
    const requestId = ++consistencyRequestId.current;
    setLoadingConsistency(true);
    setConsistencyError(null);
    try {
      const result = await fetchCollectionConsistency(collectionId);
      if (!mountedRef.current || requestId !== consistencyRequestId.current) {
        return result;
      }
      setConsistency(result);
      return result;
    } catch (reason) {
      if (mountedRef.current && requestId === consistencyRequestId.current) {
        setConsistencyError(
          reason instanceof Error ? reason.message : "系列状态读取失败",
        );
      }
      throw reason;
    } finally {
      if (mountedRef.current && requestId === consistencyRequestId.current) {
        setLoadingConsistency(false);
      }
    }
  }, [collectionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      collectionRequestId.current += 1;
      consistencyRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadCollection().catch(() => undefined);
      void refreshConsistency().catch(() => undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadCollection, refreshConsistency]);

  useEffect(() => {
    draftRef.current = draft;
    if (!draft) return;
    const signature = dnaSignature(draft);
    if (signature === lastSaved.current) return;
    setSaveState("unsaved");

    const timer = window.setTimeout(() => {
      void enqueueSave(draft).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, enqueueSave]);

  const heroImageUrl = collection
    ? (collection.hero.thumbnailUrl ?? collection.hero.url)
    : "";

  const saveSourceGarmentType = async (
    sourceGarmentType: GarmentType | null,
  ): Promise<void> => {
    if (!canEdit) return;
    setSourceSaving(true);
    setSourceError(null);
    try {
      const updated = await updateCollection(collectionId, sourceGarmentType);
      if (mountedRef.current) setCollection(updated);
    } catch (reason) {
      if (mountedRef.current) {
        setSourceError(
          reason instanceof Error ? reason.message : "核心款类型保存失败",
        );
      }
      throw reason;
    } finally {
      if (mountedRef.current) setSourceSaving(false);
    }
  };

  return (
    <CollectionSurface embedded={embedded}
      label={exportOpen ? "导出成果" : "系列工作台"}
      className={`${styles.collectionDrawer} ${controls.controlSurface} ${exportOpen ? styles.collectionExport : ""}`}
      onClose={() => void closeAfterSave()}
    >
      <div className={styles.collectionContents} hidden={exportOpen}>
      <div className={styles.collectionNavigation}>
      <header className={styles.collectionHeader}>
        <div>
          <strong title={collection?.name}>{collection ? <MotionReceipt receiptKey={`collection:${collectionId}`}>{collection.name}</MotionReceipt> : "正在读取系列"}</strong>
        </div>
        <div>
          <SaveIndicator state={saveState} />
          <button
            disabled={!collection}
            onClick={() => setExportOpen(true)}
            ref={exportTriggerRef}
            type="button"
          >
            导出 PDF
          </button>
          <button
            aria-label={embedded ? "切换系列" : "关闭系列工作台"}
            onClick={() => void closeAfterSave()}
            type="button"
          >
            {embedded ? "切换系列" : "关闭"}
          </button>
        </div>
      </header>

      {collection ? (
        <Tabs<CollectionTab> id={tabsId} label="系列工作区" className={styles.collectionTabs} value={tab} onChange={(next) => {
          if (next === "planning") setPlanningVisited(true);
          setTab(next);
        }} options={[{ value: "dna", label: "设计方向" }, { value: "planning", label: "款式规划" }, { value: "looks", label: "系列扩展" }]} />
      ) : null}
      </div>

      {!collection && !collectionError ? (
        <div className={styles.collectionSkeleton} aria-label="正在加载 DNA">
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : collectionError && !draft ? (
        <div className={styles.collectionError} role="alert">
          <strong>DNA 暂时无法打开</strong>
          <p>{collectionError}</p>
          <button
            disabled={loadingCollection}
            onClick={() => void loadCollection().catch(() => undefined)}
            type="button"
          >
            {loadingCollection ? "重新读取中…" : "重新读取"}
          </button>
        </div>
      ) : collection && draft ? (
        <>
          {saveError ? (
            <div className={styles.collectionInlineError} role="alert">
              <span>{saveError}</span>
              <button
                disabled={saveState === "saving"}
                onClick={() => void flushDna().catch(() => undefined)}
                type="button"
              >
                {saveState === "saving" ? "重试中…" : "重试保存"}
              </button>
            </div>
          ) : null}
          {consistencyError && tab === "looks" ? (
            <div className={styles.collectionInlineError} role="alert">
              <span>系列状态读取失败</span>
              <button
                aria-label="重新读取系列状态"
                disabled={loadingConsistency}
                onClick={() => void refreshConsistency().catch(() => undefined)}
                type="button"
              >
                {loadingConsistency ? "读取中…" : "重新读取"}
              </button>
            </div>
          ) : null}
            <TabPanel tabsId={tabsId} value="dna" activeValue={tab} keepMounted>
              <section className={styles.collectionHero}>
                <figure>
                  {heroImageUrl && failedHeroUrl !== heroImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt="系列 Hero Look"
                      onError={() => setFailedHeroUrl(heroImageUrl)}
                      src={heroImageUrl}
                    />
                  ) : (
                    <div
                      aria-label="系列 Hero 预览暂不可用"
                      className={styles.collectionHeroFallback}
                      role="img"
                    >
                      <span>核心款</span>
                      <small>预览暂不可用</small>
                    </div>
                  )}
                </figure>
                <div>
                  <strong>系列原点</strong>
                  {draft.extractionStatus === "failed" ? (
                    <p>自动提取未完成，可直接定义系列 DNA。</p>
                  ) : null}
                </div>
              </section>
              <SourceGarmentTypeEditor
                disabled={sourceSaving || !canEdit}
                error={sourceError}
                key={`${collection.sourceGarmentType?.code ?? "unspecified"}:${collection.sourceGarmentType?.label ?? ""}`}
                onSave={saveSourceGarmentType}
                value={collection.sourceGarmentType}
              />
              <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}><DNACard
                dna={draft}
                onChange={(next) => {
                  setSaveError(null);
                  setDraft(next);
                }}
              /></fieldset>
            </TabPanel>
            <TabPanel tabsId={tabsId} value="planning" activeValue={tab} keepMounted className={styles.collectionPlanning}>
              {planningVisited ? <CollectionPlanning key={`${collection.projectId}:${collectionId}`} projectId={collection.projectId}
                collectionId={collectionId} canEdit={canEdit} onDirty={onDirty} onSaved={onPlanningSaved} /> : null}
            </TabPanel>
            <TabPanel tabsId={tabsId} value="looks" activeValue={tab} keepMounted>
            {consistency ? (
            <LookGrid
              beforeGenerate={flushDna}
              collectionId={collectionId}
              consistency={consistency}
              onRefresh={refreshConsistency}
              sourceGarmentType={collection.sourceGarmentType}
              canEdit={canEdit}
              onSubmitted={onRecord}
            />
          ) : (
            <div
              className={styles.collectionSkeleton}
              aria-label="正在加载系列 Look"
            >
              <i />
              <i />
              <i />
            </div>
            )}
            </TabPanel>
        </>
      ) : null}
      </div>
      {exportOpen && collection ? (
        <ExportModal embedded
          onBack={closeExport}
          onClose={() => void closeAfterSave()}
          source={{
            collectionId,
            name: collection.name,
            previewUrl: collection.hero.thumbnailUrl ?? collection.hero.url,
            type: "collection",
          }}
        />
      ) : null}
    </CollectionSurface>
  );
}

function CollectionSurface({ embedded, children, label, className, onClose }: { embedded: boolean; children: ReactNode; label: string; className: string; onClose: () => void }) {
  return embedded ? <section aria-label={label} className={className} style={{ position: "relative", inset: "auto", width: "100%", height: "auto", maxHeight: "none", overflow: "visible", border: 0, boxShadow: "none" }}>{children}</section> : <Dialog label={label} className={className} onClose={onClose}>{children}</Dialog>;
}

function SaveIndicator({ state }: { readonly state: SaveState }) {
  const label = {
    error: "保存失败",
    saved: "已保存",
    saving: "保存中",
    unsaved: "待保存",
  }[state];
  return (
    <span className={styles.saveIndicator} data-state={state} role="status">
      <i />
      {label}
    </span>
  );
}

function dnaSignature(dna: CollectionDna | null): string {
  if (!dna) return "";
  return JSON.stringify({
    fabrics: dna.fabrics,
    locks: dna.locks,
    moodWords: dna.moodWords,
    palette: dna.palette,
    referenceFileIds: dna.referenceFileIds,
    signatureDetails: dna.signatureDetails,
    silhouettes: dna.silhouettes,
  });
}

function SourceGarmentTypeEditor({
  disabled,
  error,
  onSave,
  value,
}: {
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onSave: (value: GarmentType | null) => Promise<void>;
  readonly value: GarmentType | null;
}) {
  const [code, setCode] = useState(value?.code ?? "");
  const [customLabel, setCustomLabel] = useState(
    value?.code === "custom" ? value.label : "",
  );

  return (
    <section className={styles.sourceGarmentEditor}>
      <header>
        <h3>核心款类型</h3>
      </header>
      <div>
        <label>
          <Select
            aria-label="服装类型"
            disabled={disabled}
            onChange={(event) => {
              const nextCode = event.target.value;
              setCode(nextCode);
              if (!nextCode) {
                void onSave(null).catch(() => undefined);
                return;
              }
              const option = GARMENT_TYPE_OPTIONS.find(
                (item) => item.code === nextCode,
              );
              if (option && option.code !== "custom") {
                void onSave(option).catch(() => undefined);
              }
            }}
            value={code}
          >
            <option value="">未指定</option>
            {GARMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        {code === "custom" ? (
          <label>
            <input
              aria-label="自定义类型"
              disabled={disabled}
              maxLength={64}
              onBlur={() => {
                const label = customLabel.trim();
                if (label) {
                  void onSave({ code: "custom", label }).catch(() => undefined);
                }
              }}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="输入团队使用的服装类型"
              value={customLabel}
            />
          </label>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
