"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioDocumentView, StudioStyleView } from "@fashion/shared";
import { Button, Notice } from "../../components/ui";
import {
  flushWorkspaceDrafts,
  type DraftRecord,
} from "../../components/drafts/draft-repository";
import { sendStudioSave } from "./studio-api";
import { errorMessage } from "./studio-ui";
import {
  acknowledgeRecoveredStudioSave,
  confirmStudioSave,
  pendingStudioSaves,
  STUDIO_SAVES_CHANGED,
  studioSaveInFlight,
  studioSaveLabel,
  studioSaveRevision,
  type PendingStudioSave,
} from "./studio-save-recovery";
import styles from "./studio.module.css";

type Confirmed = {
  record: DraftRecord<PendingStudioSave>;
  result: StudioStyleView | StudioDocumentView;
};

export function StudioSaveRecovery({
  accountId,
  projectId,
  editor,
  onConfirmed,
  onOpen,
}: {
  accountId: string;
  projectId: string;
  editor?: string | undefined;
  onConfirmed: (value: Confirmed) => void;
  onOpen: (value: Confirmed) => Promise<void>;
}) {
  const [records, setRecords] = useState<DraftRecord<PendingStudioSave>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const active = useRef(false);
  const readVersion = useRef(0);
  const reload = useCallback(() => {
    const version = ++readVersion.current;
    return pendingStudioSaves(accountId, projectId).then(
      (next) => {
        if (active.current && readVersion.current === version)
          setRecords(next.filter((record) => (!editor || record.value.editor === editor) && !studioSaveInFlight(record.key)));
      },
      () => {
        if (active.current && readVersion.current === version)
          setError("本机保存记录暂时无法读取，请检查浏览器存储后重试。");
      },
    );
  }, [accountId, projectId, editor]);
  useEffect(() => {
    active.current = true;
    void reload();
    const changed = () => {
      void reload();
    };
    window.addEventListener(STUDIO_SAVES_CHANGED, changed);
    window.addEventListener("focus", changed);
    return () => {
      active.current = false;
      window.removeEventListener(STUDIO_SAVES_CHANGED, changed);
      window.removeEventListener("focus", changed);
    };
  }, [reload]);

  const resume = async (record: DraftRecord<PendingStudioSave>) => {
    if (busy) return;
    setBusy(record.key);
    setError(null);
    try {
      await flushWorkspaceDrafts();
      if (!active.current) return;
      const result = await confirmStudioSave(record, (operation) =>
        sendStudioSave(projectId, operation),
      );
      if (!active.current) return;
      acknowledgeRecoveredStudioSave(record);
      const value = { record, result };
      setConfirmed(value);
      onConfirmed(value);
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) {
        setBusy(null);
        await reload();
      }
    }
  };

  if (!records.length && !error && !confirmed && !busy) return null;
  return (
    <section aria-label="保存结果恢复" className={styles.saveRecovery}>
      {records.some((record) => record.key !== confirmed?.record.key) ? (
        <Notice tone="warning">
          <strong>有保存结果待确认</strong>
          <p>
            离开前的保存没有收到确认。继续原操作后会找回结果，当前编辑内容保留。
          </p>
          {records
            .filter((record) => record.key !== confirmed?.record.key)
            .map((record) => (
              <div key={record.key} className={styles.recoveryRow}>
                <span>
                  {studioSaveLabel(record.value.operation)}
                  <small>
                    提交为 r{studioSaveRevision(record.value.operation)}
                  </small>
                </span>
                <Button
                  disabled={Boolean(busy)}
                  loading={busy === record.key}
                  onClick={() => void resume(record)}
                >
                  继续确认保存
                </Button>
              </div>
            ))}
        </Notice>
      ) : busy ? (
        <Notice>正在确认原保存结果…</Notice>
      ) : null}
      {error ? (
        <Notice tone="error">
          {error}
          <Button
            disabled={Boolean(busy)}
            onClick={() => {
              setError(null);
              void reload();
            }}
          >
            重新读取记录
          </Button>
        </Notice>
      ) : null}
      {confirmed ? (
        <Notice tone="success">
          <div className={styles.recoveryRow}>
            <span>
              已确认「{studioSaveLabel(confirmed.record.value.operation)}
              」的保存。
              <small>
                {confirmed.result.version >
                studioSaveRevision(confirmed.record.value.operation)
                  ? "资料后来已有新修订，打开后请核对本机草稿与最新资料。"
                  : "打开后可继续编辑，本页后续修改会一并带入。"}
              </small>
            </span>
            <Button
              onClick={() =>
                void onOpen(confirmed)
                  .then(() => reload())
                  .catch((cause) => setError(errorMessage(cause)))
              }
            >
              打开已保存资料
            </Button>
            <Button onClick={() => setConfirmed(null)}>知道了</Button>
          </div>
        </Notice>
      ) : null}
    </section>
  );
}
