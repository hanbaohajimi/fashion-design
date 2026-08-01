"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchCollection,
  fetchCollectionConsistency,
  updateCollectionDna,
} from "./collection-api";
import type {
  CollectionConsistency,
  CollectionDetail,
  CollectionDna,
} from "./collection-types";
import { ConsistencyOverview } from "./ConsistencyOverview";
import { DNACard } from "./DNACard";
import { ExportModal } from "./ExportModal";
import styles from "./generation.module.css";
import { LookGrid } from "./LookGrid";

type SaveState = "error" | "saved" | "saving" | "unsaved";
type DrawerTab = "consistency" | "dna" | "looks";

export function CollectionDrawer({
  collectionId,
  onClose,
}: {
  readonly collectionId: string;
  readonly onClose: () => void;
}) {
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [consistency, setConsistency] = useState<CollectionConsistency | null>(
    null,
  );
  const [draft, setDraft] = useState<CollectionDna | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [consistencyError, setConsistencyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [loadingConsistency, setLoadingConsistency] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [tab, setTab] = useState<DrawerTab>("dna");
  const [exportOpen, setExportOpen] = useState(false);
  const lastSaved = useRef("");
  const draftRef = useRef<CollectionDna | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const drawerRef = useRef<HTMLElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const collectionRequestId = useRef(0);
  const consistencyRequestId = useRef(0);

  const enqueueSave = useCallback(
    (snapshot: CollectionDna): Promise<void> => {
      const payload = {
        fabrics: snapshot.fabrics,
        locks: snapshot.locks,
        moodWords: snapshot.moodWords,
        palette: snapshot.palette,
        referenceFileIds: snapshot.referenceFileIds,
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
    [collectionId],
  );

  const flushDna = useCallback(async (): Promise<void> => {
    const current = draftRef.current;
    if (current && dnaSignature(current) !== lastSaved.current) {
      await enqueueSave(current);
    } else {
      await saveQueue.current;
    }
  }, [enqueueSave]);

  const closeAfterSave = useCallback(async (): Promise<void> => {
    try {
      await flushDna();
    } catch {
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
          reason instanceof Error ? reason.message : "系列参考相似度读取失败",
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
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      drawerRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => {
        if (
          previouslyFocused?.isConnected &&
          !previouslyFocused.closest("[inert]")
        ) {
          previouslyFocused.focus();
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (exportOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        void closeAfterSave();
        return;
      }
      if (event.key === "Tab" && drawerRef.current) {
        trapFocus(event, drawerRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [closeAfterSave, exportOpen]);

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

  return (
    <aside
      aria-label="系列 DNA"
      aria-modal="true"
      className={styles.collectionDrawer}
      inert={exportOpen ? true : undefined}
      ref={drawerRef}
      role="dialog"
      tabIndex={-1}
    >
      <header className={styles.collectionHeader}>
        <div>
          <span>COLLECTION / LAB</span>
          <strong>{collection?.name ?? "正在读取系列"}</strong>
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
            aria-label="关闭系列抽屉"
            onClick={() => void closeAfterSave()}
            type="button"
          >
            关闭
          </button>
        </div>
      </header>

      {collection ? (
        <nav aria-label="系列工作区" className={styles.collectionTabs}>
          <button
            aria-current={tab === "dna" ? "page" : undefined}
            onClick={() => setTab("dna")}
            type="button"
          >
            DNA 定义
          </button>
          <button
            aria-current={tab === "looks" ? "page" : undefined}
            onClick={() => setTab("looks")}
            type="button"
          >
            Look 扩展
          </button>
          <button
            aria-current={tab === "consistency" ? "page" : undefined}
            onClick={() => setTab("consistency")}
            type="button"
          >
            一致性
          </button>
        </nav>
      ) : null}

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
            disabled={loadingCollection || loadingConsistency}
            onClick={() =>
              void Promise.allSettled([loadCollection(), refreshConsistency()])
            }
            type="button"
          >
            {loadingCollection || loadingConsistency
              ? "重新读取中…"
              : "重新读取"}
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
          {consistencyError ? (
            <div className={styles.collectionInlineError} role="alert">
              <span>{consistencyError}</span>
              <button
                aria-label="重新读取一致性"
                disabled={loadingConsistency}
                onClick={() => void refreshConsistency().catch(() => undefined)}
                type="button"
              >
                {loadingConsistency ? "读取中…" : "重新读取一致性"}
              </button>
            </div>
          ) : null}
          {tab === "dna" ? (
            <>
              <section className={styles.collectionHero}>
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="系列 Hero Look"
                    src={collection.hero.thumbnailUrl ?? collection.hero.url}
                  />
                </figure>
                <div>
                  <span>FOUNDATION LOOK</span>
                  <strong>Hero 已锁定为系列原点</strong>
                  <p>
                    {draft.extractionStatus === "failed"
                      ? "自动提取未完成，已为你保留空白 DNA，可直接手动定义。"
                      : "DNA 草案已从 Hero 提取。锁定稳定维度，再继续扩展系列。"}
                  </p>
                </div>
              </section>
              <DNACard
                dna={draft}
                onChange={(next) => {
                  setSaveError(null);
                  setDraft(next);
                }}
              />
            </>
          ) : consistency && tab === "looks" ? (
            <LookGrid
              beforeGenerate={flushDna}
              collectionId={collectionId}
              consistency={consistency}
              dna={draft}
              onRefresh={refreshConsistency}
            />
          ) : consistency && tab === "consistency" ? (
            <ConsistencyOverview consistency={consistency} />
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
        </>
      ) : null}
      {exportOpen && collection ? (
        <ExportModal
          onClose={closeExport}
          source={{
            collectionId,
            name: collection.name,
            previewUrl: collection.hero.thumbnailUrl ?? collection.hero.url,
            type: "collection",
          }}
        />
      ) : null}
    </aside>
  );
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
    silhouettes: dna.silhouettes,
  });
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return;
  }
  if (document.activeElement === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
