import type {
  StudioDocumentView,
  StudioStyleView,
  StudioSummary,
  StudioTechPack,
} from "@fashion/shared";

export function studioFixture(
  overrides: Partial<StudioSummary> = {},
): StudioSummary {
  return {
    role: "OWNER",
    capabilities: { edit: true, review: true, manageMembers: true },
    styles: [],
    brandProfiles: [],
    slots: [],
    techPacks: [],
    samples: [],
    comments: [],
    reviews: [],
    patterns: [],
    presentationSets: [],
    members: [],
    collections: [],
    assets: [
      { id: "asset-front", url: "/images/front.png", thumbnailUrl: null },
      { id: "asset-back", url: "/images/back.png", thumbnailUrl: null },
      { id: "asset-detail", url: "/images/detail.png", thumbnailUrl: null },
    ],
    ...overrides,
  };
}
export function styleFixture(): StudioStyleView {
  const payload = {
    name: "褶线夹克",
    code: "JK-027",
    category: "夹克",
    season: "春夏",
    description: "宽松短款",
    sourceAssetId: "asset-front",
    views: [
      {
        kind: "front" as const,
        assetId: "asset-front",
        label: "正面",
        reviewed: false,
      },
    ],
    status: "DESIGNING" as const,
    changeNote: "选用完整口袋结构",
  };
  const currentRevision = {
    id: "style-r1",
    revision: 1,
    payload,
    createdAt: "2026-10-21T00:00:00Z",
    views: payload.views.map((view) => ({
      ...view,
      url: "/images/front.png",
      thumbnailUrl: null,
    })),
  };
  return {
    id: "style-1",
    code: payload.code,
    name: payload.name,
    category: payload.category,
    season: payload.season,
    status: payload.status,
    version: 1,
    currentRevision,
    revisions: [currentRevision],
  };
}
export function techPackFixture(
  payload: Partial<StudioTechPack> = {},
): StudioDocumentView {
  const pack: StudioTechPack = {
    name: "褶线夹克技术资料",
    styleRevisionId: "style-r1",
    status: "DRAFT",
    views: [
      { kind: "front", assetId: "asset-front", label: "正面", reviewed: true },
    ],
    annotations: [],
    bom: [],
    pom: [],
    colors: [],
    constructionNotes: "",
    reviewConfirmed: false,
    ...payload,
  };
  const revision = {
    id: "pack-r1",
    revision: 1,
    payload: pack,
    createdAt: "2026-10-21T00:00:00Z",
  };
  return {
    id: "pack-1",
    type: "TECH_PACK",
    version: 1,
    currentRevision: revision,
    revisions: [revision],
  };
}
