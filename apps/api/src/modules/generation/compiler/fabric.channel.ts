import {
  FabricScope,
  FileStatus,
  type PrismaClient,
} from "@fashion/db";

import type {
  CompileResult,
  CompilerBoardElement,
  CompilerChannel,
  FabricGenerationInput,
  FabricReference,
} from "./compiler.types";
import { S3FileStorage } from "../../files/storage.service";

const DEFAULT_FABRIC_WEIGHT = 0.7;
const REFERENCE_URL_TTL_SECONDS = 24 * 60 * 60;
const WEAVES = new Set(["plain", "twill", "knit"]);
const TEXTURES = new Set(["smooth", "textured"]);
const DRAPES = new Set(["stiff", "moderate", "fluid"]);
const SHEENS = new Set(["matte", "subtle", "glossy"]);
const STRETCHES = new Set(["none", "slight", "high"]);
const OPACITIES = new Set(["opaque", "semi", "sheer"]);
const SEASONS = new Set(["spring", "summer", "autumn", "winter"]);
const USE_CASES = new Set([
  "shirt",
  "dress",
  "outerwear",
  "pants",
  "skirt",
  "suit",
]);

type FabricChannelDatabase = Pick<PrismaClient, "fabric">;

interface FabricElement {
  readonly element: CompilerBoardElement;
  readonly fabricId: string;
  readonly weight: number;
}

export class FabricChannel implements CompilerChannel {
  constructor(
    private readonly database: FabricChannelDatabase,
    private readonly userId: string,
    private readonly storage: Pick<S3FileStorage, "createDownloadUrl">,
  ) {}

  async compile(
    elements: readonly CompilerBoardElement[],
  ): Promise<CompileResult> {
    const fabricElements = elements.flatMap((element): FabricElement[] => {
      if (!isFabricElement(element)) return [];
      const props = contentOf(element.record);
      const fabricId = cleanIdentifier(props.fabricId);
      if (!fabricId) return [];
      return [
        {
          element,
          fabricId,
          weight: referenceWeight(props.weight),
        },
      ];
    });
    if (fabricElements.length === 0) {
      return { prompt: "", refImages: [] };
    }

    const fabricIds = [...new Set(fabricElements.map((item) => item.fabricId))];
    const fabrics = await this.database.fabric.findMany({
      where: {
        OR: [
          { scope: FabricScope.PRESET },
          { ownerId: this.userId, scope: FabricScope.USER },
        ],
        id: { in: fabricIds },
        status: { in: ["active", "archived"] },
      },
      select: {
        attributes: true,
        id: true,
        mainFile: {
          select: {
            objectKey: true,
            status: true,
            thumbnail1024Key: true,
          },
        },
        name: true,
        ownerId: true,
        scope: true,
      },
    });
    const fabricById = new Map(fabrics.map((fabric) => [fabric.id, fabric]));
    const prompts: string[] = [];
    const refImages: FabricReference[] = [];
    const fabricInputs: FabricGenerationInput[] = [];

    for (const item of fabricElements) {
      const fabric = fabricById.get(item.fabricId);
      if (!fabric) continue;
      const attributes = objectValue(fabric.attributes);
      const prompt = compileFabricPrompt(attributes);
      if (prompt) prompts.push(prompt);

      const lineage: FabricGenerationInput = {
        attributes: fabric.attributes,
        boardElementId: item.element.id,
        fabricId: fabric.id,
        role: "fabric_texture",
        weight: item.weight,
      };
      fabricInputs.push(lineage);

      if (fabric.mainFile.status === FileStatus.READY) {
        const objectKey =
          fabric.mainFile.thumbnail1024Key ?? fabric.mainFile.objectKey;
        refImages.push({
          elementId: item.element.id,
          fabricId: fabric.id,
          imageUrl: await this.storage.createDownloadUrl(
            objectKey,
            REFERENCE_URL_TTL_SECONDS,
          ),
          labels: fabricLabels(attributes),
          role: "fabric_texture",
          weight: item.weight,
        });
      }
    }

    if (fabricInputs.length === 0) {
      return { prompt: "", refImages: [] };
    }
    return {
      fabricInputs,
      prompt: [...new Set(prompts)].join("; "),
      refImages,
    };
  }
}

function isFabricElement(element: CompilerBoardElement): boolean {
  return (
    element.shapeType === "fabric" ||
    element.shapeType === "fashion-fabric" ||
    element.role.includes("fabric_ref")
  );
}

function contentOf(record: unknown): Record<string, unknown> {
  const root = objectValue(record);
  return objectValue(root.props ?? root.content ?? root);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 128 ? cleaned : null;
}

function referenceWeight(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : DEFAULT_FABRIC_WEIGHT;
}

function enumAttribute(value: unknown, allowed: ReadonlySet<string>) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase();
  return allowed.has(normalized) ? normalized : null;
}

function numberAttribute(value: unknown, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= max
    ? value
    : null;
}

function enumArrayAttribute(
  value: unknown,
  allowed: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        const normalized = enumAttribute(item, allowed);
        return normalized ? [normalized] : [];
      }),
    ),
  ];
}

function compositionEntries(
  value: unknown,
): readonly (readonly [string, number])[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const candidate = objectValue(item);
      const name = cleanCompositionName(candidate.name ?? candidate.fiber);
      const percentage = candidate.percentage ?? candidate.percent;
      return name && validPercentage(percentage)
        ? ([[name, percentage]] as readonly (readonly [string, number])[])
        : [];
    });
  }
  return Object.entries(objectValue(value)).flatMap(([name, percentage]) => {
    const cleanedName = cleanCompositionName(name);
    return cleanedName && validPercentage(percentage)
      ? ([[cleanedName, percentage]] as readonly (readonly [string, number])[])
      : [];
  });
}

function cleanCompositionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[^\p{L}\p{N}._ -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return cleaned || null;
}

function validPercentage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function formatPercentage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function fabricLabels(attributes: Record<string, unknown>): string[] {
  const composition = compositionEntries(attributes.composition).map(
    ([fiber, percentage]) => `${fiber} ${formatPercentage(percentage)}%`,
  );
  return [
    ...composition,
    enumAttribute(attributes.weave, WEAVES),
    enumAttribute(attributes.texture, TEXTURES),
    enumAttribute(attributes.drape, DRAPES),
    enumAttribute(attributes.sheen, SHEENS),
    enumAttribute(attributes.stretch, STRETCHES),
    enumAttribute(attributes.opacity, OPACITIES),
    ...enumArrayAttribute(attributes.seasonSuggestion, SEASONS),
    ...enumArrayAttribute(attributes.useCases, USE_CASES),
  ].filter((value): value is string => Boolean(value));
}

function compileFabricPrompt(attributes: Record<string, unknown>): string {
  const composition = compositionEntries(attributes.composition)
    .map(([fiber, percentage]) => `${fiber} ${formatPercentage(percentage)}%`)
    .join(", ");
  const weave = enumAttribute(attributes.weave, WEAVES);
  const texture = enumAttribute(attributes.texture, TEXTURES);
  const drape = enumAttribute(attributes.drape, DRAPES);
  const sheen = enumAttribute(attributes.sheen, SHEENS);
  const stretch = enumAttribute(attributes.stretch, STRETCHES);
  const opacity = enumAttribute(attributes.opacity, OPACITIES);
  const weight = numberAttribute(attributes.weight ?? attributes.gsm, 2_000);
  const width = numberAttribute(attributes.width, 1_000);
  const seasons = enumArrayAttribute(attributes.seasonSuggestion, SEASONS);
  const useCases = enumArrayAttribute(attributes.useCases, USE_CASES);
  return [
    composition ? `fabric material: ${composition}` : null,
    weave ? `weave type: ${weave}` : null,
    texture ? `fabric texture: ${texture}` : null,
    drape ? `drape: ${drape}` : null,
    sheen ? `sheen: ${sheen}` : null,
    weight ? `weight: ${weight} GSM` : null,
    stretch ? `stretch: ${stretch}` : null,
    opacity ? `opacity: ${opacity}` : null,
    width ? `fabric width: ${width} cm` : null,
    seasons.length ? `recommended seasons: ${seasons.join(", ")}` : null,
    useCases.length ? `use cases: ${useCases.join(", ")}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ");
}
