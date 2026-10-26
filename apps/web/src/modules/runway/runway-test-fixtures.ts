import type {
  RunwayMediaView,
  RunwayRunView,
  RunwayShowView,
} from "@fashion/shared";

export const RUNWAY_TEST_NOW = "2026-10-26T06:00:00.000Z";
export function runwayMediaFixture(
  id: string,
  kind: RunwayMediaView["kind"],
): RunwayMediaView {
  return {
    id,
    runId: "run-1",
    kind,
    mimeType: "image/png",
    originalName: `${kind}.png`,
    sizeBytes: 1024,
    width: 720,
    height: 1080,
    durationMs: null,
    source: { mode: "mock" },
    createdAt: RUNWAY_TEST_NOW,
    contentUrl: `/api/projects/project-1/runway/media/${id}/content`,
  };
}
export function runwayRunFixture(
  overrides: Partial<RunwayRunView> = {},
): RunwayRunView {
  const media = [
    runwayMediaFixture("model-a", "model"),
    runwayMediaFixture("model-b", "model"),
    runwayMediaFixture("cloth-a", "cloth"),
    runwayMediaFixture("cloth-b", "cloth"),
  ];
  return {
    id: "run-1",
    showId: "show-1",
    projectId: "project-1",
    status: "WAITING_INPUT",
    stage: "pairing",
    version: 3,
    inputSnapshot: {
      prompt: "清晨庭院中的亚麻服装秀",
      modelCount: 2,
      withMusic: true,
      inputs: [],
    },
    modelSnapshot: { mode: "mock" },
    state: {
      mediaByStage: {
        model: ["model-a", "model-b"],
        cloth: ["cloth-a", "cloth-b"],
      },
    },
    pendingInput: {
      interruptId: "interrupt-pair",
      kind: "pair",
      stage: "pairing",
      message: "请确认每位模特的服装。",
      mediaIds: media.map((item) => item.id),
    },
    parentRunId: null,
    parentStage: null,
    cancelRequestedAt: null,
    createdAt: RUNWAY_TEST_NOW,
    updatedAt: RUNWAY_TEST_NOW,
    finishedAt: null,
    media,
    ...overrides,
  };
}
export function runwayShowFixture(
  overrides: Partial<RunwayShowView> = {},
): RunwayShowView {
  const run = runwayRunFixture();
  return {
    id: "show-1",
    projectId: "project-1",
    title: "庭院亚麻秀",
    draft: run.inputSnapshot,
    version: 1,
    archived: false,
    createdAt: RUNWAY_TEST_NOW,
    updatedAt: RUNWAY_TEST_NOW,
    runs: [run],
    ...overrides,
  };
}
