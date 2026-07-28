"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchCollection, updateCollectionDna } from "./collection-api";
import type { CollectionDetail, CollectionDna } from "./collection-types";
import { DNACard } from "./DNACard";
import styles from "./generation.module.css";

type SaveState = "error" | "saved" | "saving" | "unsaved";

export function CollectionDrawer({
  collectionId,
  onClose,
}: {
  readonly collectionId: string;
  readonly onClose: () => void;
}) {
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [draft, setDraft] = useState<CollectionDna | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const lastSaved = useRef("");
  const draftRef = useRef<CollectionDna | null>(null);
  const saveQueue = useRef(Promise.resolve());

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
      const operation = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await updateCollectionDna(collectionId, payload);
          lastSaved.current = dnaSignature(saved);
          if (dnaSignature(draftRef.current) === dnaSignature(snapshot)) {
            draftRef.current = saved;
            setDraft(saved);
            setSaveState("saved");
          }
        })
        .catch((reason: unknown) => {
          setSaveState("error");
          setError(
            reason instanceof Error ? reason.message : "DNA 自动保存失败",
          );
          throw reason;
        });
      saveQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [collectionId],
  );

  const closeAfterSave = useCallback(async (): Promise<void> => {
    const current = draftRef.current;
    if (current && dnaSignature(current) !== lastSaved.current) {
      try {
        await enqueueSave(current);
      } catch {
        return;
      }
    } else {
      await saveQueue.current;
    }
    onClose();
  }, [enqueueSave, onClose]);

  useEffect(() => {
    let disposed = false;
    void fetchCollection(collectionId).then(
      (result) => {
        if (disposed) return;
        const signature = dnaSignature(result.dna);
        lastSaved.current = signature;
        draftRef.current = result.dna;
        setCollection(result);
        setDraft(result.dna);
      },
      (reason: unknown) => {
        if (!disposed) {
          setError(
            reason instanceof Error ? reason.message : "系列 DNA 读取失败",
          );
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [collectionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        void closeAfterSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeAfterSave]);

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
      className={styles.collectionDrawer}
      role="complementary"
    >
      <header className={styles.collectionHeader}>
        <div>
          <span>COLLECTION / DNA</span>
          <strong>{collection?.name ?? "正在读取系列"}</strong>
        </div>
        <div>
          <SaveIndicator state={saveState} />
          <button
            aria-label="关闭系列抽屉"
            onClick={() => void closeAfterSave()}
            type="button"
          >
            关闭
          </button>
        </div>
      </header>

      {!collection && !error ? (
        <div className={styles.collectionSkeleton} aria-label="正在加载 DNA">
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : error && !draft ? (
        <div className={styles.collectionError} role="alert">
          <strong>DNA 暂时无法打开</strong>
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              void fetchCollection(collectionId).then(
                (result) => {
                  lastSaved.current = dnaSignature(result.dna);
                  setCollection(result);
                  setDraft(result.dna);
                },
                (reason: unknown) => {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "系列 DNA 读取失败",
                  );
                },
              );
            }}
            type="button"
          >
            重新读取
          </button>
        </div>
      ) : collection && draft ? (
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
          {error ? (
            <p className={styles.collectionInlineError} role="status">
              {error}
            </p>
          ) : null}
          <DNACard
            dna={draft}
            onChange={(next) => {
              setError(null);
              setDraft(next);
            }}
          />
        </>
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
