// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, SESSION_CHANGE_KEY, useAuth } from "./AuthProvider";

const mocks = vi.hoisted(() => ({
  fetchMe: vi.fn(), logoutSession: vi.fn(), refreshSession: vi.fn(),
  readErrorMessage: vi.fn(), clearAccount: vi.fn(),
  router: { replace: vi.fn() }, pathname: "/",
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => mocks.router }));
vi.mock("../../observability/analytics", () => ({ identifyAnalyticsUser: vi.fn(), resetAnalyticsUser: vi.fn() }));
vi.mock("../../components/drafts/draft-repository", () => ({ draftRepository: { clearAccount: mocks.clearAccount } }));
vi.mock("./auth-api", () => ({ AUTH_EXPIRED_EVENT: "test-auth-expired", fetchMe: mocks.fetchMe,
  logoutSession: mocks.logoutSession, refreshSession: mocks.refreshSession, readErrorMessage: mocks.readErrorMessage }));

mocks.clearAccount.mockResolvedValue(undefined);
afterEach(() => {
  cleanup(); vi.resetAllMocks(); localStorage.clear(); mocks.pathname = "/";
  mocks.clearAccount.mockResolvedValue(undefined);
});

const sessionResponse = (id: string) => new Response(JSON.stringify({ user: { id, email: `${id}@example.com` } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

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

it.each(["/share/shared-image", "/auth/confirm", "/login"])("进入公开页面 %s 后回到原账号不会清理未提交草稿", async (pathname) => {
  mocks.fetchMe.mockImplementation(() => Promise.resolve(sessionResponse("a")));
  localStorage.setItem("fashion-sketch:a:project", "未提交草图");
  const { result, rerender } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  mocks.pathname = pathname;
  rerender();
  await waitFor(() => expect(result.current.session).toBeNull());
  expect(mocks.clearAccount).not.toHaveBeenCalled();
  expect(localStorage.getItem("fashion-sketch:a:project")).toBe("未提交草图");
  mocks.pathname = "/";
  rerender();
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  expect(mocks.clearAccount).not.toHaveBeenCalled();
});

it("公开页面之后确认切换账号，仍然清理原账号草稿", async () => {
  mocks.fetchMe.mockResolvedValueOnce(sessionResponse("a")).mockResolvedValueOnce(sessionResponse("b"));
  localStorage.setItem("fashion-sketch:a:project", "旧账号");
  localStorage.setItem("fashion-sketch:b:project", "新账号");
  const { result, rerender } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  mocks.pathname = "/auth/confirm";
  rerender();
  await waitFor(() => expect(result.current.session).toBeNull());
  mocks.pathname = "/";
  rerender();
  await waitFor(() => expect(result.current.session?.user.id).toBe("b"));
  expect(mocks.clearAccount).toHaveBeenCalledExactlyOnceWith("a");
  expect(localStorage.getItem("fashion-sketch:a:project")).toBeNull();
  expect(localStorage.getItem("fashion-sketch:b:project")).toBe("新账号");
});

it("退出时合并重复请求，阻止后台刷新恢复旧身份，并只清理当前账号", async () => {
  const pendingLogout = deferred<Response>();
  const pendingSession = deferred<Response>();
  mocks.fetchMe.mockResolvedValueOnce(sessionResponse("a")).mockReturnValueOnce(pendingSession.promise);
  mocks.logoutSession.mockReturnValueOnce(pendingLogout.promise);
  localStorage.setItem("fashion-sketch:a:project", "当前账号");
  localStorage.setItem("fashion-sketch:b:project", "其他账号");
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  let refresh!: Promise<void>;
  let logout!: Promise<void>;
  act(() => {
    refresh = result.current.refresh();
    logout = result.current.logout();
    expect(result.current.logout()).toBe(logout);
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_CHANGE_KEY, newValue: "changed" }));
    window.dispatchEvent(new Event("test-auth-expired"));
  });
  expect(mocks.logoutSession).toHaveBeenCalledTimes(1);
  expect(mocks.fetchMe).toHaveBeenCalledTimes(2);
  await act(async () => { pendingLogout.resolve(new Response(null, { status: 204 })); await logout; });
  await act(async () => { pendingSession.resolve(sessionResponse("a")); await refresh; });
  expect(result.current.session).toBeNull();
  expect(result.current.loading).toBe(false);
  expect(mocks.clearAccount).toHaveBeenCalledExactlyOnceWith("a");
  expect(localStorage.getItem("fashion-sketch:a:project")).toBeNull();
  expect(localStorage.getItem("fashion-sketch:b:project")).toBe("其他账号");
  expect(mocks.router.replace).toHaveBeenCalledWith("/login");
});

it("退出失败保留当前账号草稿，随后仍可以刷新", async () => {
  mocks.fetchMe.mockImplementation(() => Promise.resolve(sessionResponse("a")));
  mocks.logoutSession.mockResolvedValueOnce(new Response(null, { status: 503 }));
  mocks.readErrorMessage.mockResolvedValueOnce("退出暂不可用");
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  await act(async () => { await expect(result.current.logout()).rejects.toThrow("退出暂不可用"); });
  expect(result.current.session?.user.id).toBe("a");
  expect(mocks.clearAccount).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.fetchMe).toHaveBeenCalledTimes(2));
  expect(result.current.session?.user.id).toBe("a");
});

it("退出失败后补查退出期间另一标签切换的账号", async () => {
  const pendingLogout = deferred<Response>();
  mocks.fetchMe.mockResolvedValueOnce(sessionResponse("a")).mockResolvedValueOnce(sessionResponse("b"));
  mocks.logoutSession.mockReturnValueOnce(pendingLogout.promise);
  mocks.readErrorMessage.mockResolvedValueOnce("退出暂不可用");
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  let logout!: Promise<void>;
  act(() => {
    logout = result.current.logout();
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_CHANGE_KEY, newValue: "switched-to-b" }));
  });
  expect(mocks.fetchMe).toHaveBeenCalledTimes(1);
  await act(async () => {
    pendingLogout.resolve(new Response(null, { status: 503 }));
    await expect(logout).rejects.toThrow("退出暂不可用");
  });
  await waitFor(() => expect(result.current.session?.user.id).toBe("b"));
  expect(mocks.clearAccount).toHaveBeenCalledExactlyOnceWith("a");
});

it("服务端确认会话失效时清理账号草稿", async () => {
  mocks.fetchMe.mockResolvedValueOnce(sessionResponse("a")).mockResolvedValueOnce(new Response(null, { status: 401 }));
  mocks.refreshSession.mockResolvedValueOnce(new Response(null, { status: 401 }));
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.session?.user.id).toBe("a"));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.session).toBeNull();
  expect(mocks.clearAccount).toHaveBeenCalledExactlyOnceWith("a");
  expect(mocks.router.replace).toHaveBeenCalledWith("/login");
});

it("旧请求延迟解析出的错误不会覆盖新会话", async () => {
  const errorMessage = deferred<string>();
  mocks.fetchMe.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(sessionResponse("b"));
  mocks.readErrorMessage.mockReturnValueOnce(errorMessage.promise);
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(mocks.readErrorMessage).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: SESSION_CHANGE_KEY, newValue: "new-session" })));
  await waitFor(() => expect(result.current.session?.user.id).toBe("b"));
  await act(async () => { errorMessage.resolve("旧账号读取失败"); await errorMessage.promise; });
  expect(result.current.error).toBeNull();
  expect(result.current.session?.user.id).toBe("b");
});
