import type { Page } from "@playwright/test";
import type { StudioSummary } from "../../packages/shared/src/studio";

export async function seedCollectionWorkbench(
  page: Page,
  projectId: string,
  data: StudioSummary,
) {
  const now = "2026-11-15T00:00:00Z";
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const details = (id: string) => ({
    id,
    projectId,
    name: data.collections.find((item) => item.id === id)?.name ?? "新系列",
    createdAt: now,
    updatedAt: now,
    hero: {
      assetId: data.assets[0]?.id ?? "asset-front",
      url: "/visual-garment.svg",
      thumbnailUrl: null,
    },
    sourceGarmentType: { code: "jacket", label: "夹克" },
    dna: {
      extractionStatus: "ready",
      fabrics: ["哑光棉尼龙"],
      moodWords: ["克制"],
      palette: [{ hex: "#263950", name: "藏蓝" }],
      referenceFileIds: [],
      signatureDetails: [],
      silhouettes: ["宽松短款"],
      locks: {
        fabrics: false,
        moodWords: false,
        palette: false,
        silhouettes: false,
      },
      updatedAt: now,
    },
  });
  await page.route("**/api/collections**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const id = path.split("/")[3];
    if (method !== "GET")
      writes.push({ path, body: route.request().postDataJSON() });
    if (path === "/api/collections" && method === "POST") {
      const collection = { id: "collection-created", name: "新建系列" };
      data.collections.push(collection);
      return route.fulfill({ json: details(collection.id) });
    }
    if (path === "/api/collections")
      return route.fulfill({
        json: data.collections.map((item) => details(item.id)),
      });
    if (!id || !data.collections.some((item) => item.id === id))
      return route.fulfill({ status: 404, json: { message: "系列不存在" } });
    if (path.endsWith("/consistency"))
      return route.fulfill({
        json: {
          referenceLabel: "参考相似度",
          similarities: [],
          looks: [
            {
              assetId: "asset-front",
              analysisStatus: "ready",
              garmentType: { code: "jacket", label: "夹克" },
              isHero: true,
              ordinal: 0,
              similarityScore: null,
              slotKey: null,
              thumbnailUrl: null,
              url: "/visual-garment.svg",
              variationAxis: null,
              warningIgnored: false,
            },
          ],
        },
      });
    if (path.endsWith("/dna"))
      return route.fulfill({
        json: { ...details(id).dna, ...route.request().postDataJSON() },
      });
    return route.fulfill({ json: details(id) });
  });
  return { writes };
}
