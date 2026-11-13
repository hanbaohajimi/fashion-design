export const AUTH_RETURN_TO_KEY = "fashion:auth-return-to";

export function safeAuthReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(value)) return "/";
  try {
    const base = "https://auth-return.invalid";
    const target = new URL(value, base);
    if (target.origin !== base || target.pathname.startsWith("/login") || target.pathname.startsWith("/auth/confirm")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

export function currentAuthReturnTo(): string {
  if (typeof window === "undefined") return "/";
  return safeAuthReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export function loginPathWithReturnTo(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(safeAuthReturnTo(returnTo))}`;
}

export function rememberAuthReturnTo(returnTo: string): void {
  try {
    window.sessionStorage.setItem(AUTH_RETURN_TO_KEY, safeAuthReturnTo(returnTo));
  } catch {
    // Authentication still works when sessionStorage is blocked.
  }
}

export function consumeAuthReturnTo(): string | null {
  try {
    const value = window.sessionStorage.getItem(AUTH_RETURN_TO_KEY);
    window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
    return value ? safeAuthReturnTo(value) : null;
  } catch {
    return null;
  }
}
