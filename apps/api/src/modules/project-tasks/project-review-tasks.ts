import type { Prisma } from "@fashion/db";

/** Pending reviews are live work, independent of the recent terminal sample. */
export function pendingProjectReviews(projectId: string, userId: string): Prisma.StudioDocumentWhereInput {
  return {
    projectId,
    type: "REVIEW",
    payload: { path: ["decision"], equals: "CHANGES_REQUESTED" },
    reviewReads: { none: { userId } },
  };
}

export function endedProjectReviews(projectId: string, userId: string): Prisma.StudioDocumentWhereInput {
  return {
    projectId,
    type: "REVIEW",
    OR: [
      { payload: { path: ["decision"], equals: "APPROVED" } },
      { payload: { path: ["decision"], equals: "CHANGES_REQUESTED" }, reviewReads: { some: { userId } } },
    ],
  };
}
