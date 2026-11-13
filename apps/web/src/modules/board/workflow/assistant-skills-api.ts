import { privateFetch } from "../../auth/private-fetch";
import type {
  AssistantSkillInput,
  AssistantSkillView,
} from "@fashion/shared";

const base = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/assistant-skills`;

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = "技能服务暂时不可用";
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the stable fallback when the server response is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchAssistantSkills(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly AssistantSkillView[]> {
  const response = await privateFetch(base(projectId), {
    ...(signal ? { signal } : {}),
    credentials: "include",
    cache: "no-store",
  });
  return readResponse(response);
}

export async function createAssistantSkillRemote(
  projectId: string,
  input: AssistantSkillInput,
  requestKey: string,
): Promise<AssistantSkillView> {
  const response = await privateFetch(base(projectId), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestKey,
    },
    body: JSON.stringify(input),
  });
  return readResponse(response);
}

export async function deleteAssistantSkillRemote(
  projectId: string,
  skillId: string,
): Promise<void> {
  const response = await privateFetch(
    `${base(projectId)}/${encodeURIComponent(skillId)}`,
    { method: "DELETE", credentials: "include" },
  );
  await readResponse(response);
}

