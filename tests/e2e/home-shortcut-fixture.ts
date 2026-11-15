import type { Page } from "@playwright/test";
import { prepareZhiya } from "./zhiya-fixture";
import { PROJECT, NOW } from "../visual/fixtures";
import { studioFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import {
  createCanvasCreationSchema,
  updateCanvasCreationSchema,
  type CanvasCreation,
} from "../../packages/shared/src/canvas-creations";
import type {
  CanvasDocumentView,
  CanvasSave,
} from "../../packages/shared/src/canvas-workspace";

type MutableCreation = {
  -readonly [Key in keyof CanvasCreation]: CanvasCreation[Key];
};

export async function prepareHomeShortcut(page: Page, width = 1440) {
  const base = await prepareZhiya(page, {
    realClock: true,
    count: 0,
    viewport: { width, height: width < 768 ? 844 : 900 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const projects = new Map<string, ReturnType<typeof project>>();
  const projectReceipts = new Map<string, string>();
  const projectRequests: string[] = [];
  const creationRequests: { projectId: string; id: string }[] = [];
  const records = new Map<string, MutableCreation[]>();
  const documents = new Map<string, CanvasDocumentView>();
  let loseCreate = false,
    loseModule = false;
  let creationHold: Promise<void> | null = null;
  function project(id: string) {
    return {
      id,
      name: "未命名项目",
      archived: false,
      assetCount: 0,
      coverAssetId: null,
      coverUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }
  const document = (id: string) => {
    let value = documents.get(id);
    if (!value) {
      value = {
        projectId: id,
        mode: "canvas",
        revision: 0,
        formatVersion: 1,
        initializedFrom: "workflow",
        canEdit: true,
        snapshot: {},
        bindings: [],
      };
      documents.set(id, value);
    }
    return value;
  };
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const key = route.request().headers()["idempotency-key"] ?? "";
    projectRequests.push(key);
    let id = projectReceipts.get(key);
    if (!id) {
      id = `shortcut-project-${projects.size + 1}`;
      projectReceipts.set(key, id);
      projects.set(id, project(id));
    }
    if (creationHold) await creationHold;
    if (loseCreate) {
      loseCreate = false;
      return route.fulfill({
        status: 503,
        json: { message: "模拟项目创建回执中断" },
      });
    }
    return route.fulfill({ json: projects.get(id) });
  });
  await page.route(/\/api\/projects\/[^/?]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    return projects.has(id)
      ? route.fulfill({ json: projects.get(id) })
      : route.fallback();
  });
  await page.route(/\/api\/projects\/[^/]+\/studio$/, (route) =>
    route.fulfill({ json: studioFixture({ assets: [] }) }),
  );
  await page.route(/\/api\/projects\/[^/]+\/experiments(?:\?.*)?$/, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(/\/api\/projects\/[^/]+\/wardrobe$/, (route) =>
    route.fulfill({
      json: {
        projectId: new URL(route.request().url()).pathname.split("/")[3],
        canEdit: true,
        items: [],
        outfits: [],
        preparations: [],
        tryOns: [],
        capabilities: {
          enabled: true,
          preparationEnabled: true,
          staticTryOnEnabled: true,
          realtimeOutfitEnabled: true,
          realtimeMultiItemVerified: true,
          realtimeCategories: ["top"],
        },
      },
    }),
  );
  await page.route("**/api/realtime-tryon/capabilities", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        configured: false,
        accessMode: "internal",
        provider: "decart",
        modelId: "lucy-vton-3.6",
        maxSessionSeconds: 60,
        maxGarmentBytes: 5242880,
        estimatedUsdPerSecond: null,
        priceVerifiedAt: null,
      },
    }),
  );
  await page.route(/\/api\/projects\/[^/]+\/runway\/capabilities$/, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        workerOnline: true,
        mode: "mock",
        canEdit: true,
        capabilities: { image: true, video: true, music: true },
      },
    }),
  );
  await page.route(/\/api\/projects\/[^/]+\/runway\/shows$/, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    /\/api\/projects\/[^/]+\/canvas(?:\/initialize)?$/,
    (route) => {
      const id =
        new URL(route.request().url()).pathname.split("/")[3] ?? PROJECT;
      let value = document(id);
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON() as CanvasSave;
        value = {
          ...value,
          revision: value.revision + 1,
          snapshot: input.snapshot,
          bindings: input.bindings.map((item) => ({ ...item, removed: false })),
        };
        documents.set(id, value);
      }
      return route.fulfill({ json: value });
    },
  );
  await page.route(
    /\/api\/projects\/[^/]+\/canvas\/creations(?:\/[^/?]+)?$/,
    (route) => {
      const parts = new URL(route.request().url()).pathname.split("/");
      const projectId = parts[3] ?? PROJECT;
      const items = records.get(projectId) ?? [];
      records.set(projectId, items);
      if (route.request().method() === "GET")
        return route.fulfill({ json: { items, canEdit: true } });
      if (parts.at(-1) === "creations") {
        const input = createCanvasCreationSchema.parse(
          route.request().postDataJSON(),
        );
        creationRequests.push({ projectId, id: input.id });
        let item = items.find((item) => item.id === input.id);
        if (!item) {
          item = {
            ...input,
            projectId,
            revision: 0,
            position: input.position ?? null,
            resource: null,
            currentResult: null,
            currentResultNodeId: null,
            runs: [],
            removed: false,
            createdAt: NOW,
            updatedAt: NOW,
          };
          items.push(item);
        }
        if (loseModule) {
          loseModule = false;
          return route.fulfill({
            status: 503,
            json: { message: "模拟功能准备回执中断" },
          });
        }
        return route.fulfill({ json: item });
      }
      const item = items.find((item) => item.id === parts.at(-1));
      if (!item)
        return route.fulfill({ status: 404, json: { message: "目标不存在" } });
      const input = updateCanvasCreationSchema.parse(
        route.request().postDataJSON(),
      );
      if (input.draft) item.draft = input.draft;
      if (input.resource) item.resource = input.resource;
      item.revision++;
      return route.fulfill({ json: item });
    },
  );
  return Object.assign(base, {
    projects,
    projectRequests,
    creationRequests,
    records,
    documents,
    loseCreate: () => {
      loseCreate = true;
    },
    loseModule: () => {
      loseModule = true;
    },
    holdCreation: () => {
      let release = () => {};
      creationHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        creationHold = null;
        release();
      };
    },
  });
}
