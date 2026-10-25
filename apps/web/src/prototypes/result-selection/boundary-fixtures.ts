import { fabricDetailsSchema, type StudioTechPack } from "@fashion/shared";
import type { Fabric } from "../../modules/fabrics/fabric-types";
import type { Project } from "../../modules/projects/project-types";
import { createTechPackDraft } from "../../modules/studio/tech-pack-draft";
import { garmentImage, type FixtureMode } from "./fixtures";

const date = "2026-10-25T00:00:00.000Z";
const count = (mode: FixtureMode) =>
  mode === "empty" ? 0 : mode === "one" ? 1 : 3;
export function boundaryProjects(mode: FixtureMode): Project[] {
  return Array.from({ length: count(mode) }, (_, index) => ({
    id: `fixture-project-${index}`,
    name:
      mode === "worst"
        ? index === 0
          ? "衣".repeat(80)
          : index === 1
            ? "🧵".repeat(40)
            : "Z".repeat(80)
        : `秋冬通勤系列 ${index + 1}`,
    createdAt: date,
    updatedAt: date,
    archived: false,
    assetCount: index === 0 ? 0 : 123456,
    coverAssetId: null,
    coverUrl:
      mode === "worst" && index === 1
        ? "/prototype-missing-image"
        : index === 0
          ? null
          : garmentImage(index, "#727c70"),
  }));
}
export function boundaryFabrics(mode: FixtureMode): Fabric[] {
  const total = mode === "large" ? 1000 : count(mode);
  return Array.from({ length: total }, (_, index) => ({
    id: `fixture-fabric-${index}`,
    canManage: false,
    scope: "preset",
    createdAt: date,
    updatedAt: date,
    mainFileId: `fixture-image-${index}`,
    mainImageUrl:
      mode === "worst" && index === 1
        ? "/prototype-missing-image"
        : garmentImage(index, "#727c70"),
    tags:
      mode === "worst"
        ? Array.from({ length: 12 }, (_, tag) => `${tag}`.padEnd(30, "纹"))
        : ["棉麻", "斜纹"],
    details: fabricDetailsSchema.parse(
      mode === "worst"
        ? {
            name: "长名称面料".repeat(24),
            code: "FABRIC".padEnd(80, "X"),
            category: "梭织".repeat(40),
            supplier: "供应商".repeat(53) + "厂",
            weightGsm: 10000,
            widthCm: 1000,
            price: 100000000,
            unit: "米",
            currency: "CNY",
            moq: 0,
            provenance: Object.fromEntries(
              [
                "supplier",
                "weightGsm",
                "widthCm",
                "price",
                "unit",
                "currency",
                "moq",
              ].map((field) => [field, { source: "supplier" }]),
            ),
          }
        : { name: `棉麻斜纹 ${index + 1}` },
    ),
  }));
}
export function boundaryTechPack(mode: FixtureMode) {
  const rows = mode === "large" ? 100 : count(mode);
  const pack: StudioTechPack = {
    name: "通勤风衣技术资料",
    styleRevisionId: "fixture-style",
    status: "DRAFT",
    views: [],
    annotations: [],
    colors: [],
    constructionNotes: "",
    reviewConfirmed: false,
    bom: Array.from({ length: rows }, (_, index) => ({
      name: mode === "worst" ? "材料".repeat(60) : `主料 ${index + 1}`,
      material: mode === "worst" ? "纹理说明".repeat(500) : "棉麻斜纹",
      quantity: index === 0 ? null : 0.0001,
      unit: "米",
      supplier: mode === "worst" ? "供".repeat(2000) : "面料供应商",
      source: "supplier",
      reviewed: false,
    })),
    pom: Array.from({ length: rows }, (_, index) => ({
      name: `测量部位 ${index + 1}`,
      value: index === 0 ? null : 0.0001,
      tolerance: 0,
      unit: "cm",
      source: "measured",
      reviewed: false,
    })),
  };
  return createTechPackDraft(pack);
}
