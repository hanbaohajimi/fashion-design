/** Shared low-level fetch helpers used by all API modules. */
const BASE = '/api/design';

export { BASE };

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('af:session-expired'));
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
