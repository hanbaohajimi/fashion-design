import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@fashion/db";
import { directMutationId } from "./direct-execution";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Proposal = { id: string; evidence: unknown; status: string };
type Database = Pick<
  PrismaClient | Prisma.TransactionClient,
  "workflowNodeVersion" | "workflowMutation"
>;

/** Legacy initial requests used a stable UUID derived from the exact proposal identity. */
export function initialProposalExecutionId(
  projectId: string,
  proposalId: string,
): string {
  const bytes = createHash("sha256")
    .update(`${projectId}:${proposalId}:initial`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The proposal's accepted semantic version is independent of the tool's current version. */
export async function acceptedProposalVersions(
  database: Database,
  projectId: string,
  proposals: readonly Proposal[],
) {
  const candidates = proposals.filter(
    (proposal) =>
      proposal.status === "accepted" &&
      typeof object(proposal.evidence).toolNodeId === "string",
  );
  if (!candidates.length) return new Map<string, string>();
  const evidenceIds = candidates.flatMap((proposal) =>
    typeof object(proposal.evidence).acceptedNodeVersionId === "string"
      ? [String(object(proposal.evidence).acceptedNodeVersionId)]
      : [],
  );
  const old = candidates.filter(
    (proposal) =>
      typeof object(proposal.evidence).acceptedNodeVersionId !== "string",
  );
  const storedMutations = old.length
    ? await database.workflowMutation.findMany({
        where: {
          projectId,
          mutationId: {
            in: old.map((proposal) =>
              directMutationId(`proposal:${proposal.id}`),
            ),
          },
          origin: "proposal",
        },
        select: { mutationId: true, resultRevision: true },
      })
    : [];
  const mutations = storedMutations.filter(
    (mutation): mutation is typeof mutation & { resultRevision: number } =>
      typeof mutation.resultRevision === "number",
  );
  const nodeIds = [
    ...new Set(
      candidates.map((proposal) =>
        String(object(proposal.evidence).toolNodeId),
      ),
    ),
  ];
  const versions = await database.workflowNodeVersion.findMany({
    where: {
      projectId,
      nodeId: { in: nodeIds },
      kind: "tool",
      OR: [
        ...(evidenceIds.length ? [{ id: { in: evidenceIds } }] : []),
        ...(mutations.length
          ? [
              {
                graphRevision: {
                  lte: Math.max(
                    ...mutations.map((mutation) => mutation.resultRevision),
                  ),
                },
              },
            ]
          : []),
      ],
    },
    orderBy: { version: "desc" },
    select: { id: true, nodeId: true, graphRevision: true },
  });
  const found = new Map<string, string>();
  for (const proposal of candidates) {
    const evidence = object(proposal.evidence);
    const mutation = mutations.find(
      (mutation) =>
        mutation.mutationId === directMutationId(`proposal:${proposal.id}`),
    );
    const version = evidence.acceptedNodeVersionId
      ? versions.find(
          (version) =>
            version.id === evidence.acceptedNodeVersionId &&
            version.nodeId === evidence.toolNodeId,
        )
      : mutation
        ? versions.find(
            (version) =>
              version.nodeId === evidence.toolNodeId &&
              version.graphRevision <= mutation.resultRevision,
          )
        : undefined;
    if (version) found.set(proposal.id, version.id);
  }
  return found;
}
