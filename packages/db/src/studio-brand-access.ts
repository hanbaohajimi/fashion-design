import type { PrismaClient } from "../generated/prisma/client.js";

type BoundRevision = {
  documentId: string;
  revision: number;
  type: string;
  payload: unknown;
};

/** Call after project access is checked. Retaining an explicitly bound shared
 * document does not grant general access to its author's private brand library. */
export async function readAuthorizedStudioBrand(
  database: Pick<PrismaClient, "studioDocument">,
  input: { projectId: string; actorId: string; brandRevisionId: string; inherited?: BoundRevision },
) {
  const previous = input.inherited;
  const retaining = Boolean(previous && ["TECH_PACK", "PRESENTATION_SET"].includes(previous.type)
    && previous.payload && typeof previous.payload === "object"
    && (previous.payload as Record<string, unknown>).brandRevisionId === input.brandRevisionId);
  const brand = await database.studioDocument.findFirst({
    where: { id: input.brandRevisionId, projectId: input.projectId, type: "BRAND_PROFILE", ...(retaining ? {} : { ownerId: input.actorId }) },
    select: { id: true, type: true, ownerId: true, revision: true, payload: true },
  });
  if (!brand) return null;
  if (brand.ownerId === input.actorId) return brand;
  if (!retaining || !previous) return null;
  const authorizedBinding = await database.studioDocument.findFirst({
    where: {
      projectId: input.projectId,
      documentId: previous.documentId,
      revision: { lte: previous.revision },
      type: { in: ["TECH_PACK", "PRESENTATION_SET"] },
      payload: { path: ["brandRevisionId"], equals: brand.id },
      OR: [{ createdById: brand.ownerId }, { createdById: null, ownerId: brand.ownerId }],
    },
    select: { id: true },
  });
  return authorizedBinding ? brand : null;
}
