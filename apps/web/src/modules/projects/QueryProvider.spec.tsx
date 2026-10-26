// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryProvider } from "./QueryProvider";
import { privateFetch, setPrivateRequestUser } from "../auth/private-fetch";

let user = "startup-user";
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: { user: { id: user } } }) }));
vi.mock("../navigation", () => ({ installNavigationHistory: () => () => {} }));
vi.mock("../trends/active-board", () => ({ setActiveBoardUser: () => {} }));
afterEach(() => { cleanup(); setPrivateRequestUser(null); vi.unstubAllGlobals(); });

it("establishes identity before descendant layout reads and cancels only the previous account", () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  }));
  function LayoutReader() {
    useLayoutEffect(() => { void privateFetch("/startup").catch(() => {}); }, []);
    return <p>读取资料</p>;
  }
  const view = render(<QueryProvider><LayoutReader /></QueryProvider>);
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(false);
  user = "next-user";
  view.rerender(<QueryProvider><LayoutReader /></QueryProvider>);
  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
});
