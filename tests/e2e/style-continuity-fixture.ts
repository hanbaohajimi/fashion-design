import type { Page } from "@playwright/test";
import {
  createStudioStyleSchema,
  updateStudioStyleSchema,
  studioDocumentInputSchema,
  type StudioDocumentView,
  type StudioStyleView,
} from "../../packages/shared/src/studio";
import { studioFixture, styleFixture } from "../../apps/web/src/modules/studio/studio-test-fixtures";
import { prepareImageOrientation } from "./image-orientation-fixture";
import { PROJECT, NOW } from "../visual/fixtures";

export async function prepareStyleContinuity(page: Page, options: { width?: number; empty?: boolean; history?: boolean } = {}) {
  const canvas = await prepareImageOrientation(page, options.width ?? 1440, options.width === 320 ? 740 : 900);
  const first = styleFixture();
  first.name = "藏蓝通勤外套";
  first.currentRevision.payload = { ...first.currentRevision.payload, name: first.name, sourceAssetId: "look-0", views: [{ kind: "front", assetId: "look-0", label: "外套正面", reviewed: true }] };
  first.currentRevision.views = first.currentRevision.payload.views.map(view => ({ ...view, url: "/api/design-assets/look-0/content", thumbnailUrl: null }));
  first.revisions = [first.currentRevision];
  const original = structuredClone(first.currentRevision);
  if (options.history) {
    first.version = 2;
    first.name = "通勤外套加长版";
    first.currentRevision = { ...original, id: "style-r2", revision: 2, payload: { ...original.payload, name: first.name, changeNote: "加长衣身" } };
    first.revisions = [first.currentRevision, original];
  }
  const other = structuredClone(first);
  other.id = "other-style";
  other.name = "另一款夹克";
  other.code = "JK-OTHER";
  other.version = 1;
  other.currentRevision = { ...original, id: "other-r1", payload: { ...original.payload, name: other.name, code: other.code } };
  other.revisions = [other.currentRevision];
  let data = studioFixture({ styles: options.empty ? [other] : [other, first] });
  const staleData = structuredClone(data);
  let reading: "current" | "stale" | "fail" = "current";
  let delayedStyle: Promise<void> | undefined;
  let lostSave: "before" | "after" | undefined;
  const styleRequests: { method: string; body: ReturnType<typeof updateStudioStyleSchema.parse> | ReturnType<typeof createStudioStyleSchema.parse> }[] = [];
  const documentRequests: ReturnType<typeof studioDocumentInputSchema.parse>[] = [];
  const invalid: string[] = [];
  const confirmed = new Map<string, StudioStyleView | StudioDocumentView>();
  const admitted = new Map<string, string>();
  const assets = () => [...canvas.assets.keys()].map(id => ({ id, url: `/api/design-assets/${id}/content`, thumbnailUrl: null }));
  await page.route(`**/api/projects/${PROJECT}/studio**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === `/api/projects/${PROJECT}/studio` && request.method() === "GET") {
      return reading === "fail"
        ? route.fulfill({ status: 503, json: { message: "资料列表暂时无法读取" } })
        : route.fulfill({ json: { ...(reading === "stale" ? staleData : data), assets: assets() } });
    }
    if (path.includes("/studio/styles") && ["POST", "PATCH"].includes(request.method())) {
      const parsed = (request.method() === "PATCH" ? updateStudioStyleSchema : createStudioStyleSchema).safeParse(request.postDataJSON());
      if (!parsed.success) { invalid.push(parsed.error.message); return route.fulfill({ status: 400, json: { message: parsed.error.message } }); }
      const body = parsed.data;
      styleRequests.push({ method: request.method(), body });
      if (confirmed.has(body.requestKey)) {
        if (admitted.get(body.requestKey) !== JSON.stringify({ path, body })) return route.fulfill({ status: 409, json: { message: "相同请求编号不能用于不同内容" } });
        const saved = confirmed.get(body.requestKey) as StudioStyleView;
        return route.fulfill({ json: data.styles.find(style => style.id === saved.id) ?? saved });
      }
      if (lostSave === "before") { lostSave = undefined; return route.fulfill({ status: 503, json: { message: "保存连接中断，尚未收到确认" } }); }
      const current = request.method() === "PATCH" ? data.styles.find(style => path.endsWith(`/${style.id}`)) : undefined;
      if (request.method() === "PATCH" && (!current || !("expectedVersion" in body) || body.expectedVersion !== current.version)) return route.fulfill({ status: 409, json: { message: "款式已有新修订" } });
      const payload = createStudioStyleSchema.omit({ requestKey: true }).strip().parse(body);
      const id = current?.id ?? `created-style-${styleRequests.length}`;
      const version = (current?.version ?? 0) + 1;
      const revision = { id: `${id}-r${version}`, revision: version, payload, createdAt: NOW, views: payload.views.map(view => ({ ...view, url: `/api/design-assets/${view.assetId}/content`, thumbnailUrl: null })) };
      const style: StudioStyleView = { id, code: payload.code, name: payload.name, category: payload.category, season: payload.season, status: payload.status, version, currentRevision: revision, revisions: [revision, ...(current?.revisions ?? [])] };
      data = { ...data, styles: current ? data.styles.map(item => item.id === id ? style : item) : [...data.styles, style] };
      confirmed.set(body.requestKey, style);
      admitted.set(body.requestKey, JSON.stringify({ path, body }));
      if (lostSave === "after") { lostSave = undefined; return route.fulfill({ status: 503, json: { message: "保存连接中断，尚未收到确认" } }); }
      if (delayedStyle) {
        const pending = delayedStyle;
        delayedStyle = undefined;
        await pending;
      }
      return route.fulfill({ json: style });
    }
    if (path.endsWith("/studio/documents") && request.method() === "POST") {
      const parsed = studioDocumentInputSchema.safeParse(request.postDataJSON());
      if (!parsed.success) { invalid.push(parsed.error.message); return route.fulfill({ status: 400, json: { message: parsed.error.message } }); }
      const body = parsed.data;
      documentRequests.push(body);
      if (confirmed.has(body.requestKey)) {
        if (admitted.get(body.requestKey) !== JSON.stringify({ path, body })) return route.fulfill({ status: 409, json: { message: "相同请求编号不能用于不同内容" } });
        const saved = confirmed.get(body.requestKey) as StudioDocumentView;
        return route.fulfill({ json: [...data.techPacks, ...data.presentationSets].find(document => document.id === saved.id) ?? saved });
      }
      if (lostSave === "before") { lostSave = undefined; return route.fulfill({ status: 503, json: { message: "保存连接中断，尚未收到确认" } }); }
      if (body.type !== "TECH_PACK" && body.type !== "PRESENTATION_SET") throw new Error("仅验证技术包和展示包");
      const field = body.type === "TECH_PACK" ? "techPacks" : "presentationSets";
      const current = data[field].find(document => document.id === body.documentId);
      if (body.documentId && (!current || current.version !== body.expectedVersion)) return route.fulfill({ status: 409, json: { message: "资料已有新修订" } });
      const version = (current?.version ?? 0) + 1;
      const id = current?.id ?? `${body.type.toLowerCase()}-${documentRequests.length}`;
      const revision = { id: `${id}-r${version}`, revision: version, payload: body.payload, createdAt: NOW };
      const document: StudioDocumentView = { id, type: body.type, version, currentRevision: revision, revisions: [revision, ...(current?.revisions ?? [])] };
      data = { ...data, [field]: current ? data[field].map(item => item.id === id ? document : item) : [...data[field], document] };
      confirmed.set(body.requestKey, document);
      admitted.set(body.requestKey, JSON.stringify({ path, body }));
      if (lostSave === "after") { lostSave = undefined; return route.fulfill({ status: 503, json: { message: "保存连接中断，尚未收到确认" } }); }
      return route.fulfill({ json: document });
    }
    return route.fallback();
  });
  return { ...canvas, styleRequests, documentRequests, invalid, original, getData: () => data, setReads: (value: typeof reading) => { reading = value; }, loseNextSave: (mode: "before" | "after") => { lostSave = mode; }, delayNextStyleResponse: () => {
    let release!: () => void;
    delayedStyle = new Promise<void>(resolve => { release = resolve; });
    return () => release();
  } };
}
