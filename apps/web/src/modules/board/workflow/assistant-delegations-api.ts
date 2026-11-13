import type {
  AssistantDelegationInput,
  AssistantDelegationStateInput,
  AssistantDelegationView,
} from "@fashion/shared";

import { privateFetch } from "../../auth/private-fetch";

const base = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/assistant-delegations`;

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = "设计委托服务暂时不可用";
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep a stable recovery message when the response is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchAssistantDelegations(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly AssistantDelegationView[]> {
  const response = await privateFetch(base(projectId), {
    ...(signal ? { signal } : {}),
    cache: "no-store",
    credentials: "include",
  });
  return readResponse(response);
}

export async function createAssistantDelegationRemote(
  projectId: string,
  input: AssistantDelegationInput,
  requestKey: string,
): Promise<AssistantDelegationView> {
  const response = await privateFetch(base(projectId), {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestKey,
    },
    method: "POST",
  });
  return readResponse(response);
}

export async function updateAssistantDelegationRemote(
  delegationId: string,
  input: AssistantDelegationStateInput,
): Promise<AssistantDelegationView> {
  const response = await privateFetch(
    `/api/assistant-delegations/${encodeURIComponent(delegationId)}`,
    {
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
  return readResponse(response);
}

export async function runAssistantDelegationRemote(
  delegationId: string,
): Promise<AssistantDelegationView> {
  const response = await privateFetch(
    `/api/assistant-delegations/${encodeURIComponent(delegationId)}/run`,
    { credentials: "include", method: "POST" },
  );
  return readResponse(response);
}

export async function deleteAssistantDelegationRemote(
  delegationId: string,
): Promise<void> {
  const response = await privateFetch(
    `/api/assistant-delegations/${encodeURIComponent(delegationId)}`,
    { credentials: "include", method: "DELETE" },
  );
  await readResponse(response);
}
