// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, SESSION_CHANGE_KEY, useAuth } from "./AuthProvider";

const mocks = vi.hoisted(() => ({ fetchMe: vi.fn(), router: { replace: vi.fn() }, pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => mocks.router }));
vi.mock("../../observability/analytics", () => ({ identifyAnalyticsUser: vi.fn(), resetAnalyticsUser: vi.fn() }));
vi.mock("./auth-api", () => ({ AUTH_EXPIRED_EVENT: "test-auth-expired", fetchMe: mocks.fetchMe,
  logoutSession: vi.fn(), refreshSession: vi.fn(), readErrorMessage: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.pathname = "/"; });

it("跨标签身份通知使旧会话查询失效，新会话不被旧响应覆盖", async () => {
  const response = (id: string) => new Response(JSON.stringify({ user: { id, email: `${id}@example.com` } }));
  let release!: (value: Response) => void;
  mocks.fetchMe.mockResolvedValueOnce(response("a"))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(response("b"));
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  expect(mocks.fetchMe).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: SESSION_CHANGE_KEY, newValue: "new-session" })));
  await waitFor(() => expect(result.current.session?.user.id).toBe("b"));
  await act(async () => { release(response("a")); await pending; });
  expect(result.current.session?.user.id).toBe("b");
  expect(mocks.fetchMe).toHaveBeenCalledTimes(3);
});

it("同标签进入登录确认页会隔离旧身份，返回工作区重新读取会话", async () => {
  const response = (id: string) => new Response(JSON.stringify({ user: { id, email: `${id}@example.com` } }));
  let release!: (value: Response) => void;
  mocks.fetchMe.mockResolvedValueOnce(response("a"))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(response("b"));
  const { result, rerender } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  mocks.pathname = "/auth/confirm";
  rerender();
  await waitFor(() => expect(result.current.session).toBeNull());
  mocks.pathname = "/";
  rerender();
  await waitFor(() => expect(result.current.session?.user.id).toBe("b"));
  await act(async () => { release(response("a")); await pending; });
  expect(result.current.session?.user.id).toBe("b");
});
