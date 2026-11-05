import type { CreatedRealtimeTryOnSession } from "@fashion/shared";
import { privateFetch } from "../../auth/private-fetch";
import { readErrorMessage } from "../../auth/auth-api";
import { DecartRealtimeAdapter } from "./decart-realtime-adapter";
import { RealtimeTryOnController } from "./realtime-tryon-machine";
import { TryOnError, type RealtimeTryOnApi } from "./realtime-tryon-types";

async function request<T>(path: string, body: unknown, key?: string): Promise<T> {
  const response = await privateFetch(`/api/realtime-tryon${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
    // End requests remain best effort during page navigation.
    ...(path.endsWith("/end") ? { keepalive: true } : {}),
  });
  if (!response.ok) {
    throw new TryOnError(await readErrorMessage(response, "试穿请求失败，请稍后重试。"), "TRYON_API_ERROR");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const realtimeTryOnApi: RealtimeTryOnApi = {
  create: (input, key) => request<CreatedRealtimeTryOnSession>("/sessions", input, key),
  observe: (id, observation) => request(`/sessions/${encodeURIComponent(id)}/observations`, observation),
  end: (id, reason) => request(`/sessions/${encodeURIComponent(id)}/end`, { reason }),
};

/** Construction does not load the SDK, request a camera or issue a paid credential. */
export function createRealtimeTryOnController(): RealtimeTryOnController {
  return new RealtimeTryOnController(realtimeTryOnApi, new DecartRealtimeAdapter());
}
