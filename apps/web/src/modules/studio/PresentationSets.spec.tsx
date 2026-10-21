// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PresentationSets } from "./PresentationSets";
import { studioFixture, styleFixture } from "./studio-test-fixtures";
vi.mock("./TechPackExportButton", () => ({
  TechPackExportButton: () => <span>PDF 导出任务</span>,
}));
const props = () => ({
  projectId: "project-1",
  data: studioFixture({ styles: [styleFixture()] }),
  canEdit: true,
  onDirty: vi.fn(),
  onSaved: vi.fn(async () => {}),
  beforeChange: vi.fn(async () => true),
  onGenerate: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires manual image review before completing a presentation set", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<PresentationSets {...props()} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "春夏夹克详情页" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.change(screen.getByLabelText("图片 1 说明"), {
    target: { value: "夹克正面展示" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对并完成展示包" }));
  await screen.findByText("交付前请逐张人工核对商品外观");
  expect(fetch).not.toHaveBeenCalled();
});
it("saves a reviewed set against the exact style revision", async () => {
  const values = props();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "presentation-1" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "春夏夹克详情页" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.change(screen.getByLabelText("图片 1 视图"), {
    target: { value: "front" },
  });
  fireEvent.change(screen.getByLabelText("图片 1 说明"), {
    target: { value: "夹克正面展示" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "核对并完成展示包" }));
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    type: "PRESENTATION_SET",
    payload: {
      status: "READY",
      styleRevisionId: "style-r1",
      channel: "marketplace",
      items: [
        {
          assetId: "asset-front",
          kind: "front",
          label: "夹克正面展示",
          reviewed: true,
        },
      ],
    },
  });
});
it("opens the dedicated generation flow without dispatching from the library", () => {
  const values = props();
  vi.stubGlobal("fetch", vi.fn());
  render(<PresentationSets {...values} />);
  fireEvent.click(screen.getByRole("button", { name: "生成展示候选" }));
  expect(values.onGenerate).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("resets an unsaved new set after discard is confirmed", async () => {
  const values = props();
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "未保存展示包" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新建展示包" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("展示包名称") as HTMLInputElement).value,
    ).toBe(""),
  );
  expect(values.beforeChange).toHaveBeenCalledTimes(1);
});
it("keeps an unsaved new set when discard is declined", async () => {
  const values = props();
  values.beforeChange.mockResolvedValue(false);
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "未保存展示包" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新建展示包" }));
  await waitFor(() => expect(values.beforeChange).toHaveBeenCalledTimes(1));
  expect((screen.getByLabelText("展示包名称") as HTMLInputElement).value).toBe(
    "未保存展示包",
  );
});
