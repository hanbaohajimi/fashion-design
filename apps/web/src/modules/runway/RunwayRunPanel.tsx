"use client";

import { AssetSelect } from "../studio/studio-ui";
import { GridDetails } from "../../components/GridDetails";

import { useEffect, useRef, useState } from "react";
import { StudioCount } from "../studio/StudioCount";
import type {
  RunwayAction,
  RunwayMediaView,
  RunwayRunView,
  RunwayStage,
} from "@fashion/shared";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  ImagePreview,
  Notice,
  Select,
  Textarea,
} from "../../components/ui";
import { StudioApiError } from "../studio/studio-api";
import { actOnRunway, cancelRunway, forkRunway } from "./runway-api";
import {
  formatRunwayDuration,
  RUNWAY_SECTIONS,
  RUNWAY_STAGE_LABELS,
  RUNWAY_STATUS_LABELS,
  stageMedia,
} from "./runway-ui";
import styles from "./runway.module.css";

function sectionFor(stage: RunwayStage) {
  return RUNWAY_SECTIONS.findIndex((section) =>
    (section.stages as readonly string[]).includes(stage),
  );
}
const SECTION_KINDS: RunwayMediaView["kind"][][] = [
  ["model", "cloth", "background"],
  ["model", "cloth"],
  ["tryon", "storyboard"],
  ["video"],
  ["silent_video", "music", "final_video"],
  ["final_video", "silent_video", "poster"],
];
const KIND_LABELS: Record<RunwayMediaView["kind"], string> = {
  model: "模特",
  cloth: "服装",
  background: "背景",
  tryon: "试衣",
  storyboard: "分镜",
  video: "视频镜头",
  silent_video: "无配乐成片",
  music: "背景音乐",
  final_video: "完整成片",
  poster: "成片封面",
};

export function RunwayRunPanel({
  projectId,
  run,
  canEdit,
  workerOnline,
  onRun,
  onDirty,
}: {
  readonly projectId: string;
  readonly run: RunwayRunView;
  readonly canEdit: boolean;
  readonly workerOnline: boolean;
  readonly onRun: (run: RunwayRunView) => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const [section, setSection] = useState(() => sectionFor(run.stage));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [forkStage, setForkStage] = useState<RunwayStage>("storyboard");
  const packet = useRef<{ signature: string; requestKey: string } | null>(null);
  const flight = useRef(false);
  const stagesRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const strip = stagesRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip && active && strip.scrollWidth > strip.clientWidth) {
      strip.scrollTo({
        left:
          active.offsetLeft -
          strip.offsetLeft -
          (strip.clientWidth - active.clientWidth) / 2,
        behavior: "instant",
      });
    }
  }, [section, run.stage]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onDirty(Boolean(instruction.trim()));
    return () => onDirty(false);
  }, [instruction, onDirty]);
  const submit = async (
    signature: string,
    operation: (requestKey: string) => Promise<RunwayRunView>,
  ) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    if (packet.current?.signature !== signature)
      packet.current = { signature, requestKey: crypto.randomUUID() };
    try {
      const next = await operation(packet.current.requestKey);
      if (!mounted.current) return;
      onRun(next);
      packet.current = null;
      setEditingId(null);
      setInstruction("");
    } catch (cause) {
      setError(
        cause instanceof StudioApiError && cause.status === 409
          ? "执行状态已变化，请刷新后重新核对。当前修改要求已保留。"
          : cause instanceof Error
            ? cause.message
            : "操作失败，请重试",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const action = (
    value: Omit<RunwayAction, "requestKey" | "expectedVersion">,
  ) => {
    void submit(
      JSON.stringify({ run: run.id, version: run.version, ...value }),
      (requestKey) =>
        actOnRunway(projectId, run.id, {
          ...value,
          expectedVersion: run.version,
          requestKey,
        }),
    );
  };
  const active = run.status === "QUEUED" || run.status === "RUNNING";
  const pending = run.pendingInput;
  const canAct =
    canEdit && workerOnline && !busy && !active && !run.cancelRequestedAt;
  const canFork = canEdit && workerOnline && !busy;
  const items =
    SECTION_KINDS[section]?.flatMap((kind) => stageMedia(run, kind)) ?? [];
  const tone =
    run.status === "SUCCEEDED"
      ? "success"
      : run.status === "FAILED"
        ? "error"
        : run.status === "WAITING_INPUT" || run.status === "NEEDS_ATTENTION"
          ? "warning"
          : active
            ? "running"
            : "neutral";
  const pendingVisible =
    run.status === "WAITING_INPUT" &&
    pending &&
    sectionFor(pending.stage) === section;
  const expectedVideos =
    Array.isArray(run.state.pairings) && run.state.pairings.length
      ? run.state.pairings.length
      : run.inputSnapshot.modelCount;
  return (
    <section
      className={styles.execution}
      aria-label="服装秀制作进度"
      aria-busy={busy}
    >
      <div className={styles.executionHeader}>
        <div>
          <h3>{RUNWAY_STAGE_LABELS[run.stage]}</h3>
          <p>
            运行于 {new Date(run.createdAt).toLocaleString("zh-CN")}{" "}
            {run.parentRunId ? " 来自历史阶段的新分支" : ""}
            {run.modelSnapshot.mode === "mock"
              ? " 模拟运行，成果仅用于流程验证"
              : ""}
          </p>
        </div>
        <span key={`${run.id}:${run.status}`} className={styles.statusChange}><Badge tone={tone}>{RUNWAY_STATUS_LABELS[run.status]}</Badge></span>
      </div>
      <ol ref={stagesRef} className={styles.stages} aria-label="服装秀制作阶段">
        {RUNWAY_SECTIONS.map((entry, index) => (
          <li key={entry.label}>
            <button
              type="button"
              aria-current={
                sectionFor(run.stage) === index ? "step" : undefined
              }
              aria-pressed={section === index}
              onClick={() => setSection(index)}
            >
              <span>{index + 1}</span>
              {entry.label}
              {sectionFor(run.stage) === index ? <small>当前</small> : null}
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.toolbar}>
        <span className={styles.muted}>
          视频镜头已完成 <StudioCount value={stageMedia(run, "video").length} /> / {expectedVideos}
        </span>
        {section !== sectionFor(run.stage) ? (
          <Button
            size="small"
            onClick={() => setSection(sectionFor(run.stage))}
          >
            定位当前阶段
          </Button>
        ) : null}
        {canEdit &&
        !run.cancelRequestedAt &&
        run.status !== "SUCCEEDED" &&
        run.status !== "CANCELED" ? (
          <Button
            size="small"
            variant="danger"
            disabled={busy}
            onClick={() =>
              void submit(`cancel:${run.id}:${run.version}`, (key) =>
                cancelRunway(projectId, run, key),
              )
            }
          >
            停止后续制作
          </Button>
        ) : null}
      </div>
      {run.cancelRequestedAt ? (
        <Notice tone="warning">
          已请求停止后续制作。远端已经接纳的任务可能继续运行。
        </Notice>
      ) : null}
      {run.status === "NEEDS_ATTENTION" ? (
        <Notice tone="warning">
          供应商可能已经接纳上一次请求，当前无法确认结果。请先检查已有成果；明确重试会建立新的生成尝试。
        </Notice>
      ) : null}
      {run.status === "FAILED" ? (
        <Notice tone="error">
          {run.errorCode === "PROVIDER_NOT_CONFIGURED"
            ? "当前生成服务未配置，请联系管理员补全配置后重试。"
            : "本阶段未完成，已有成果已保留。检查问题后可重试失败阶段。"}
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {pendingVisible ? (
        <div className={styles.review}>
          <h4>{pending.kind === "pair" ? "选择出场配对" : "核对当前图片"}</h4>
          <p>{pending.message}</p>
          {pending.kind === "pair" ? (
            <Pairing
              key={pending.interruptId}
              run={run}
              disabled={!canAct}
              onSubmit={(pairings) =>
                action({
                  kind: "pair",
                  interruptId: pending.interruptId,
                  pairings,
                })
              }
              canEdit={canEdit}
            />
          ) : canEdit ? (
            <Button
              variant="primary"
              disabled={!canAct}
              onClick={() =>
                action({ kind: "confirm", interruptId: pending.interruptId })
              }
            >
              已核对，继续制作
            </Button>
          ) : (
            <p className={styles.muted}>等待编辑成员核对后继续。</p>
          )}
        </div>
      ) : null}
      {!items.length ? (
        <EmptyState
          title={
            active && sectionFor(run.stage) === section
              ? "本阶段正在制作"
              : "本阶段尚无成果"
          }
        >
          {active
            ? "生成结果会在完成后出现在这里，可以离开页面稍后回来。"
            : "选择其他阶段查看已有素材，或按当前状态继续制作。"}
        </EmptyState>
      ) : (
        <div className={styles.gallery}>
          {items.map((media) => {
            const index = stageMedia(run, media.kind).findIndex(
              (item) => item.id === media.id,
            );
            const currentReview =
              run.status === "WAITING_INPUT" &&
              pending?.kind === "confirm" &&
              Boolean(pending.mediaIds?.includes(media.id));
            return (
              <figure key={media.id} className={styles.media}>
                <MediaPreview
                  media={media}
                  label={`${KIND_LABELS[media.kind]} ${index + 1}`}
                />
                <figcaption>
                  <strong>
                    {KIND_LABELS[media.kind]} {index + 1}
                  </strong>
                  <span>{formatRunwayDuration(media.durationMs)}</span>
                </figcaption>
                <div className={styles.mediaTools}>
                  <a
                    href={`${media.contentUrl}${media.contentUrl.includes("?") ? "&" : "?"}download=1`}
                    download={media.originalName}
                  >
                    下载{media.mimeType.startsWith("image/") ? "原图" : "文件"}
                  </a>
                  {media.mimeType.startsWith("image/") ? (
                    <a href={media.contentUrl} target="_blank" rel="noreferrer">
                      查看原图
                    </a>
                  ) : null}
                  {canEdit &&
                  run.status === "WAITING_INPUT" &&
                  pending?.kind === "confirm" &&
                  media.mimeType.startsWith("image/") &&
                  pending?.mediaIds?.includes(media.id) ? (
                    <Button
                      size="small"
                      disabled={!canAct}
                      onClick={() => {
                        setEditingId(media.id);
                        setInstruction("");
                      }}
                    >
                      修改这张图
                    </Button>
                  ) : null}
                  {canEdit &&
                  !active &&
                  (media.kind === "tryon" ||
                    media.kind === "storyboard" ||
                    media.kind === "video") ? (
                    <Button
                      size="small"
                      disabled={!canFork}
                      onClick={() => {
                        const stage = media.kind as
                          "tryon" | "storyboard" | "video";
                        void submit(
                          `fork:${run.id}:${run.version}:${stage}:${media.id}`,
                          (key) =>
                            forkRunway(projectId, run, stage, key, media.id),
                        );
                      }}
                    >
                      {media.kind === "video"
                        ? "重新制作这个镜头"
                        : "从这张图重新制作"}
                    </Button>
                  ) : null}
                </div>
                {editingId === media.id ? (
                  <form
                    className={styles.imageEdit}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (currentReview && instruction.trim())
                        action({
                          kind: "edit",
                          mediaId: media.id,
                          instruction: instruction.trim(),
                          ...(pending
                            ? { interruptId: pending.interruptId }
                            : {}),
                        });
                    }}
                  >
                    {!currentReview ? (
                      <Notice tone="warning">
                        图片审核状态已变化，修改要求已保留。请先查看当前阶段，再重新选择要修改的图片。
                      </Notice>
                    ) : null}
                    <Field label="图片修改要求">
                      <Textarea
                        rows={3}
                        maxLength={4000}
                        required
                        readOnly={!canEdit || !currentReview}
                        value={instruction}
                        onChange={(event) => setInstruction(event.target.value)}
                      />
                    </Field>
                    <div className={styles.toolbar}>
                      <Button
                        type="submit"
                        variant="primary"
                        loading={busy}
                        disabled={
                          !canAct || !currentReview || !instruction.trim()
                        }
                      >
                        生成修改版本
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingId(null);
                          setInstruction("");
                        }}
                      >
                        取消修改
                      </Button>
                    </div>
                  </form>
                ) : null}
              </figure>
            );
          })}
        </div>
      )}
      {canEdit &&
      !active &&
      items.some(
        (media) =>
          media.kind === "tryon" ||
          media.kind === "storyboard" ||
          media.kind === "video",
      ) ? (
        <p className={styles.muted}>
          单张重新制作会建立独立分支，保留其他镜头及原有成果。
        </p>
      ) : null}
      {section === 5 && run.media.length ? (
        <GridDetails className={styles.history}>
          <summary>本次运行的全部媒体（{run.media.length}）</summary>
          <p>包含输入快照、修改前的图片与各阶段结果。</p>
          <ul className={styles.mediaHistory}>
            {run.media.map((media, index) => (
              <li key={media.id}>
                <span>
                  <strong>
                    {KIND_LABELS[media.kind]} 记录 {index + 1}
                  </strong>
                  <small>
                    {new Date(media.createdAt).toLocaleString("zh-CN")}
                  </small>
                </span>
                <a href={media.contentUrl} target="_blank" rel="noreferrer">
                  {media.mimeType.startsWith("image/")
                    ? "查看图片"
                    : "播放媒体"}
                </a>
                <a
                  href={`${media.contentUrl}?download=1`}
                  download={media.originalName}
                >
                  下载文件
                </a>
              </li>
            ))}
          </ul>
        </GridDetails>
      ) : null}
      {canEdit &&
      (run.status === "FAILED" || run.status === "NEEDS_ATTENTION") ? (
        <div className={styles.toolbar}>
          <Button
            variant="primary"
            disabled={!canAct}
            onClick={() => action({ kind: "retry", stage: run.stage })}
          >
            {run.status === "NEEDS_ATTENTION"
              ? "确认重新尝试本阶段"
              : "重试失败阶段"}
          </Button>
          {stageMedia(run, "silent_video").length ? (
            <Button
              disabled={!canAct}
              onClick={() => action({ kind: "keep_silent" })}
            >
              保留无配乐成片
            </Button>
          ) : null}
        </div>
      ) : null}
      {canEdit && !active && run.media.length ? (
        <GridDetails className={styles.history}>
          <summary>从历史阶段重新制作</summary>
          <p>
            建立独立分支，原有成果继续保留。所选阶段及其后续成果将重新生成。
          </p>
          <div className={styles.toolbar}>
            <Field label="重新制作的起点">
              <Select
                value={forkStage}
                onChange={(event) =>
                  setForkStage(event.target.value as RunwayStage)
                }
              >
                {Object.entries(RUNWAY_STAGE_LABELS)
                  .filter(
                    ([stage]) => stage !== "finished" && stage !== "pairing",
                  )
                  .map(([stage, label]) => (
                    <option value={stage} key={stage}>
                      {label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button
              disabled={!canFork}
              onClick={() =>
                void submit(
                  `fork:${run.id}:${run.version}:${forkStage}`,
                  (key) => forkRunway(projectId, run, forkStage, key),
                )
              }
            >
              建立新分支并制作
            </Button>
          </div>
        </GridDetails>
      ) : null}
    </section>
  );
}

export function MediaPreview({
  media,
  label,
}: {
  readonly media: RunwayMediaView;
  readonly label: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFrame = useRef(false);
  const clearBuffer = () => {
    if (waiting.current) clearTimeout(waiting.current);
    waiting.current = null; setBuffering(false);
  };
  const waitForMedia = () => {
    if (!hasFrame.current || video.current?.paused || waiting.current) return;
    waiting.current = setTimeout(() => { waiting.current = null; if (video.current && !video.current.paused && video.current.readyState < 3) setBuffering(true); }, 250);
  };
  useEffect(() => () => { if (waiting.current) clearTimeout(waiting.current); }, []);
  return (
    <>
      <div className={styles.mediaStage}>
        {media.mimeType.startsWith("video/") ? (
          <video
            ref={video}
            key={attempt}
            controls
            preload="metadata"
            playsInline
            src={media.contentUrl}
            aria-label={label}
            onLoadedData={() => { hasFrame.current = true; }}
            onWaiting={waitForMedia}
            onStalled={waitForMedia}
            onPlaying={clearBuffer}
            onCanPlay={clearBuffer}
            onPause={clearBuffer}
            onEnded={clearBuffer}
            onError={() => { clearBuffer(); setFailed(true); }}
          />
        ) : media.mimeType.startsWith("audio/") ? (
          <audio
            key={attempt}
            controls
            preload="metadata"
            src={media.contentUrl}
            aria-label="背景音乐试听"
            onError={() => setFailed(true)}
          />
        ) : (
          <ImagePreview src={media.contentUrl} alt={label} />
        )}
        {media.mimeType.startsWith("video/") ? <span aria-hidden="true" className={styles.bufferOverlay} data-buffering={buffering && !failed || undefined}><span /></span> : null}
      </div>
      {buffering && !failed ? <span className={styles.bufferStatus} role="status">视频正在缓冲，保留当前画面</span> : null}
      {failed ? (
        <div className={styles.playbackError}>
          <p>媒体暂时无法播放，可以重试加载或下载文件后查看。</p>
          <Button
            size="small"
            onClick={() => {
              setFailed(false);
              clearBuffer(); hasFrame.current = false;
              setAttempt((current) => current + 1);
            }}
          >
            重试播放
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Pairing({
  run,
  disabled,
  canEdit,
  onSubmit,
}: {
  readonly run: RunwayRunView;
  readonly disabled: boolean;
  readonly canEdit: boolean;
  readonly onSubmit: (
    pairs: { modelMediaId: string; clothMediaId: string }[],
  ) => void;
}) {
  const models = stageMedia(run, "model");
  const clothes = stageMedia(run, "cloth");
  const [pairs, setPairs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      models.map((model, index) => [
        model.id,
        index < run.inputSnapshot.modelCount
          ? (clothes[index % Math.max(clothes.length, 1)]?.id ?? "")
          : "",
      ]),
    ),
  );
  const selected = Object.entries(pairs)
    .filter(([, cloth]) => cloth)
    .map(([modelMediaId, clothMediaId]) => ({ modelMediaId, clothMediaId }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(selected);
      }}
    >
      <div className={styles.pairings}>
        {models.map((model, index) => (
          <div key={model.id} className={styles.pairing}>
            <span className={styles.pairImage}>
              <ImagePreview
                src={model.contentUrl}
                alt={`配对模特 ${index + 1}`}
              />
            </span>
            <Field label={`模特 ${index + 1} 的服装`}>
              <AssetSelect
                value={pairs[model.id] ?? ""}
                disabled={disabled}
                onValueChange={(mediaId) =>
                  setPairs((current) => ({
                    ...current,
                    [model.id]: mediaId,
                  }))
                }
               assets={clothes.map((cloth, clothIndex) => ({ id: cloth.id, url: cloth.contentUrl, thumbnailUrl: null, name: "服装 " + (clothIndex + 1) }))} />
              <Button variant="ghost" aria-pressed={!pairs[model.id]} disabled={disabled} onClick={() => setPairs((current) => ({ ...current, [model.id]: "" }))}>本次不出场</Button>
            </Field>
            {pairs[model.id] ? (
              <span className={styles.pairImage}>
                <ImagePreview
                  src={
                    clothes.find((cloth) => cloth.id === pairs[model.id])
                      ?.contentUrl
                  }
                  alt={`模特 ${index + 1} 所选服装`}
                />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className={styles.muted}>已选择 {selected.length} 组出场配对。</p>
      {canEdit ? (
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || !selected.length}
        >
          确认配对并试衣
        </Button>
      ) : (
        <p className={styles.muted}>等待编辑成员确认出场配对。</p>
      )}
    </form>
  );
}
