"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RunwayCapabilities,
  RunwayRunView,
  RunwayShowView,
  StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  Select,
  Skeleton,
} from "../../components/ui";
import { StudioPageHeader } from "../studio/StudioPageHeader";
import type { StudioPanelProps } from "../studio/use-studio-form";
import {
  archiveRunway,
  fetchRunwayCapabilities,
  fetchRunwayRun,
  fetchRunwayShow,
  fetchRunwayShows,
  startRunway,
  watchRunway,
} from "./runway-api";
import { RunwayDraftEditor } from "./RunwayDraftEditor";
import { RunwayRunPanel } from "./RunwayRunPanel";
import { RunwayInputSnapshot } from "./RunwayInputSnapshot";
import { RUNWAY_STATUS_LABELS } from "./runway-ui";
import styles from "./runway.module.css";

export function RunwayWorkspace(
  props: StudioPanelProps & {
    readonly data: StudioSummary;
    readonly initialShowId?: string | undefined;
    readonly initialRunId?: string | undefined;
    readonly initialStyleRevisionId?: string | undefined;
  },
) {
  const [capabilities, setCapabilities] = useState<RunwayCapabilities | null>(
    null,
  );
  const [shows, setShows] = useState<RunwayShowView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    props.initialShowId ?? null,
  );
  const [run, setRun] = useState<RunwayRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftOpen, setDraftOpen] = useState(!props.initialRunId);
  const [draftVersion, setDraftVersion] = useState(0);
  const [draftDirty, setDraftDirty] = useState(false);
  const [imageDirty, setImageDirty] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const packet = useRef<{ signature: string; key: string } | null>(null);
  const refreshFlights = useRef(new Map<string, boolean>());
  const selectionEpoch = useRef(0);
  const actionFlight = useRef(false);
  const mounted = useRef(true);
  const onDirty = props.onDirty;
  useEffect(() => {
    onDirty(draftDirty || imageDirty);
    return () => onDirty(false);
  }, [draftDirty, imageDirty, onDirty]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected = shows.find((show) => show.id === selectedId);
  const runId = run?.id;
  const runStatus = run?.status;
  const editable =
    props.canEdit &&
    Boolean(capabilities?.canEdit) &&
    Boolean(capabilities?.enabled);
  const updateUrl = useCallback(
    (showId: string | null, runId: string | null) => {
      if (!mounted.current) return;
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "runway");
      if (showId) url.searchParams.set("showId", showId);
      else url.searchParams.delete("showId");
      if (runId) url.searchParams.set("runId", runId);
      else url.searchParams.delete("runId");
      url.searchParams.delete("assetId");
      window.history.replaceState(window.history.state, "", url);
    },
    [],
  );
  const receiveRun = useCallback(
    (next: RunwayRunView) => {
      if (!mounted.current) return;
      setRun((current) =>
        current?.id === next.id && current.version > next.version
          ? current
          : next,
      );
      setSelectedId(next.showId);
      setShows((current) =>
        current.map((show) =>
          show.id === next.showId
            ? {
                ...show,
                runs: show.runs.some((item) => item.id === next.id)
                  ? show.runs.map((item) =>
                      item.id === next.id && item.version <= next.version
                        ? next
                        : item,
                    )
                  : [next, ...show.runs],
              }
            : show,
        ),
      );
      updateUrl(next.showId, next.id);
    },
    [updateUrl],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const nextCapabilities = await fetchRunwayCapabilities(
          props.projectId,
          signal,
        );
        if (signal?.aborted) return;
        setCapabilities(nextCapabilities);
        if (nextCapabilities.enabled) {
          const nextShows = await fetchRunwayShows(props.projectId, signal);
          if (signal?.aborted) return;
          setShows(nextShows);
          let requestedRun =
            props.initialRunId && !props.initialShowId
              ? await fetchRunwayRun(
                  props.projectId,
                  props.initialRunId,
                  signal,
                )
              : undefined;
          if (requestedRun && requestedRun.projectId !== props.projectId)
            throw new Error("运行记录不属于当前项目");
          const wantedShowId =
            props.initialShowId ??
            requestedRun?.showId ??
            (props.initialStyleRevisionId
              ? undefined
              : nextShows.find((item) => !item.archived)?.id);
          if (wantedShowId) {
            const current = await fetchRunwayShow(
              props.projectId,
              wantedShowId,
              signal,
            );
            if (signal?.aborted) return;
            if (
              current.id !== wantedShowId ||
              current.projectId !== props.projectId
            )
              throw new Error("服装秀记录不属于当前项目");
            setSelectedId(current.id);
            if (props.initialRunId)
              requestedRun ??=
                current.runs.find((item) => item.id === props.initialRunId) ??
                (await fetchRunwayRun(
                  props.projectId,
                  props.initialRunId,
                  signal,
                ));
            if (
              requestedRun &&
              (requestedRun.showId !== current.id ||
                requestedRun.projectId !== props.projectId)
            )
              throw new Error(
                "该运行记录不属于当前服装秀，请重新选择历史记录。",
              );
            const chosenRun = requestedRun ?? current.runs[0];
            const detail =
              chosenRun &&
              !current.runs.some((item) => item.id === chosenRun.id)
                ? { ...current, runs: [...current.runs, chosenRun] }
                : current;
            setShows([
              detail,
              ...nextShows.filter((item) => item.id !== detail.id),
            ]);
            if (chosenRun) {
              setRun(chosenRun);
              setDraftOpen(false);
            }
          }
        }
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "服装秀暂时无法读取，请重试",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [
      props.projectId,
      props.initialShowId,
      props.initialRunId,
      props.initialStyleRevisionId,
    ],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      void fetchRunwayCapabilities(props.projectId, controller.signal).then(
        setCapabilities,
        () => undefined,
      );
    }, 15000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [props.projectId]);
  const refreshRun = useCallback(async () => {
    if (!runId) return;
    if (refreshFlights.current.has(runId)) {
      refreshFlights.current.set(runId, true);
      return;
    }
    refreshFlights.current.set(runId, false);
    const epoch = selectionEpoch.current;
    try {
      do {
        refreshFlights.current.set(runId, false);
        const next = await fetchRunwayRun(props.projectId, runId);
        if (!mounted.current) return;
        if (next.id !== runId || next.projectId !== props.projectId)
          throw new Error("运行记录不属于当前项目");
        setRun((current) =>
          current?.id === next.id &&
          current.showId === next.showId &&
          current.version <= next.version
            ? next
            : current,
        );
        setShows((current) =>
          current.map((show) =>
            show.id === next.showId
              ? {
                  ...show,
                  runs: show.runs.map((item) =>
                    item.id === next.id && item.version <= next.version
                      ? next
                      : item,
                  ),
                }
              : show,
          ),
        );
      } while (
        refreshFlights.current.get(runId) &&
        mounted.current &&
        selectionEpoch.current === epoch
      );
    } catch (cause) {
      if (mounted.current && selectionEpoch.current === epoch)
        setError(
          cause instanceof Error
            ? cause.message
            : "进度暂时无法读取，请刷新重试",
        );
    } finally {
      refreshFlights.current.delete(runId);
    }
  }, [props.projectId, runId]);
  useEffect(() => {
    if (
      !runId ||
      !runStatus ||
      !["QUEUED", "RUNNING", "WAITING_INPUT"].includes(runStatus)
    )
      return;
    const controller = new AbortController();
    void watchRunway(
      props.projectId,
      runId,
      controller.signal,
      () => void refreshRun(),
    );
    return () => controller.abort();
  }, [props.projectId, runId, runStatus, refreshRun]);
  const selectShow = async (show?: RunwayShowView) => {
    if (!(await props.beforeChange())) return;
    const epoch = ++selectionEpoch.current;
    setBusy(Boolean(show));
    try {
      const detail = show
        ? await fetchRunwayShow(props.projectId, show.id)
        : undefined;
      if (!mounted.current || epoch !== selectionEpoch.current) return;
      if (
        detail &&
        (detail.id !== show?.id || detail.projectId !== props.projectId)
      )
        throw new Error("服装秀记录不属于当前项目");
      props.onDirty(false);
      setDraftDirty(false);
      setImageDirty(false);
      setSnapshotOpen(false);
      if (detail)
        setShows((current) => [
          detail,
          ...current.filter((item) => item.id !== detail.id),
        ]);
      setSelectedId(detail?.id ?? null);
      setRun(detail?.runs[0] ?? null);
      setDraftOpen(!detail?.runs.length);
      setDraftVersion((current) => current + 1);
      setError(null);
      updateUrl(detail?.id ?? null, detail?.runs[0]?.id ?? null);
    } catch (cause) {
      if (epoch === selectionEpoch.current)
        setError(
          cause instanceof Error ? cause.message : "无法切换服装秀，请重试",
        );
    } finally {
      if (epoch === selectionEpoch.current) setBusy(false);
    }
  };
  const onSavedShow = (show: RunwayShowView) => {
    setShows((current) => [
      show,
      ...current.filter((item) => item.id !== show.id),
    ]);
    setSelectedId(show.id);
    setError(null);
    updateUrl(show.id, run?.id ?? null);
  };
  const start = async () => {
    if (!selected || actionFlight.current || !(await props.beforeChange()))
      return;
    actionFlight.current = true;
    const epoch = selectionEpoch.current;
    setDraftOpen(false);
    setDraftDirty(false);
    setImageDirty(false);
    setBusy(true);
    setError(null);
    const signature = `${selected.id}:${selected.version}`;
    if (packet.current?.signature !== signature)
      packet.current = { signature, key: crypto.randomUUID() };
    try {
      const next = await startRunway(
        props.projectId,
        selected,
        packet.current.key,
      );
      if (!mounted.current || epoch !== selectionEpoch.current) return;
      receiveRun(next);
      packet.current = null;
    } catch (cause) {
      if (epoch === selectionEpoch.current)
        setError(
          cause instanceof Error ? cause.message : "开始制作失败，请重试",
        );
    } finally {
      actionFlight.current = false;
      setBusy(false);
    }
  };
  if (loading)
    return (
      <div className={styles.shell}>
        <Skeleton className={styles.loading} />
      </div>
    );
  if (!capabilities)
    return (
      <div className={styles.shell}>
        <Notice tone="error">{error ?? "服装秀暂时无法打开"}</Notice>
        <Button
          onClick={() => {
            setLoading(true);
            setError(null);
            void load();
          }}
        >
          重新加载
        </Button>
      </div>
    );
  if (!capabilities.enabled)
    return (
      <div className={styles.shell}>
        <StudioPageHeader
          title="服装秀"
          description="把款式推进为可追溯的走秀成片"
        />
        <EmptyState title="服装秀尚未启用">
          管理员完成执行器与生成服务配置后，可在这里制作服装秀。
        </EmptyState>
      </div>
    );
  return (
    <div className={styles.shell}>
      <StudioPageHeader
        title={selected?.title ?? "建立服装秀"}
        type="服装秀"
        description="从服装与模特到秀场分镜、视频和配乐"
        status={
          capabilities.mode === "mock" ? (
            <Badge tone="warning">模拟生成</Badge>
          ) : undefined
        }
        actions={
          <>
            {shows.length ? (
              <label className={styles.showSelect}>
                切换服装秀
                <Select
                  value={selectedId ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    void selectShow(
                      shows.find((show) => show.id === event.target.value),
                    )
                  }
                >
                  <option value="">新服装秀</option>
                  {shows.map((show) => (
                    <option key={show.id} value={show.id}>
                      {show.title}
                      {show.archived ? "（已归档）" : ""}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            {editable ? (
              <Button disabled={busy} onClick={() => void selectShow()}>
                新建服装秀
              </Button>
            ) : null}
          </>
        }
      />
      {capabilities.mode === "mock" ? (
        <Notice tone="warning">
          当前使用模拟生成服务，图片和视频仅用于验证制作流程，不代表真实模型效果。
        </Notice>
      ) : null}
      {!capabilities.workerOnline ? (
        <Notice tone="warning">
          执行器暂时离线。已保存的作品仍可查看，管理员启动执行器后才能继续制作。
        </Notice>
      ) : null}
      {capabilities.mode === "live" &&
      Object.entries(capabilities.capabilities).some(
        ([, configured]) => !configured,
      ) ? (
        <Notice tone="warning">
          部分生成能力尚未配置，相关阶段可能无法制作。请联系管理员检查生成服务。
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      ) : null}
      {selected?.archived ? (
        <Notice tone="info">该服装秀已归档，恢复后可以继续制作。</Notice>
      ) : null}
      {!editable && !selected ? (
        <EmptyState title="还没有服装秀作品">
          编辑成员保存需求后，可在这里查看制作进度和成果。
        </EmptyState>
      ) : (
        <>
          {run ? (
            <div className={styles.toolbar}>
              <label className={styles.historySelect}>
                运行历史
                <Select
                  value={run.id}
                  disabled={busy}
                  onChange={(event) => {
                    const next = selected?.runs.find(
                      (item) => item.id === event.target.value,
                    );
                    if (next)
                      void (async () => {
                        if (await props.beforeChange()) {
                          selectionEpoch.current += 1;
                          props.onDirty(false);
                          setDraftDirty(false);
                          setImageDirty(false);
                          setSnapshotOpen(false);
                          setDraftOpen(false);
                          receiveRun(next);
                        }
                      })();
                  }}
                >
                  {selected?.runs.map((item, index) => (
                    <option key={item.id} value={item.id}>
                      {index === 0
                        ? "最近运行"
                        : `历史运行 ${selected.runs.length - index}`}{" "}
                      · {RUNWAY_STATUS_LABELS[item.status]} ·{" "}
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                aria-expanded={snapshotOpen}
                onClick={() => setSnapshotOpen((current) => !current)}
              >
                {snapshotOpen ? "收起本次运行需求" : "本次运行的需求"}
              </Button>
              <Button
                onClick={async () => {
                  if (await props.beforeChange()) {
                    props.onDirty(false);
                    setDraftOpen((current) => !current);
                    setDraftVersion((current) => current + 1);
                  }
                }}
              >
                {draftOpen
                  ? "收起下一次需求"
                  : editable
                    ? "编辑下一次运行需求"
                    : "查看当前草稿"}
              </Button>
              <Button onClick={() => void refreshRun()}>刷新进度</Button>
            </div>
          ) : null}
          {run && snapshotOpen ? (
            <RunwayInputSnapshot run={run} data={props.data} />
          ) : null}
          {run && draftOpen ? (
            <p className={styles.muted}>
              以下草稿用于下一次运行，不会改变本次运行的需求快照和成果。
            </p>
          ) : null}
          {draftOpen || !run ? (
            <RunwayDraftEditor
              key={`${selected?.id ?? "new"}:${selected?.version ?? 0}:${draftVersion}`}
              {...props}
              onDirty={setDraftDirty}
              canEdit={editable && !selected?.archived && !busy}
              existing={selected}
              initialStyleRevisionId={props.initialStyleRevisionId}
              onSavedShow={onSavedShow}
            />
          ) : null}
          {editable && selected && (!run || draftOpen || selected.archived) ? (
            <div className={styles.toolbar}>
              <Button
                variant="primary"
                loading={busy}
                disabled={
                  selected.archived ||
                  !capabilities.workerOnline ||
                  run?.status === "QUEUED" ||
                  run?.status === "RUNNING"
                }
                onClick={() => void start()}
              >
                {run ? "以已保存需求开始新运行" : "开始制作服装秀"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    if (!(await props.beforeChange())) return;
                    setBusy(true);
                    try {
                      onSavedShow(
                        await archiveRunway(
                          props.projectId,
                          selected,
                          crypto.randomUUID(),
                        ),
                      );
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "归档失败，请重试",
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {selected.archived ? "恢复服装秀" : "归档服装秀"}
              </Button>
            </div>
          ) : null}
          {run ? (
            <RunwayRunPanel
              key={run.id}
              projectId={props.projectId}
              run={run}
              canEdit={editable && !selected?.archived && !busy}
              workerOnline={capabilities.workerOnline}
              onRun={receiveRun}
              onDirty={setImageDirty}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
