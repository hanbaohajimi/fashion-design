// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExperimentView } from "@fashion/shared";
import { ExperimentPanel } from "./ExperimentPanel";
import { studioFixture } from "./studio-test-fixtures";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const batch: ExperimentView = {
  id: "batch-1",
  projectId: "project-1",
  version: 1,
  sourceAssetId: "asset-front",
  mode: "color",
  preserve: "保留廓形",
  createdAt: "2026-10-21T00:00:00Z",
  items: [
    {
      id: "item-1",
      title: "墨黑",
      prompt: "改为墨黑",
      status: "draft",
      attempt: 0,
      taskId: null,
      error: null,
      color: { name: "墨黑", hex: "#202020" },
      fabric: null,
      assets: [],
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("saves a plan without creating generation tasks or dispatching cells", async () => {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).includes("/api/fabrics")) return json({ items: [] });
      return options?.method === "POST" ? json(batch) : json([]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const onDirty = vi.fn();
  render(
    <ExperimentPanel
      projectId="project-1"
      assets={studioFixture().assets}
      onDirty={onDirty}
    />,
  );
  await waitFor(() =>
    expect(screen.queryByText("正在读取实验计划…")).toBeNull(),
  );
  fireEvent.change(screen.getByLabelText("本轮目标"), {
    target: { value: "只改变颜色" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存实验计划" }));
  await screen.findByText(/实验计划已保存/);
  const posts = fetcher.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
  expect(posts).toHaveLength(1);
  expect(String(posts[0]?.[0])).toBe("/api/projects/project-1/experiments");
  expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
    sourceAssetId: "asset-front",
    mode: "color",
    prompt: "只改变颜色",
  });
  expect(screen.getByRole("button", { name: "提交待执行方案" })).toBeTruthy();
  expect(
    fetcher.mock.calls.filter(([input]) =>
      String(input).endsWith("/experiments"),
    ),
  ).toHaveLength(2);
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
});
it("only dispatches draft cells and keeps completed results untouched", async () => {
  const record = {
    ...batch,
    items: [
      ...batch.items,
      { ...batch.items[0], id: "item-done", status: "succeeded", assets: [] },
    ],
  };
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).includes("/api/fabrics")) return json({ items: [] });
      if (options?.method === "POST")
        return json({
          ...batch,
          items: [{ ...batch.items[0], status: "queued" }],
        });
      return json([record]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <ExperimentPanel projectId="project-1" assets={studioFixture().assets} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "提交待执行方案" }),
  );
  await screen.findAllByText("排队中");
  const posts = fetcher.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
  expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
    action: "submit",
    itemIds: ["item-1"],
  });
});
it("does not offer generation controls to viewers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      String(input).includes("/api/fabrics")
        ? json({ items: [] })
        : json([batch]),
    ),
  );
  render(
    <ExperimentPanel
      projectId="project-1"
      assets={studioFixture().assets}
      canEdit={false}
    />,
  );
  await screen.findByText(/提交生成需要编辑权限/);
  expect(screen.queryByRole("button", { name: "保存实验计划" })).toBeNull();
  expect(screen.queryByRole("button", { name: "提交待执行方案" })).toBeNull();
});

it("retries only the chosen failed cell without resubmitting other cells", async () => {
  const first = batch.items[0];
  if (!first) throw new Error("实验 fixture 缺少单元格");
  const record: ExperimentView = {
    ...batch,
    items: [
      { ...first, status: "failed" },
      { ...first, id: "item-2", status: "failed" },
      { ...first, id: "item-done", status: "succeeded" },
    ],
  };
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input).includes("/api/fabrics")) return json({ items: [] });
      return options?.method === "POST" ? json(record) : json([record]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <ExperimentPanel projectId="project-1" assets={studioFixture().assets} />,
  );
  const retry = await screen.findAllByRole("button", {
    name: /^重试此方案$/u,
  });
  const selected = retry[0];
  if (!selected) throw new Error("缺少失败单元格的重试入口");
  fireEvent.click(selected);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(true),
  );
  const post = fetcher.mock.calls.find(
    ([, options]) => options?.method === "POST",
  );
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    action: "retry",
    itemIds: ["item-1"],
  });
});
