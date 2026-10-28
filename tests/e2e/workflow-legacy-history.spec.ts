import { expect, test, type Page } from "@playwright/test";
import { seedReturningFeatureGuideUser } from "./feature-guide-fixture";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const PROJECT_ID = "e2e-legacy-history";
const NOW = "2026-10-14T00:00:00.000Z";
const webRequire = createRequire(resolve("apps/web/package.json"));

type LegacyRecord = {
  id: string;
  typeName: "shape";
  type: string;
  x: number;
  y: number;
  rotation: number;
  index: string;
  parentId: string;
  isLocked: boolean;
  opacity: number;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
};

function legacyShape(
  id: string,
  type: string,
  index: string,
  x: number,
  props: Record<string, unknown>,
): LegacyRecord {
  return {
    id: `shape:${id}`,
    typeName: "shape",
    type,
    x,
    y: 120,
    rotation: 0,
    index,
    parentId: "page:page1",
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  };
}

const legacyRecords = [
  legacyShape("legacy-image", "fashion-image", "a1", 40, {
    fileId: "legacy-image",
    h: 260,
    role: "style_ref",
    title: "历史风衣参考",
    uploadStatus: "ready",
    url: "/api/files/legacy-image/thumbnail/1024",
    w: 210,
  }),
  legacyShape("legacy-note", "fashion-note", "a2", 310, {
    h: 210,
    role: "note",
    text: "保留宽松肩线与通勤比例",
    tone: "#F2D978",
    w: 260,
  }),
  legacyShape("legacy-swatch", "fashion-swatch", "a3", 630, {
    color: "#C8AB84",
    colors: [{ id: "legacy-oat", color: "#C8AB84", label: "OAT" }],
    h: 148,
    label: "OAT",
    role: "palette",
    w: 220,
  }),
];

function legacyBoardResponse() {
  const { createTLStore } = webRequire("tldraw") as {
    createTLStore: () => {
      getStoreSnapshot: () => {
        schema: Record<string, unknown>;
        store: Record<string, unknown>;
      };
      put: (records: readonly Record<string, unknown>[]) => void;
    };
  };
  const store = createTLStore();
  store.put([
    {
      id: "page:page1",
      typeName: "page",
      name: "Page 1",
      index: "a1",
      meta: {},
    },
  ]);
  const document = store.getStoreSnapshot();
  return {
    revision: 4,
    snapshot: {
      document: {
        ...document,
        store: {
          ...document.store,
          ...Object.fromEntries(legacyRecords.map((record) => [record.id, record])),
        },
      },
    },
    elements: legacyRecords.map((record) => ({
      deleted: false,
      record,
      role: record.props.role,
      roleConfidence: null,
      roleInferenceState: "ready",
      roleLabel: null,
      roleSource: "manual",
      shapeId: record.id,
      shapeType: record.type,
      updatedAt: NOW,
    })),
  };
}

async function mockLegacyWorkflow(page: Page) {
  await seedReturningFeatureGuideUser(page, ["legacy-user"]);
  let graph = {
    projectId: PROJECT_ID,
    revision: 0,
    layoutRevision: 0,
    legacyAvailable: true,
    nodes: [] as Array<Record<string, unknown>>,
    edges: [] as Array<Record<string, unknown>>,
  };
  const boardMethods: string[] = [];
  const graphMutations: Array<Record<string, unknown>> = [];
  const board = legacyBoardResponse();

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "legacy-user",
          authId: "auth-legacy",
          email: "legacy@example.com",
          name: "Legacy E2E",
          avatar: null,
          createdAt: NOW,
          deletedAt: null,
        },
        credits: { limit: 100, remaining: 100, used: 0 },
      },
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({
      json: {
        id: PROJECT_ID,
        name: "历史风衣项目",
        archived: false,
        createdAt: NOW,
        updatedAt: NOW,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
      },
    }),
  );
  await page.route("**/api/files/legacy-image/thumbnail/1024", (route) =>
    route.fulfill({
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='210' height='260'><rect width='210' height='260' fill='#e7e5de'/><path d='M45 65 85 30 125 30 165 65 170 225 40 225Z' fill='#334d60'/></svg>",
      contentType: "image/svg+xml",
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/board`, (route) => {
    boardMethods.push(route.request().method());
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 405, json: { message: "历史白板只读" } });
    }
    return route.fulfill({ json: board });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/workflow/sync`, (route) =>
    route.fulfill({ json: graph }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) => {
    if (route.request().method() !== "PATCH") {
      return route.fulfill({ json: graph });
    }
    const body = route.request().postDataJSON() as {
      mode: string;
      operations: Array<{
        type: string;
        node?: Record<string, unknown>;
      }>;
    };
    graphMutations.push(body as unknown as Record<string, unknown>);
    for (const operation of body.operations ?? []) {
      if (operation.type === "add_node" && operation.node) {
        graph.nodes.push({
          ...operation.node,
          status: "pending",
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    }
    graph = { ...graph, revision: graph.revision + 1 };
    return route.fulfill({ json: graph });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/agent-conversations*`, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/agent-conversations/*/messages*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );

  return {
    boardMethods,
    getGraph: () => graph,
    graphMutations,
  };
}

test("旧白板只读展示并导入图片、便签和色卡，旧数据始终只有 GET", async ({
  page,
}) => {
  const mocked = await mockLegacyWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await expect(page.getByRole("region", { name: "设计工作流画布" })).toBeVisible();
  expect(mocked.boardMethods).toEqual([]);

  await page.getByText("资料与更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史白板" }).click();
  const history = page.getByRole("dialog", { name: "历史白板" });
  await expect(history).toBeVisible();
  await expect(history.locator('[data-shape-id="shape:legacy-image"]')).toBeVisible();
  await expect(history.locator('[data-shape-id="shape:legacy-note"]')).toBeVisible();
  await expect(history.locator('[data-shape-id="shape:legacy-swatch"]')).toBeVisible();
  expect(mocked.boardMethods.length).toBeGreaterThan(0);
  expect(mocked.boardMethods.every((method) => method === "GET")).toBe(true);

  for (const [shapeId, expectedType, payloadKey, expectedValue] of [
    ["legacy-image", "reference_image", "fileAssetId", "legacy-image"],
    ["legacy-note", "reference_text", "text", "保留宽松肩线与通勤比例"],
    ["legacy-swatch", "swatch", "color", "#C8AB84"],
  ] as const) {
    const shape = history.locator(`[data-shape-id="shape:${shapeId}"]`);
    await shape.click();
    await expect(history.getByRole("button", { name: "加入当前工作流" })).toBeEnabled();
    await history.getByRole("button", { name: "加入当前工作流" }).click();
    await expect.poll(() => mocked.getGraph().nodes.length).toBe(
      shapeId === "legacy-image" ? 1 : shapeId === "legacy-note" ? 2 : 3,
    );
    const imported = mocked.getGraph().nodes.at(-1);
    expect(imported?.type).toBe(expectedType);
    const payload = imported?.payload as Record<string, unknown>;
    expect(payload.boardElementId).toBe(`shape:${shapeId}`);
    expect((payload.legacyBoard as { revision: number }).revision).toBe(4);
    expect(payload[payloadKey]).toBe(expectedValue);
  }
  expect(mocked.graphMutations).toHaveLength(3);
  expect(mocked.graphMutations.every((body) => body.mode === "semantic")).toBe(true);

  const note = history.locator('[data-shape-id="shape:legacy-note"]');
  await note.click();
  const originalPosition = await note.getAttribute("style");
  const noteBox = await note.boundingBox();
  expect(noteBox).not.toBeNull();
  await page.mouse.move((noteBox?.x ?? 0) + 40, (noteBox?.y ?? 0) + 40);
  await page.mouse.down();
  await page.mouse.move((noteBox?.x ?? 0) + 100, (noteBox?.y ?? 0) + 80, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(note).toHaveAttribute("style", originalPosition ?? "");
  await page.keyboard.press("Delete");
  await expect(note).toBeVisible();
  expect(mocked.boardMethods.every((method) => method === "GET")).toBe(true);
});

test("历史白板可导出包含旧素材的 PNG，导出过程不修改旧快照", async ({
  page,
}) => {
  const mocked = await mockLegacyWorkflow(page);
  await page.goto(`/${PROJECT_ID}`);
  await page.getByText("资料与更多", { exact: true }).click();
  await page.getByRole("button", { name: "历史白板" }).click();
  const history = page.getByRole("dialog", { name: "历史白板" });
  await expect(history.locator('[data-shape-id="shape:legacy-image"]')).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await history.getByRole("button", { name: "导出 PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `fashion-history-board-${PROJECT_ID}.png`,
  );
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  const png = await readFile(path as string);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(mocked.boardMethods.length).toBeGreaterThan(0);
  expect(mocked.boardMethods.every((method) => method === "GET")).toBe(true);
  expect(mocked.graphMutations).toHaveLength(0);
});
