// @vitest-environment jsdom
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RunwayRunPanel } from "./RunwayRunPanel";
import { RunwayDraftEditor } from "./RunwayDraftEditor";
import { RunwayWorkspace } from "./RunwayWorkspace";
import {
  actOnRunway,
  fetchRunwayCapabilities,
  fetchRunwayShows,
  fetchRunwayShow,
  fetchRunwayRun,
  forkRunway,
  saveRunwayShow,
  watchRunway,
} from "./runway-api";
import {
  runwayMediaFixture,
  runwayRunFixture,
  runwayShowFixture,
} from "./runway-test-fixtures";
import { studioFixture, styleFixture } from "../studio/studio-test-fixtures";
import { StudioApiError } from "../studio/studio-api";

vi.mock("./runway-api", () => ({
  actOnRunway: vi.fn(),
  cancelRunway: vi.fn(),
  forkRunway: vi.fn(),
  saveRunwayShow: vi.fn(),
  fetchRunwayCapabilities: vi.fn(),
  fetchRunwayShows: vi.fn(),
  fetchRunwayShow: vi.fn(),
  fetchRunwayRun: vi.fn(),
  startRunway: vi.fn(),
  archiveRunway: vi.fn(),
  watchRunway: vi.fn(async () => {}),
}));
const panelProps = () => ({
  projectId: "project-1",
  run: runwayRunFixture(),
  canEdit: true,
  workerOnline: true,
  onRun: vi.fn(),
  onDirty: vi.fn(),
});
const workspaceProps = () => ({
  projectId: "project-1",
  data: studioFixture({ styles: [styleFixture()] }),
  canEdit: true,
  onDirty: vi.fn(),
  onSaved: vi.fn(async () => {}),
  beforeChange: vi.fn(async () => true),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchRunwayRun).mockReset().mockResolvedValue(runwayRunFixture());
  vi.mocked(watchRunway)
    .mockReset()
    .mockImplementation(async () => {});
  vi.mocked(actOnRunway).mockResolvedValue(
    runwayRunFixture({ status: "QUEUED" }),
  );
  vi.mocked(forkRunway).mockResolvedValue(
    runwayRunFixture({ id: "run-branch", status: "QUEUED" }),
  );
  vi.mocked(fetchRunwayCapabilities).mockResolvedValue({
    enabled: true,
    workerOnline: true,
    mode: "mock",
    canEdit: true,
    capabilities: { image: true, video: true, music: true },
  });
  vi.mocked(fetchRunwayShows).mockResolvedValue([runwayShowFixture()]);
  vi.mocked(fetchRunwayShow).mockResolvedValue(runwayShowFixture());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  const controls: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((resolve) => {
    controls.resolve = resolve;
  });
  return { promise, resolve: (value: T) => controls.resolve?.(value) };
}

it("submits stable media identifiers and the current interrupt for pairing", async () => {
  const props = panelProps();
  render(<RunwayRunPanel {...props} />);
  fireEvent.change(screen.getByLabelText("模特 1 的服装"), {
    target: { value: "cloth-b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
  expect(actOnRunway).toHaveBeenCalledWith(
    "project-1",
    "run-1",
    expect.objectContaining({
      kind: "pair",
      expectedVersion: 3,
      interruptId: "interrupt-pair",
      pairings: [
        { modelMediaId: "model-a", clothMediaId: "cloth-b" },
        { modelMediaId: "model-b", clothMediaId: "cloth-b" },
      ],
    }),
  );
});

it("keeps an identical action request key after an uncertain network failure", async () => {
  vi.mocked(actOnRunway).mockRejectedValueOnce(new Error("连接中断"));
  render(<RunwayRunPanel {...panelProps()} />);
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  await screen.findByText("连接中断");
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  await waitFor(() => expect(actOnRunway).toHaveBeenCalledTimes(2));
  expect(vi.mocked(actOnRunway).mock.calls[0]?.[2].requestKey).toBe(
    vi.mocked(actOnRunway).mock.calls[1]?.[2].requestKey,
  );
});

it("rebuilds pairing choices after an edited candidate replaces its media ID", async () => {
  const props = panelProps();
  const view = render(<RunwayRunPanel {...props} />);
  const replacement = runwayMediaFixture("model-edited", "model");
  const next = runwayRunFixture({
    version: 4,
    media: [...props.run.media, replacement],
    state: {
      mediaByStage: {
        model: [replacement.id, "model-b"],
        cloth: ["cloth-a", "cloth-b"],
      },
    },
    pendingInput: {
      kind: "pair",
      stage: "pairing",
      message: "请重新核对配对",
      mediaIds: [replacement.id, "model-b", "cloth-a", "cloth-b"],
      interruptId: "pair-after-edit",
    },
  });
  view.rerender(<RunwayRunPanel {...props} run={next} />);
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  await waitFor(() => expect(actOnRunway).toHaveBeenCalledTimes(1));
  expect(
    vi
      .mocked(actOnRunway)
      .mock.calls[0]?.[2].pairings?.map((pair) => pair.modelMediaId),
  ).toEqual(["model-edited", "model-b"]);
  expect(screen.getByText("服装 1", { selector: "strong" })).toBeTruthy();
});

it("retains an image edit instruction after a version conflict", async () => {
  vi.mocked(actOnRunway).mockRejectedValue(new StudioApiError("冲突", 409));
  const media = runwayMediaFixture("storyboard-a", "storyboard");
  const props = panelProps();
  render(
    <RunwayRunPanel
      {...props}
      run={runwayRunFixture({
        stage: "storyboard",
        media: [media],
        state: { mediaByStage: { storyboard: [media.id] } },
        pendingInput: {
          kind: "confirm",
          stage: "storyboard",
          interruptId: "storyboard-review",
          message: "核对分镜",
          mediaIds: [media.id],
        },
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "修改这张图" }));
  fireEvent.change(screen.getByLabelText("图片修改要求"), {
    target: { value: "保留衣服结构，将背景改为庭院" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成修改版本" }));
  await screen.findByText(
    "执行状态已变化，请刷新后重新核对。当前修改要求已保留。",
  );
  expect(
    (screen.getByLabelText("图片修改要求") as HTMLTextAreaElement).value,
  ).toBe("保留衣服结构，将背景改为庭院");
  expect(props.onDirty).toHaveBeenCalledWith(true);
  expect(actOnRunway).toHaveBeenCalledWith(
    "project-1",
    "run-1",
    expect.objectContaining({
      mediaId: media.id,
      interruptId: "storyboard-review",
      instruction: "保留衣服结构，将背景改为庭院",
    }),
  );
});

it("renders historical media for read-only members without mutation controls", () => {
  render(<RunwayRunPanel {...panelProps()} canEdit={false} />);
  expect(screen.queryByRole("button", { name: "确认配对并试衣" })).toBeNull();
  expect(screen.queryByRole("button", { name: "停止后续制作" })).toBeNull();
  expect(screen.getAllByRole("link", { name: "下载原图" })).toHaveLength(4);
  expect(actOnRunway).not.toHaveBeenCalled();
});

it("disables new generation while the worker is offline", () => {
  render(<RunwayRunPanel {...panelProps()} workerOnline={false} />);
  expect(
    (
      screen.getByRole("button", {
        name: "确认配对并试衣",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("offers candidate edits during confirmation but not during pairing", () => {
  const props = panelProps();
  const view = render(<RunwayRunPanel {...props} />);
  expect(screen.queryByRole("button", { name: "修改这张图" })).toBeNull();
  const run = runwayRunFixture({
    stage: "prepare",
    pendingInput: {
      kind: "confirm",
      stage: "prepare",
      interruptId: "prepare-review",
      message: "核对候选图片",
      mediaIds: props.run.media.map((media) => media.id),
    },
  });
  view.rerender(<RunwayRunPanel {...props} run={run} />);
  fireEvent.click(screen.getByRole("button", { name: /1.*需求与素材/ }));
  expect(screen.getAllByRole("button", { name: "修改这张图" })).toHaveLength(4);
});

it("retains edit instructions but disables stale review controls after execution starts", () => {
  const props = panelProps();
  const run = runwayRunFixture({
    stage: "prepare",
    pendingInput: {
      kind: "confirm",
      stage: "prepare",
      interruptId: "prepare-review",
      message: "核对候选图片",
      mediaIds: props.run.media.map((media) => media.id),
    },
  });
  const view = render(<RunwayRunPanel {...props} run={run} />);
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "修改这张图",
    })[0] as HTMLButtonElement,
  );
  fireEvent.change(screen.getByLabelText("图片修改要求"), {
    target: { value: "保留结构，调整颜色" },
  });
  view.rerender(
    <RunwayRunPanel
      {...props}
      run={{ ...run, status: "RUNNING", version: 4 }}
    />,
  );
  expect(screen.queryByRole("button", { name: "已核对，继续制作" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "生成修改版本" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("图片修改要求") as HTMLTextAreaElement).value,
  ).toBe("保留结构，调整颜色");
});

it("can keep a silent movie after music failure", async () => {
  const media = {
    ...runwayMediaFixture("silent", "silent_video"),
    mimeType: "video/mp4",
  };
  render(
    <RunwayRunPanel
      {...panelProps()}
      run={runwayRunFixture({
        status: "FAILED",
        stage: "music",
        pendingInput: null,
        media: [media],
        state: { mediaByStage: { silent_video: [media.id] } },
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "保留无配乐成片" }));
  await waitFor(() =>
    expect(actOnRunway).toHaveBeenCalledWith(
      "project-1",
      "run-1",
      expect.objectContaining({ kind: "keep_silent", expectedVersion: 3 }),
    ),
  );
});

it("forks only the selected historical storyboard by stable media ID", async () => {
  const first = runwayMediaFixture("storyboard-first", "storyboard");
  const second = runwayMediaFixture("storyboard-second", "storyboard");
  const run = runwayRunFixture({
    status: "SUCCEEDED",
    stage: "finished",
    pendingInput: null,
    media: [first, second],
    state: { mediaByStage: { storyboard: [second.id, first.id] } },
  });
  const props = panelProps();
  render(<RunwayRunPanel {...props} run={run} />);
  fireEvent.click(screen.getByRole("button", { name: /3.*试衣与分镜/ }));
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "从这张图重新制作",
    })[0] as HTMLButtonElement,
  );
  await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
  expect(forkRunway).toHaveBeenCalledWith(
    "project-1",
    run,
    "storyboard",
    expect.any(String),
    "storyboard-second",
  );
});

it("saves the exact style revision as a clothing reference without starting a run", async () => {
  const props = workspaceProps();
  const onSavedShow = vi.fn();
  vi.mocked(saveRunwayShow).mockResolvedValue(runwayShowFixture({ runs: [] }));
  render(
    <RunwayDraftEditor
      {...props}
      initialStyleRevisionId="style-r1"
      onSavedShow={onSavedShow}
    />,
  );
  fireEvent.change(screen.getByLabelText("秀场需求"), {
    target: { value: "保留褶线夹克，在自然光秀场中走秀" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
  await waitFor(() => expect(onSavedShow).toHaveBeenCalledTimes(1));
  expect(saveRunwayShow).toHaveBeenCalledWith(
    "project-1",
    expect.objectContaining({
      draft: expect.objectContaining({
        inputs: [
          { kind: "cloth", sourceType: "style_revision", sourceId: "style-r1" },
        ],
      }),
    }),
    expect.any(String),
    undefined,
  );
});

it("reports a disabled feature without requesting or presenting editable projects", async () => {
  vi.mocked(fetchRunwayCapabilities).mockResolvedValue({
    enabled: false,
    workerOnline: false,
    mode: "live",
    canEdit: true,
    capabilities: {},
  });
  render(<RunwayWorkspace {...workspaceProps()} />);
  await screen.findByText("服装秀尚未启用");
  expect(fetchRunwayShows).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "保存需求" })).toBeNull();
});

it("replaces the single shared background instead of silently retaining unused references", async () => {
  vi.mocked(saveRunwayShow).mockResolvedValue(runwayShowFixture({ runs: [] }));
  render(<RunwayDraftEditor {...workspaceProps()} onSavedShow={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("秀场需求"), {
    target: { value: "庭院服装秀" },
  });
  fireEvent.change(screen.getByLabelText("素材用途"), {
    target: { value: "background" },
  });
  fireEvent.change(screen.getByLabelText("选择项目素材"), {
    target: { value: "asset:asset-front" },
  });
  fireEvent.click(screen.getByRole("button", { name: "加入素材" }));
  fireEvent.change(screen.getByLabelText("选择项目素材"), {
    target: { value: "asset:asset-back" },
  });
  fireEvent.click(screen.getByRole("button", { name: "加入素材" }));
  fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
  await waitFor(() => expect(saveRunwayShow).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveRunwayShow).mock.calls[0]?.[1].draft.inputs).toEqual([
    { kind: "background", sourceType: "asset", sourceId: "asset-back" },
  ]);
});

it("previews the exact style source asset rather than an unrelated first view", () => {
  const style = styleFixture();
  style.currentRevision.views = [
    {
      ...style.currentRevision.views[0],
      kind: "front",
      assetId: "asset-back",
      label: "独立视图",
      reviewed: false,
      url: "/images/back.png",
      thumbnailUrl: null,
    },
  ];
  render(
    <RunwayDraftEditor
      {...workspaceProps()}
      data={studioFixture({ styles: [style] })}
      initialStyleRevisionId="style-r1"
      onSavedShow={vi.fn()}
    />,
  );
  expect(
    (
      screen.getByRole("img", { name: "褶线夹克 · r1" }) as HTMLImageElement
    ).getAttribute("src"),
  ).toBe("/images/front.png");
});

it("loads an older show directly and exposes runs beyond the twenty-row list preview", async () => {
  const runs = Array.from({ length: 21 }, (_, index) =>
    runwayRunFixture({ id: `run-${index + 1}`, showId: "show-old" }),
  );
  vi.mocked(fetchRunwayShows).mockResolvedValue([]);
  vi.mocked(fetchRunwayShow).mockResolvedValue(
    runwayShowFixture({ id: "show-old", runs }),
  );
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-old"
      initialRunId="run-21"
    />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText("运行历史") as HTMLSelectElement).value).toBe(
      "run-21",
    ),
  );
  expect(
    (screen.getByLabelText("运行历史") as HTMLSelectElement).options,
  ).toHaveLength(21);
  expect(fetchRunwayShow).toHaveBeenCalledWith(
    "project-1",
    "show-old",
    expect.any(AbortSignal),
  );
});

it("fetches a requested run missing from the detail response and rejects mismatched ownership", async () => {
  vi.mocked(fetchRunwayShow).mockResolvedValue(runwayShowFixture({ runs: [] }));
  vi.mocked(fetchRunwayRun).mockResolvedValue(
    runwayRunFixture({ id: "older-run", showId: "other-show" }),
  );
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-1"
      initialRunId="older-run"
    />,
  );
  await screen.findByText("该运行记录不属于当前服装秀，请重新选择历史记录。");
  expect(fetchRunwayRun).toHaveBeenCalledWith(
    "project-1",
    "older-run",
    expect.any(AbortSignal),
  );
  expect(screen.queryByLabelText("模特 1 的服装")).toBeNull();
});

it("does not roll back a newer action result when an older refresh resolves later", async () => {
  const refresh = deferred<ReturnType<typeof runwayRunFixture>>();
  vi.mocked(fetchRunwayRun).mockReturnValue(refresh.promise);
  vi.mocked(actOnRunway).mockResolvedValue(
    runwayRunFixture({ status: "QUEUED", version: 4 }),
  );
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-1"
      initialRunId="run-1"
    />,
  );
  await screen.findByLabelText("模特 1 的服装");
  fireEvent.click(screen.getByRole("button", { name: "刷新进度" }));
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  await screen.findByText("等待执行", { exact: true });
  await act(async () => refresh.resolve(runwayRunFixture({ version: 3 })));
  expect(screen.getByText("等待执行", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "确认配对并试衣" })).toBeNull();
});

it("fetches again when an event arrives during an in-flight refresh", async () => {
  const refresh = deferred<ReturnType<typeof runwayRunFixture>>();
  let change: (() => void) | undefined;
  vi.mocked(watchRunway).mockImplementation(
    async (_projectId, _runId, _signal, onChange) => {
      change = onChange;
    },
  );
  vi.mocked(fetchRunwayRun)
    .mockReturnValueOnce(refresh.promise)
    .mockResolvedValue(runwayRunFixture({ status: "RUNNING", version: 5 }));
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-1"
      initialRunId="run-1"
    />,
  );
  await screen.findByLabelText("模特 1 的服装");
  fireEvent.click(screen.getByRole("button", { name: "刷新进度" }));
  act(() => change?.());
  await act(async () => refresh.resolve(runwayRunFixture()));
  await screen.findByText("正在制作", { exact: true });
  expect(fetchRunwayRun).toHaveBeenCalledTimes(2);
});

it("shows immutable run inputs separately from the next-run draft", async () => {
  const show = runwayShowFixture();
  show.draft = { ...show.draft, prompt: "下一次运行的新需求" };
  vi.mocked(fetchRunwayShow).mockResolvedValue(show);
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-1"
      initialRunId="run-1"
    />,
  );
  await screen.findByLabelText("模特 1 的服装");
  fireEvent.click(screen.getByRole("button", { name: "本次运行的需求" }));
  expect(
    screen.getByText("清晨庭院中的亚麻服装秀", { exact: true }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "编辑下一次运行需求" }));
  expect(
    ((await screen.findByLabelText("秀场需求")) as HTMLTextAreaElement).value,
  ).toBe("下一次运行的新需求");
  expect(
    screen.getByText("清晨庭院中的亚麻服装秀", { exact: true }),
  ).toBeTruthy();
});

it("ignores an old action completion after switching shows and editing another draft", async () => {
  const pending = deferred<ReturnType<typeof runwayRunFixture>>();
  const second = runwayShowFixture({
    id: "show-2",
    title: "溪谷服装秀",
    runs: [],
  });
  vi.mocked(fetchRunwayShows).mockResolvedValue([runwayShowFixture(), second]);
  vi.mocked(fetchRunwayShow).mockImplementation(async (_projectId, id) =>
    id === second.id ? second : runwayShowFixture(),
  );
  vi.mocked(actOnRunway).mockReturnValue(pending.promise);
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-1"
      initialRunId="run-1"
    />,
  );
  await screen.findByLabelText("模特 1 的服装");
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  fireEvent.change(screen.getByLabelText("切换服装秀"), {
    target: { value: "show-2" },
  });
  await screen.findByRole("heading", { name: "溪谷服装秀" });
  fireEvent.change(screen.getByLabelText("秀场需求"), {
    target: { value: "保留第二份未保存草稿" },
  });
  await act(async () =>
    pending.resolve(runwayRunFixture({ status: "QUEUED", version: 4 })),
  );
  expect(screen.getByRole("heading", { name: "溪谷服装秀" })).toBeTruthy();
  expect((screen.getByLabelText("秀场需求") as HTMLTextAreaElement).value).toBe(
    "保留第二份未保存草稿",
  );
});

it("keeps next-run draft edits when the current run action finishes", async () => {
  const pending = deferred<ReturnType<typeof runwayRunFixture>>();
  const props = workspaceProps();
  vi.mocked(actOnRunway).mockReturnValue(pending.promise);
  render(
    <RunwayWorkspace {...props} initialShowId="show-1" initialRunId="run-1" />,
  );
  await screen.findByLabelText("模特 1 的服装");
  fireEvent.click(screen.getByRole("button", { name: "确认配对并试衣" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑下一次运行需求" }));
  const input = await screen.findByLabelText("秀场需求");
  fireEvent.change(input, { target: { value: "下一次运行的未保存修改" } });
  await act(async () =>
    pending.resolve(runwayRunFixture({ status: "QUEUED", version: 4 })),
  );
  expect((screen.getByLabelText("秀场需求") as HTMLTextAreaElement).value).toBe(
    "下一次运行的未保存修改",
  );
  expect(props.onDirty).toHaveBeenLastCalledWith(true);
});

it("labels mock runs honestly and opens the selected persisted run", async () => {
  render(
    <RunwayWorkspace
      {...workspaceProps()}
      initialShowId="show-1"
      initialRunId="run-1"
    />,
  );
  await screen.findByText(
    "当前使用模拟生成服务，图片和视频仅用于验证制作流程，不代表真实模型效果。",
  );
  expect(screen.getByRole("heading", { name: "庭院亚麻秀" })).toBeTruthy();
  expect(screen.getByLabelText("模特 1 的服装")).toBeTruthy();
});
