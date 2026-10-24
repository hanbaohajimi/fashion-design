import {
  studioBrandSchema,
  studioSlotSchema,
  studioSampleSchema,
  studioPrintPatternSchema,
  studioPresentationSchema,
  type StudioDocumentView,
} from "../../packages/shared/src/studio";
import type { ExperimentView } from "../../packages/shared/src/experiments";
import {
  studioFixture,
  styleFixture,
  techPackFixture,
} from "../../apps/web/src/modules/studio/studio-test-fixtures";

const NOW = "2026-10-20T02:00:00.000Z";
function document(
  type: StudioDocumentView["type"],
  payload: StudioDocumentView["currentRevision"]["payload"],
): StudioDocumentView {
  const id = type.toLowerCase();
  const revision = { id: `${id}-r1`, revision: 1, payload, createdAt: NOW };
  return {
    id,
    type,
    version: 1,
    currentRevision: revision,
    revisions: [revision],
  };
}

export function workspaceFixture() {
  const style = styleFixture();
  style.currentRevision.views[0]!.url = "/visual-garment.svg";
  return studioFixture({
    styles: [style],
    assets: ["front", "back", "detail"].map((name) => ({
      id: `asset-${name}`,
      url: "/visual-garment.svg",
      thumbnailUrl: null,
    })),
    techPacks: [
      techPackFixture({
        bom: [
          {
            name: "主面料",
            material: "棉尼龙",
            quantity: 1.8,
            unit: "米",
            supplier: "供应商待确认",
            reviewed: false,
            source: "manual",
          },
        ],
        pom: [
          {
            name: "胸围",
            value: 112,
            unit: "cm",
            tolerance: 1,
            reviewed: false,
            source: "measured",
          },
        ],
        colors: [{ name: "藏蓝", hex: "#263950", reviewed: false }],
      }),
    ],
    brandProfiles: [
      document(
        "BRAND_PROFILE",
        studioBrandSchema.parse({
          name: "山岚",
          silhouettes: ["宽松短款"],
          signatureDetails: ["双口袋"],
          fabricPreferences: ["哑光棉尼龙"],
          avoid: ["大面积标识"],
          colors: [{ name: "藏蓝", hex: "#263950" }],
          referenceAssetIds: ["asset-front"],
        }),
      ),
    ],
    collections: [{ id: "collection-1", name: "城市漫步 · 秋冬" }],
    slots: [
      document(
        "COLLECTION_SLOT",
        studioSlotSchema.parse({
          name: "轻薄外套主推款",
          collectionId: "collection-1",
          category: "外套",
          role: "HERO",
          status: "DESIGNING",
          styleRevisionId: "style-r1",
        }),
      ),
    ],
    samples: [
      document(
        "SAMPLE_ROUND",
        studioSampleSchema.parse({
          name: "夹克首轮样衣",
          techPackRevisionId: "pack-r1",
          round: 1,
          photoAssetIds: ["asset-front"],
          issues: [
            {
              id: "issue-1",
              assetId: "asset-front",
              x: 0.4,
              y: 0.55,
              category: "FIT",
              text: "检查口袋位置与衣身比例",
              status: "OPEN",
            },
          ],
        }),
      ),
    ],
    patterns: [
      document(
        "PRINT_PATTERN",
        studioPrintPatternSchema.parse({
          name: "细条纹习作",
          sourceAssetId: "asset-detail",
        }),
      ),
    ],
    presentationSets: [
      document(
        "PRESENTATION_SET",
        studioPresentationSchema.parse({
          name: "夹克商品展示",
          styleRevisionId: "style-r1",
          items: [
            {
              assetId: "asset-front",
              kind: "front",
              label: "夹克正面",
              reviewed: false,
            },
          ],
        }),
      ),
    ],
    members: [
      {
        id: "member-1",
        userId: "visual-designer",
        email: "designer@example.com",
        role: "OWNER",
        version: 1,
      },
    ],
  });
}

export function experimentFixture(projectId: string): ExperimentView[] {
  return [
    {
      id: "visual-batch",
      projectId,
      sourceAssetId: "asset-front",
      version: 1,
      mode: "color",
      preserve: "保留廓形和口袋结构",
      createdAt: NOW,
      items: [
        {
          id: "complete",
          title: "藏蓝方案",
          prompt: "保持结构，探索藏蓝",
          status: "succeeded",
          attempt: 0,
          taskId: null,
          error: null,
          color: { name: "藏蓝", hex: "#263950" },
          fabric: null,
          assets: [
            {
              id: "asset-front",
              url: "/visual-garment.svg",
              thumbnailUrl: null,
            },
          ],
        },
        {
          id: "failed",
          title: "暖灰方案",
          prompt: "保持结构，探索暖灰",
          status: "failed",
          attempt: 1,
          taskId: null,
          error: "生成暂时失败，可重试此项",
          color: { name: "暖灰", hex: "#A59D90" },
          fabric: null,
          assets: [],
        },
      ],
    },
  ];
}
