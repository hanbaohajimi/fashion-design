export interface AuthUser {
  readonly authId: string | null;
  readonly avatar: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly email: string;
  readonly id: string;
  readonly name: string | null;
}

export interface MeResponse {
  readonly credits: {
    readonly limit: number;
    readonly remaining: number;
    readonly used: number;
  };
  readonly user: AuthUser;
}

interface ErrorResponse {
  readonly message?: string;
}

export async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as ErrorResponse;
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function fetchMe(): Promise<Response> {
  return fetch("/api/me", {
    cache: "no-store",
    credentials: "include",
  });
}

export async function refreshSession(): Promise<Response> {
  return fetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ action: "refresh" }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function logoutSession(): Promise<Response> {
  return fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
  });
}
