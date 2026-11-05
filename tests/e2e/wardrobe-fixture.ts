import type { Page } from "@playwright/test";
import type { OutfitView, WardrobeCategory, WardrobeRevisionView, WardrobeSummary } from "../../packages/shared/src/wardrobe";
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";
import { workspaceFixture } from "../visual/workspace-fixture";

/** Deliberately geometric transparent fixtures, NOT generated garments or provider evidence. */
const fixtures: { category: WardrobeCategory; name: string; shape: string; color: string }[] = [
  { category: "top", name: "测试短上衣", color: "#b8a392", shape: "M90 50 135 30Q150 65 165 30L210 50 265 145 220 175 200 135 200 280 100 280 100 135 80 175 35 145Z" },
  { category: "outerwear", name: "测试长外套", color: "#344c43", shape: "M90 50 130 20 150 65 170 20 210 50 270 210 225 230 205 150 210 430 90 430 95 150 75 230 30 210Z" },
  { category: "bottom", name: "测试裤装", color: "#68737c", shape: "M85 35 215 35 225 410 165 410 150 165 135 410 75 410Z" },
  { category: "onepiece", name: "测试连衣裙", color: "#a47060", shape: "M105 35 135 20Q150 55 165 20L195 35 215 100 185 120 175 180 250 420 50 420 125 180 115 120 85 100Z" },
  { category: "shoes", name: "测试运动鞋", color: "#b5ae95", shape: "M35 200 100 220 130 200 170 250 260 275Q290 300 265 320L35 320Z" },
  { category: "bag", name: "测试手提包", color: "#7f5d40", shape: "M90 150V110Q90 45 150 45Q210 45 210 110V150H240L265 350H35L60 150ZM115 150H185V110Q185 70 150 70Q115 70 115 110Z" },
];
const svg = (index: number) => {
  const item = fixtures[index % fixtures.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="460" viewBox="0 0 300 460"><path d="${item.shape}" fill="${item.color}" fill-rule="evenodd" stroke="#594d43" stroke-width="2"/></svg>`;
};

export async function seedWardrobe(page: Page, options: { empty?: boolean; readonly?: boolean; many?: boolean; failed?: boolean } = {}) {
  await seedVisualApp(page);
  const count = options.empty ? 0 : options.many ? 26 : 6;
  const revisions: WardrobeRevisionView[] = Array.from({ length: count }, (_, index) => {
    const fixture = fixtures[index % fixtures.length]!;
    return {
      id: `revision-${index}`, itemId: `item-${index}`, version: 1,
      sourceAssetId: `source-${index}`, assetId: `confirmed-${index}`, name: fixture.name + (index >= 6 ? ` ${index}` : ""),
      category: fixture.category, display: fixture.category === "bottom" ? "clips" : fixture.category === "shoes" ? "shelf" : fixture.category === "bag" ? "hook" : "hanger",
      anchor: { x: 0.5, y: fixture.category === "shoes" ? 320 / 460 : 0.08 }, reviewed: true, sourceKind: "isolated", generatedCompletion: false,
      url: `/wardrobe-fixture-${index}.svg`, createdAt: NOW,
    };
  });
  const summary: WardrobeSummary = {
    projectId: PROJECT, canEdit: !options.readonly,
    capabilities: { enabled: true, preparationEnabled: true, staticTryOnEnabled: true, realtimeOutfitEnabled: false, realtimeMultiItemVerified: false, realtimeCategories: ["top"] },
    items: revisions.map(revision => ({ id: revision.itemId, projectId: PROJECT, name: revision.name, archived: false, version: 1, currentRevision: revision, revisions: [revision] })),
    preparations: [], outfits: [], tryOns: [],
  };
  const requests: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  const blocked: string[] = [];
  await page.route("**/wardrobe-fixture-*.svg", route => {
    const index = Number(/wardrobe-fixture-(\d+)/u.exec(route.request().url())?.[1] ?? 0);
    return route.fulfill({ contentType: "image/svg+xml", body: svg(index) });
  });
  const studio = workspaceFixture();
  studio.capabilities.edit = !options.readonly;
  studio.assets.push({ id: "model-original", url: "/visual-garment.svg", thumbnailUrl: null });
  await page.route(`**/api/projects/${PROJECT}/studio`, route => route.fulfill({ json: studio }));
  await page.route("**/api/realtime-tryon/**", route => route.fulfill({ json: {
    enabled: false, configured: false, accessMode: "internal", provider: "decart", modelId: "lucy-vton-3.6",
    maxSessionSeconds: 60, maxGarmentBytes: 5242880, estimatedUsdPerSecond: null, priceVerifiedAt: null, unavailableReason: "实时试穿尚未启用",
  } }));
  await page.route(/https?:\/\/([^/]*\.)?decart\.ai\//u, route => { blocked.push(route.request().url()); return route.abort("blockedbyclient"); });
  await page.route(`**/api/projects/${PROJECT}/wardrobe**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.method() === "GET" ? null : request.postDataJSON() as Record<string, unknown>;
    requests.push({ method: request.method(), path, body });
    if (options.failed) return route.fulfill({ status: 503, json: { message: "衣架暂时不可用，请重试" } });
    if (request.method() === "GET") return route.fulfill({ json: summary });
    if (path.endsWith("/prepare")) {
      const preparation = { id: `preparation-${summary.preparations.length}`, projectId: PROJECT, sourceAssetId: String(body!.sourceAssetId),
        name: String(body!.name), category: body!.category as WardrobeCategory, sourceKind: "isolated" as const, mode: "existing" as const,
        status: "ready" as const, taskId: null, error: null, candidates: [{ assetId: "candidate-fixture", url: "/wardrobe-fixture-0.svg" }], createdAt: NOW };
      summary.preparations.push(preparation);
      return route.fulfill({ json: preparation });
    }
    if (path.endsWith("/confirm")) {
      const preparation = summary.preparations.find(value => value.id === body!.preparationId)!;
      const revision: WardrobeRevisionView = { id: `confirmed-revision-${summary.items.length}`, itemId: `confirmed-item-${summary.items.length}`, version: 1,
        sourceAssetId: preparation.sourceAssetId, assetId: "candidate-fixture", name: String(body!.name), category: body!.category as WardrobeCategory,
        display: "hanger", anchor: body!.anchor as { x: number; y: number }, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: "/wardrobe-fixture-0.svg", createdAt: NOW };
      revisions.push(revision);
      const item = { id: revision.itemId, projectId: PROJECT, name: revision.name, archived: false, version: 1, currentRevision: revision, revisions: [revision] };
      summary.items.push(item);
      return route.fulfill({ json: item });
    }
    if (path.endsWith("/outfits")) {
      const input = body as unknown as { outfitId?: string; name: string; layeringConfirmed?: boolean; items: { revisionId: string; layer: number; wearNote: string }[] };
      const old = summary.outfits.find(outfit => outfit.id === input.outfitId);
      const version = (old?.version ?? 0) + 1;
      const id = old?.id ?? `outfit-${summary.outfits.length}`;
      const snapshot = { id: `${id}-snapshot-${version}`, outfitId: id, projectId: PROJECT, version, name: input.name, layeringConfirmed: input.layeringConfirmed ?? false,
        items: input.items.map(item => ({ ...revisions.find(revision => revision.id === item.revisionId)!, layer: item.layer, wearNote: item.wearNote })), prompt: "完整测试搭配", createdAt: NOW };
      const outfit: OutfitView = { id, projectId: PROJECT, name: input.name, version, currentSnapshot: snapshot, snapshots: [...(old?.snapshots ?? []), snapshot] };
      summary.outfits = [...summary.outfits.filter(item => item.id !== id), outfit];
      return route.fulfill({ json: outfit });
    }
    if (path.endsWith("/tryon")) {
      const task = { id: `tryon-${summary.tryOns.length}`, snapshotId: String(body!.snapshotId), modelAssetId: String(body!.modelAssetId), taskId: "task-fixture", status: "queued" as const, error: null, results: [], createdAt: NOW };
      summary.tryOns.push(task);
      return route.fulfill({ json: task });
    }
    if (request.method() === "PATCH") {
      const item = summary.items.find(value => path.endsWith(`/${value.id}`))!;
      item.archived = Boolean(body!.archived); item.version += 1;
      return route.fulfill({ json: item });
    }
    return route.fulfill({ status: 400, json: { message: "未模拟的测试操作" } });
  });
  return { summary, requests, blocked };
}
