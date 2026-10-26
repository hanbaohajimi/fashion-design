import type {
  RunwayAction,
  RunwayCapabilities,
  RunwayDraft,
  RunwayRunView,
  RunwayShowView,
  RunwayStage,
} from "@fashion/shared";
import { privateFetch } from "../auth/private-fetch";
import { readErrorMessage } from "../auth/auth-api";
import { StudioApiError } from "../studio/studio-api";

export function runwayBase(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/runway`;
}

async function request<T>(
  projectId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await privateFetch(runwayBase(projectId) + path, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok)
    throw new StudioApiError(
      await readErrorMessage(response, "服装秀操作失败，请重试"),
      response.status,
    );
  return response.json() as Promise<T>;
}

export const fetchRunwayCapabilities = (
  projectId: string,
  signal?: AbortSignal,
) =>
  request<RunwayCapabilities>(
    projectId,
    "/capabilities",
    signal ? { signal } : undefined,
  );
export const fetchRunwayShows = (projectId: string, signal?: AbortSignal) =>
  request<RunwayShowView[]>(
    projectId,
    "/shows",
    signal ? { signal } : undefined,
  );
export const fetchRunwayShow = (
  projectId: string,
  showId: string,
  signal?: AbortSignal,
) =>
  request<RunwayShowView>(
    projectId,
    `/shows/${encodeURIComponent(showId)}`,
    signal ? { signal } : undefined,
  );
export const fetchRunwayRun = (
  projectId: string,
  runId: string,
  signal?: AbortSignal,
) =>
  request<RunwayRunView>(
    projectId,
    `/runs/${encodeURIComponent(runId)}`,
    signal ? { signal } : undefined,
  );
export function saveRunwayShow(
  projectId: string,
  value: { title: string; draft: RunwayDraft },
  requestKey: string,
  existing?: RunwayShowView,
) {
  return request<RunwayShowView>(
    projectId,
    `/shows${existing ? `/${encodeURIComponent(existing.id)}` : ""}`,
    {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({
        ...value,
        requestKey,
        ...(existing ? { expectedVersion: existing.version } : {}),
      }),
    },
  );
}
export const startRunway = (
  projectId: string,
  show: RunwayShowView,
  requestKey: string,
) =>
  request<RunwayRunView>(
    projectId,
    `/shows/${encodeURIComponent(show.id)}/runs`,
    {
      method: "POST",
      body: JSON.stringify({ requestKey, expectedVersion: show.version }),
    },
  );
export const actOnRunway = (
  projectId: string,
  runId: string,
  action: RunwayAction,
) =>
  request<RunwayRunView>(
    projectId,
    `/runs/${encodeURIComponent(runId)}/actions`,
    { method: "POST", body: JSON.stringify(action) },
  );
export const forkRunway = (
  projectId: string,
  run: RunwayRunView,
  stage: RunwayStage,
  requestKey: string,
  mediaId?: string,
) =>
  request<RunwayRunView>(
    projectId,
    `/runs/${encodeURIComponent(run.id)}/forks`,
    {
      method: "POST",
      body: JSON.stringify({
        requestKey,
        expectedVersion: run.version,
        stage,
        ...(mediaId ? { mediaId } : {}),
      }),
    },
  );
export const cancelRunway = (
  projectId: string,
  run: RunwayRunView,
  requestKey: string,
) =>
  request<RunwayRunView>(
    projectId,
    `/runs/${encodeURIComponent(run.id)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ requestKey, expectedVersion: run.version }),
    },
  );
export const archiveRunway = (
  projectId: string,
  show: RunwayShowView,
  requestKey: string,
) =>
  request<RunwayShowView>(projectId, `/shows/${encodeURIComponent(show.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      archived: !show.archived,
      requestKey,
      expectedVersion: show.version,
    }),
  });

/** The persisted cursor survives reconnects; account changes abort the stream. */
export async function watchRunway(
  projectId: string,
  runId: string,
  signal: AbortSignal,
  onChange: () => void,
) {
  let cursor = "";
  while (!signal.aborted) {
    try {
      const response = await privateFetch(
        `${runwayBase(projectId)}/runs/${encodeURIComponent(runId)}/events`,
        {
          signal,
          credentials: "include",
          cache: "no-store",
          headers: cursor ? { "Last-Event-ID": cursor } : {},
        },
      );
      if (!response.ok || !response.body) throw new Error("进度连接中断");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder
            .decode(chunk.value, { stream: true })
            .replace(/\r\n/g, "\n");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const packet = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const id = /^id:\s*(.+)$/m.exec(packet)?.[1];
            if (id) cursor = id;
            if (/^data:/m.test(packet) && !/^event:\s*heartbeat$/m.test(packet))
              onChange();
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch {
      if (signal.aborted) return;
    }
    onChange();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 5000);
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
