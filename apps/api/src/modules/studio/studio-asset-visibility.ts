import { Prisma } from "@fashion/db";

/** Diagnostic masks and provider probes are not ordinary creative outputs. */
export function visibleStudioAssets(projectId: string): Prisma.DesignAssetWhereInput {
  return { projectId, AND: [
    { OR: [{ designStep: { is: null } }, { designStep: { is: { tool: { notIn: ["wardrobe-material-mask", "wardrobe-material-detail", "wardrobe-correction-guide"] } } } }] },
    { OR: [
      { generationTask: { is: null } },
      { generationTask: { is: { compiledPrompt: { equals: Prisma.AnyNull } } } },
      { generationTask: { is: { compiledPrompt: { path: ["notes"], equals: Prisma.AnyNull } } } },
      { generationTask: { is: { NOT: { compiledPrompt: { path: ["notes"], array_contains: ["wardrobe-material-alpha-probe:v1"] } } } } },
    ] },
  ] };
}
