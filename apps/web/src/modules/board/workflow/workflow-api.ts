import type { WorkflowToolKey } from "@fashion/shared";

export type WorkflowNodeKind = "asset" | "tool";

export type WorkflowAssetType =
  | "brief"
  | "reference_text"
  | "reference_image"
  | "swatch"
  | "sketch"
  | "constraint"
  | "candidate"
  | "evaluation"
  | "trend"
  | "fabric"
  | "legacy";

export type WorkflowToolType =
  | "analyze_brief"
  | "generate_design"
  | "evaluate_design"
  | "edit_design"
  | "restore_version";

export type WorkflowInputPort =
  | "goal"
  | "reference"
  | "constraint"
  | "candidate"
  | "source";

export interface WorkflowNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly type: WorkflowAssetType | WorkflowToolType;
  readonly title: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly x: number;
  readonly y: number;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canDelete?: boolean;
  readonly deleteDisabledReason?: string | null;
}

export interface WorkflowEdge {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourcePort: "out";
  readonly targetPort: WorkflowInputPort;
}

export interface WorkflowGraph {
  readonly projectId: string;
  readonly revision: number;
  readonly layoutRevision: number;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly legacyAvailable: boolean;
  readonly proposals?: readonly WorkflowProposal[];
}

export interface WorkflowProposal {
  readonly id: string;
  readonly baseRevision: number;
  readonly status: string;
  readonly operations: readonly WorkflowOperation[];
  readonly rationale: string;
  readonly toolNodeId: string;
  readonly content: string;
  readonly referencedNodeIds: readonly string[];
  readonly createdAt: string;
  readonly schemaVersion?: number;
  readonly action?: {
    readonly type: "create_tool" | "configure_tool" | "fork_tool";
    readonly toolKey: WorkflowToolKey;
    readonly toolVersion: string;
    readonly title: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly inputs: readonly { readonly nodeId: string; readonly port: WorkflowInputPort }[];
    readonly targetNodeId?: string | null;
    readonly targetNodeVersionId?: string | null;
    readonly preserve?: readonly string[];
  } | null;
  readonly preview?: { readonly before?: unknown; readonly after?: unknown; readonly effect?: string | readonly string[] } | null;
  readonly preserve?: readonly string[];
  readonly planRevision?: number | null;
  readonly targetNodeVersionId?: string | null;
  readonly rejectionReason?: string | null;
}

export type WorkflowOperation =
  | {
      readonly type: "add_node";
      readonly node: Pick<
        WorkflowNode,
        "id" | "kind" | "type" | "title" | "payload" | "x" | "y"
      >;
    }
  | {
      readonly type: "update_node";
      readonly nodeId: string;
      readonly title?: string;
      readonly payload?: Readonly<Record<string, unknown>>;
      readonly status?: string;
    }
  | { readonly type: "link_collection"; readonly nodeId: string; readonly collectionId: string }
  | { readonly type: "remove_node"; readonly nodeId: string }
  | { readonly type: "add_edge"; readonly edge: WorkflowEdge }
  | { readonly type: "remove_edge"; readonly edgeId: string };

export class WorkflowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkflowApiError";
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as {
      readonly code?: string;
      readonly message?: string;
    };
    return new WorkflowApiError(
      body.message ?? fallback,
      response.status,
      body.code ?? "WORKFLOW_REQUEST_FAILED",
    );
  } catch {
    return new WorkflowApiError(
      fallback,
      response.status,
      "WORKFLOW_REQUEST_FAILED",
    );
  }
}

function graphUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/workflow`;
}

export async function fetchWorkflow(projectId: string): Promise<WorkflowGraph> {
  const response = await fetch(`${graphUrl(projectId)}/sync`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw await responseError(response, "设计工作流读取失败");
  return (await response.json()) as WorkflowGraph;
}

export async function patchWorkflow(
  projectId: string,
  input:
    | {
        readonly mode: "semantic";
        readonly mutationId: string;
        readonly baseRevision: number;
        readonly operations: readonly WorkflowOperation[];
      }
    | {
        readonly mode: "layout";
        readonly mutationId: string;
        readonly baseLayoutRevision: number;
        readonly positions: readonly {
          readonly nodeId: string;
          readonly x: number;
          readonly y: number;
        }[];
      },
): Promise<WorkflowGraph> {
  const response = await fetch(graphUrl(projectId), {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) throw await responseError(response, "设计工作流保存失败");
  return (await response.json()) as WorkflowGraph;
}

async function runtimePost<T>(projectId: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${graphUrl(projectId)}${path}`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw await responseError(response, "工作流操作失败");
  return (await response.json()) as T;
}

export function proposeWorkflowStep(
  projectId: string,
  content: string,
  referencedNodeIds: readonly string[],
): Promise<WorkflowProposal> {
  return runtimePost(projectId, "/proposals", {
    content,
    referencedNodeIds,
    mutationId: crypto.randomUUID(),
  });
}

export function decideWorkflowProposal(
  projectId: string,
  proposal: WorkflowProposal,
  decision: "accept" | "reject",
  reason?: string,
): Promise<WorkflowGraph> {
  return runtimePost(projectId, `/proposals/${encodeURIComponent(proposal.id)}/${decision}`, {
    ...(decision === "accept" ? { baseRevision: proposal.baseRevision } : {}),
    ...(decision === "reject" && reason?.trim() ? { reason: reason.trim() } : {}),
    mutationId: crypto.randomUUID(),
  });
}

export function executeWorkflowNode(projectId: string, nodeId: string, conversationId?: string): Promise<WorkflowGraph> {
  return runtimePost(projectId, `/nodes/${encodeURIComponent(nodeId)}/execute`, {
    mutationId: crypto.randomUUID(),
    ...(conversationId ? { conversationId } : {}),
  });
}

export async function fetchWorkflowToolCatalog(projectId: string): Promise<{ readonly agentVersion: 1 | 2; readonly tools: readonly { readonly key: WorkflowToolKey; readonly name: string; readonly version: string; readonly description: string; readonly defaults: Readonly<Record<string, unknown>> }[] }> {
  const response = await fetch(`${graphUrl(projectId)}/tools`, { cache: "no-store", credentials: "include" });
  if (!response.ok) throw await responseError(response, "工具目录读取失败");
  return response.json();
}

export function updateWorkflowAgentSettings(projectId: string, version: 1 | 2): Promise<{ readonly version: 1 | 2 }> {
  return runtimePost(projectId, "/agent-settings", { version });
}

export function inferWorkflowNodeRole(projectId: string, nodeId: string): Promise<WorkflowGraph> {
  return runtimePost(projectId, `/nodes/${encodeURIComponent(nodeId)}/infer-role`, {
    mutationId: crypto.randomUUID(),
  });
}

export interface WorkflowAttempt {
  readonly id: string;
  readonly ordinal: number;
  readonly status: string;
  readonly generationTaskId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly request: Readonly<Record<string, unknown>>;
}

export async function fetchWorkflowNodeHistory(
  projectId: string,
  nodeId: string,
): Promise<{ readonly items: readonly WorkflowAttempt[] }> {
  const response = await fetch(
    `${graphUrl(projectId)}/nodes/${encodeURIComponent(nodeId)}/history`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) throw await responseError(response, "执行历史读取失败");
  return (await response.json()) as { readonly items: readonly WorkflowAttempt[] };
}

export function decideWorkflowCandidate(
  projectId: string,
  nodeId: string,
  assetId: string,
  kind: "selected" | "rejected" | "compare",
  reason: string,
): Promise<WorkflowGraph> {
  return runtimePost(projectId, `/nodes/${encodeURIComponent(nodeId)}/decisions`, {
    assetId,
    kind,
    reason,
    mutationId: crypto.randomUUID(),
  });
}

export function assetPayload(node: WorkflowNode): {
  readonly assetId: string | null;
  readonly imageUrl: string | null;
  readonly text: string | null;
} {
  const payload = node.payload;
  return {
    assetId: typeof payload.assetId === "string" ? payload.assetId : null,
    imageUrl:
      typeof payload.imageUrl === "string"
        ? payload.imageUrl
        : typeof payload.thumbnailUrl === "string"
          ? payload.thumbnailUrl
          : null,
    text:
      typeof payload.text === "string"
        ? payload.text
        : typeof payload.report === "string"
          ? payload.report
          : null,
  };
}
