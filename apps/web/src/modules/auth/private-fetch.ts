let identity: string | null = null;
let lifetime = new AbortController();

/** Every private request, including SWR and uploads, belongs to one account lifetime. */
export function setPrivateRequestUser(userId: string | null): void {
  if (identity === userId) return;
  lifetime.abort(new DOMException("账号已变化", "AbortError"));
  identity = userId;
  lifetime = new AbortController();
}

/** Non-fetch transports share the same account lifetime as authenticated fetches. */
export function privateRequestSignal(signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
}

export async function privateFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signals = [lifetime.signal];
  if (init?.signal) signals.push(init.signal);
  if (input instanceof Request) signals.push(input.signal);
  const signal = AbortSignal.any(signals);
  const response = await globalThis.fetch(input, { ...init, signal });
  signal.throwIfAborted();
  return response;
}
