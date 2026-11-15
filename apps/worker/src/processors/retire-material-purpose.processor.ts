import type { PrismaClient } from "@fashion/db";
import type { VlmInferenceJobData } from "@fashion/shared";

/** Drain queued legacy label work without invoking a model or changing source files. */
export async function retireMaterialPurposeJob(database: Pick<PrismaClient, "boardElement">, job: VlmInferenceJobData) {
  await database.boardElement.updateMany({ where: { projectId: job.projectId, shapeId: job.shapeId, fileAssetId: job.fileId, roleInferenceState: "PENDING" },
    data: { role: "reference", roleInferenceState: "NONE", roleConfidence: null, roleLabel: null, roleSource: "DEFAULT" } });
}
